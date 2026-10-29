#!/usr/bin/env python3
"""EXPERIMENTAL: bounded-view/Plumtree-inspired and multicast reliable Pub/Sub.
Not the original HyParView, Plumtree, NORM, or libp2p Gossipsub implementation.
"""
import argparse
import json
import random
import resource
import select
import socket
import time
from pathlib import Path

GROUP = ('239.77.77.88', 7702)
TOPIC = 'bench/all'
PAYLOAD = 'x' * 32

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', type=int, required=True)
    ap.add_argument('--count', type=int, required=True)
    ap.add_argument('--mode', choices=['multicast', 'tree', 'mesh', 'hybrid'], required=True)
    ap.add_argument('--v4',action='store_true',help='experimental multicast-NACK suppression and bounded repair')
    ap.add_argument('--workdir', required=True)
    ap.add_argument('--discovery-seconds', type=float, default=9)
    ap.add_argument('--timeout', type=float, default=24)
    ap.add_argument('--messages', type=int, default=2)
    ap.add_argument('--publish-spread', type=float, default=3)
    ap.add_argument('--publishers', type=int, default=0)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--repair-fanout', type=int, default=4)
    ap.add_argument('--repair-interval', type=float, default=1.0)
    ap.add_argument('--publish-interval',type=float,default=.28)
    ap.add_argument('--payload-bytes',type=int,default=32)
    ap.add_argument('--ablation',choices=['full','no_anti_entropy','no_hello','no_nack_suppression','unicast_repair'],default='full')
    ap.add_argument('--incremental-repair',action='store_true')
    ap.add_argument('--nack-batch-limit',type=int,default=32)
    ap.add_argument('--peer-repair',action='store_true',help='bounded deterministic backup caching and NACK takeover')
    ap.add_argument('--peer-replicas',type=int,default=6)
    ap.add_argument('--peer-cache-limit',type=int,default=2048)
    ap.add_argument('--backup-quorum',type=int,default=2)
    args = ap.parse_args()

    i, n, m = args.id, args.count, args.messages
    assert 1<=args.payload_bytes<=1200 and 0<args.publish_interval<=5
    assert 1<=args.nack_batch_limit<=64
    assert 1<=args.peer_replicas<n and args.peer_cache_limit>0
    assert 1<=args.backup_quorum<=args.peer_replicas
    PAYLOAD='x'*args.payload_bytes
    publisher_count = args.publishers if args.publishers > 0 else n
    workdir = Path(args.workdir)
    own_ip = f'10.77.{i // 250}.{i % 250 + 1}'
    rnd = random.Random(33550336 + i * 17 + args.seed * 100003)
    known = {i: own_ip}
    received = set()
    # Publisher progress comes from actual received data or periodic source HELLO.
    # Without this watermark a receiver NACKs future, not-yet-published samples.
    source_watermark = {}
    source_finished = set()
    peer_cache = {}  # Bounded cache only on deterministic backup peers.
    pending_peer_repairs = {}
    peer_repair_last = {}
    backup_acks = {}  # Source-side per-sequence backup storage confirmations.
    pending_backup_acks = {}  # Cache holders retry until source confirms the ACK.
    last_source_hello = {}
    backup_durable_at = None
    # Store no per-peer session; IDs are obtained by HELLO and anti-entropy.
    lazy_pending = {}
    request_last = {}
    suppressed = {}
    source_repair_last = {}
    source_repair_count = {}
    last_completed_ack = set()
    duplicate = 0
    rx_overflow_report = 0
    send_errors = 0
    start_udp_stats = {}
    stats = dict(hello_sent=0, digest_sent=0, delta_sent=0,
                 data_sent=0, data_forwarded=0, nack_sent=0,
                 repair_sent=0, packets_received=0,
                 ihave_sent=0, iwant_sent=0, nack_suppressed=0,
                 nack_heard=0, repair_suppressed=0, completed_ack_sent=0,
                 backup_ack_sent=0, backup_ack_received=0,
                 peer_repairs_sent=0, peer_cache_evictions=0,
                 backup_ack_confirm_sent=0, backup_ack_confirm_recv=0)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 2 * 1024 * 1024)
    sock.bind(('', GROUP[1]))
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP,
                    socket.inet_aton(GROUP[0]) + socket.inet_aton(own_ip))
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF,
                    socket.inet_aton(own_ip))
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
    sock.setblocking(False)
    # Linux SO_RXQ_OVFL provides cumulative kernel socket queue drops via recvmsg ancillary data.
    SO_RXQ_OVFL = 40
    try:
        sock.setsockopt(socket.SOL_SOCKET, SO_RXQ_OVFL, 1)
    except OSError:
        pass

    def udp_counters():
        try:
            lines = Path('/proc/net/snmp').read_text().splitlines()
            for k in range(0, len(lines)-1):
                if lines[k].startswith('Udp:') and lines[k+1].startswith('Udp:'):
                    return {key:int(v) for key,v in zip(lines[k].split()[1:],lines[k+1].split()[1:])}
        except (OSError, ValueError):
            pass
        return {}

    start_udp_stats = udp_counters()

    def send(msg, address, kind):
        nonlocal send_errors
        try:
            sock.sendto(json.dumps(msg, separators=(',', ':')).encode(), address)
            stats[kind] += 1
        except (OSError, ValueError):
            send_errors += 1

    def backup_peers(origin, sequence):
        # Fixed global benchmark IDs allow deterministic replica selection.
        start=((origin*1103515245+sequence*12345+7919)&0x7fffffff)%n
        result=[]
        for off in range(n):
            candidate=(start+off)%n
            if candidate!=origin:
                result.append(candidate)
                if len(result)>=args.peer_replicas:
                    break
        return result

    def tree_children(origin):
        # 3-ary dissemination tree rooted at the origin, evaluated locally.
        # Requires known n: benchmark topology, not a dynamic tree protocol.
        idx = (i - origin) % n
        return [(origin + 3 * idx + offset) % n for offset in (1, 2, 3)
                if 3 * idx + offset < n]

    def mesh_neighbors():
        # Explicitly connected ring + long-distance links; bounded degree.
        # Not the real Gossipsub membership protocol.
        offsets = (1, -1, 7, -7)
        return sorted({(i + d) % n for d in offsets} - {i})

    def advertise(origin, sequence):
        # Plumtree-inspired lazy announcements on bounded secondary edges.
        if args.mode != 'hybrid' and not (args.v4 and args.mode=='mesh'):
            return
        if args.v4 and args.mode=='mesh':
            candidates = sorted({(i + off)%n for off in (13,-13,23,-23)}-{i})
        else:
            candidates = mesh_neighbors()[:2]
        for peer in candidates:
            ip = known.get(peer)
            if ip:
                send({'t': 'a', 'i': i, 'src': origin, 's': sequence},
                     (ip, GROUP[1]), 'ihave_sent')

    def relay(origin, sequence):
        msg = {'t': 'p', 'i': origin, 's': sequence, 'k': TOPIC, 'v': PAYLOAD}
        if args.mode == 'multicast':
            if origin == i:
                send(msg, GROUP, 'data_sent')
        elif args.mode in ('tree', 'hybrid'):
            for peer in tree_children(origin):
                ip = known.get(peer)
                if ip:
                    send(msg, (ip, GROUP[1]), 'data_sent' if origin == i else 'data_forwarded')
        else:
            for peer in mesh_neighbors():
                ip = known.get(peer)
                if ip:
                    send(msg, (ip, GROUP[1]), 'data_sent' if origin == i else 'data_forwarded')
        advertise(origin, sequence)

    (workdir / f'ready-{i}').touch()
    while not (workdir / 'go').exists():
        time.sleep(.01)
    start = time.monotonic()
    discovery_time = None
    data_time = None
    first_data = None
    ready_at_publish = 0
    last_digest = 0
    last_nack = 0
    next_hello = rnd.uniform(0, .6)
    sent_orig = set()
    publ_at = args.discovery_seconds + rnd.uniform(.0, args.publish_spread)
    last_nack = -10.0
    startup_nack_offset = rnd.uniform(0, args.repair_interval)
    repair_start_at = args.discovery_seconds + args.publish_spread + m*args.publish_interval + .7 + startup_nack_offset
    if args.incremental_repair:
        repair_start_at=args.discovery_seconds + 1.5 + startup_nack_offset
    stop_at = args.discovery_seconds + args.timeout

    while not (workdir / 'stop').exists():
        elapsed = time.monotonic() - start

        if args.ablation!='no_hello' and elapsed >= next_hello:
            hello={'t':'h','i':i,'a':own_ip}
            if args.incremental_repair and i < publisher_count:
                hello['w']=len(sent_orig)
                hello['fin']=(len(sent_orig)==m)
            send(hello, GROUP, 'hello_sent')
            next_hello = elapsed + 1.6 + rnd.uniform(0, .5)

        if args.ablation!='no_anti_entropy' and elapsed - last_digest >= 1.2:
            # Robust membership anti-entropy: each round sends complete ID digest
            # to 4 peers, but never eagerly sends full metadata.
            peers = [j for j in known if j != i]
            for j in rnd.sample(peers, min(4, len(peers))):
                send({'t':'d','i':i,'ids':sorted(known)},
                     (known[j], GROUP[1]), 'digest_sent')
            last_digest = elapsed

        if discovery_time is None and len(known) == n:
            discovery_time = elapsed

        if i < publisher_count and elapsed >= publ_at and len(sent_orig) < m:
            if not sent_orig:
                ready_at_publish = len(known)
            seq = len(sent_orig)
            sent_orig.add(seq)
            received.add((i, seq))
            if args.incremental_repair:
                source_watermark[i]=len(sent_orig)
                if len(sent_orig)==m:
                    source_finished.add(i)
            relay(i, seq)
            publ_at += args.publish_interval
            if len(sent_orig)==m:
                (workdir/f'published-{i}').touch()

        # Explicit missing-data repair; discovery and data are independent.
        # First repair interval follows the last scheduled publish.
        if (elapsed > repair_start_at and elapsed-last_nack >= args.repair_interval):
            # A+/B+: NORM-inspired multicast feedback suppression; NOT NORM.
            suppressed={k:v for k,v in suppressed.items() if v>elapsed}
            # Bounded, per-origin selective requests; oldest last request first.
            # Aggregates missing sequence IDs; prevents the previous NACK storm.
            missing_sources = [src for src in known if src < publisher_count
                               and src != i and
                               any((src,seq) not in received for seq in range(
                                   min(m,source_watermark.get(src,0))
                                   if args.incremental_repair else m))]
            # Diversify the initial origin order across receivers to avoid a NACK herd.
            # Retry oldest/never-asked sources first. Independently rotate order per receiver.
            missing_sources.sort(key=lambda src: (request_last.get(src,-1),
                (src * 47 + i * 41 + args.seed * 53) % max(1,n)))
            for src in missing_sources[:args.repair_fanout]:
                # Incremental variant only requests samples proven published by
                # a data packet or publisher's advertised progress.
                limit=(min(m,source_watermark.get(src,0))
                       if args.incremental_repair else m)
                seqs=[seq for seq in range(limit) if (src,seq) not in received]
                if not seqs:
                    continue
                if args.v4:
                    unsuppressed=(seqs if args.ablation=='no_nack_suppression' else
                                  [seq for seq in seqs if suppressed.get((src,seq),-1)<elapsed])
                    if args.incremental_repair:
                        unsuppressed=unsuppressed[:args.nack_batch_limit]
                    if not unsuppressed:
                        stats['nack_suppressed']+=len(seqs)
                        continue
                    # Every subscriber sees the NACK, not only the origin.
                    # Random hold-down prevents simultaneous identical feedback.
                    send({'t':'q','i':i,'src':src,'seqs':unsuppressed}, GROUP, 'nack_sent')
                    if args.ablation!='no_nack_suppression':
                        for seq in unsuppressed:
                            suppressed[(src,seq)]=elapsed+0.45+rnd.random()*0.5
                else:
                    send({'t':'q','i':i,'src':src,'seqs':seqs},
                         (known[src], GROUP[1]), 'nack_sent')
                request_last[src]=elapsed
            last_nack = elapsed

        if (args.mode == 'hybrid' or (args.v4 and args.mode=='mesh')) and lazy_pending:
            due = [key for key,(ip,at) in lazy_pending.items()
                   if at <= elapsed and key not in received]
            for src,seq in due[:12]:
                ip,_ = lazy_pending[(src,seq)]
                send({'t':'w','i':i,'src':src,'s':seq},
                     (ip,GROUP[1]),'iwant_sent')
                lazy_pending[(src,seq)] = (ip,elapsed + 1.0 + rnd.random()*.2)

        for _ in range(120):
            if not select.select([sock],[],[],0)[0]:
                break
            try:
                raw,anc,_,address = sock.recvmsg(65535,64)
                for level,typ,cmsg in anc:
                    if level == socket.SOL_SOCKET and typ == SO_RXQ_OVFL and len(cmsg) >= 4:
                        rx_overflow_report = max(rx_overflow_report,
                            int.from_bytes(cmsg[:4], 'little'))
                item = json.loads(raw)
                stats['packets_received'] += 1
                typ = item.get('t')
                peer = item.get('i')
                if typ == 'h':
                    if isinstance(peer,int) and 0 <= peer < n:
                        known[peer] = address[0]
                        last_source_hello[peer] = elapsed
                        if args.incremental_repair and peer<publisher_count:
                            watermark=item.get('w')
                            if isinstance(watermark,int) and 0<=watermark<=m:
                                source_watermark[peer]=max(source_watermark.get(peer,0),watermark)
                                if watermark==m and item.get('fin') is True:
                                    source_finished.add(peer)
                elif typ == 'd':
                    if isinstance(peer,int) and 0 <= peer < n:
                        known[peer] = address[0]
                    other = set(item.get('ids',[]))
                    lacking = sorted(other - known.keys())[:80]
                    if lacking:
                        send({'t':'u','i':i,'ids':lacking},address,'delta_sent')
                    extras = [j for j in known if j not in other][:80]
                    if extras:
                        send({'t':'r','i':i,'pairs':[[j,known[j]] for j in extras]},
                             address, 'delta_sent')
                elif typ == 'u':
                    pairs = [[j,known[j]] for j in item.get('ids',[]) if j in known]
                    if pairs:
                        send({'t':'r','i':i,'pairs':pairs},address,'delta_sent')
                elif typ == 'r':
                    if isinstance(peer,int) and 0 <= peer < n:
                        known[peer] = address[0]
                    for j,ip in item.get('pairs',[]):
                        if isinstance(j,int) and 0 <= j < n and isinstance(ip,str):
                            known[j] = ip
                elif typ == 'a':
                    src, seq = item.get('src'), item.get('s')
                    if ((args.mode == 'hybrid' or (args.v4 and args.mode=='mesh'))
                        and isinstance(src,int) and isinstance(seq,int)
                        and 0 <= src < n and 0 <= seq < m
                        and (src,seq) not in received):
                        lazy_pending[(src,seq)] = (address[0],
                            elapsed + .12 + rnd.random()*.12)
                elif typ == 'w':
                    src, seq = item.get('src'), item.get('s')
                    if (args.mode == 'hybrid' or (args.v4 and args.mode=='mesh')) and (src,seq) in received:
                        send({'t':'p','i':src,'s':seq,'k':TOPIC,'v':PAYLOAD},
                             address,'repair_sent')
                elif typ == 'p':
                    src,seq = item.get('i'),item.get('s')
                    if (not isinstance(src,int) or not isinstance(seq,int)
                        or not 0 <= src < n or not 0 <= seq < m
                        or item.get('k') != TOPIC or item.get('v') != PAYLOAD):
                        continue
                    if first_data is None and src != i:
                        first_data = elapsed
                    key=(src,seq)
                    if args.incremental_repair:
                        source_watermark[src]=max(source_watermark.get(src,0),seq+1)
                    if key not in received:
                        received.add(key)
                        if args.peer_repair and src!=i and i in backup_peers(src,seq):
                            # Do not synthesize data from a sequence number.
                            peer_cache[key]=item['v']
                            if len(peer_cache)>args.peer_cache_limit:
                                oldest=next(iter(peer_cache))
                                peer_cache.pop(oldest)
                                pending_backup_acks.pop(oldest,None)
                                stats['peer_cache_evictions']+=1
                            ip=known.get(src)
                            if ip:
                                send({'t':'b','i':i,'src':src,'s':seq},
                                     (ip,GROUP[1]),'backup_ack_sent')
                                pending_backup_acks[key]=(elapsed+0.9+rnd.uniform(0,.4),1)
                        lazy_pending.pop(key, None)
                        if args.mode != 'multicast':
                            relay(src,seq)
                    else:
                        duplicate += 1
                    if args.peer_repair:
                        pending_peer_repairs.pop(key,None)
                elif typ == 'b':
                    src,seq=item.get('src'),item.get('s')
                    if (args.peer_repair and src==i and isinstance(seq,int)
                        and 0<=seq<m and isinstance(peer,int)
                        and peer in backup_peers(i,seq) and seq in sent_orig):
                        backup_acks.setdefault(seq,set()).add(peer)
                        stats['backup_ack_received']+=1
                        send({'t':'c','i':i,'src':i,'s':seq,'to':peer},
                             address,'backup_ack_confirm_sent')
                elif typ == 'c':
                    src,seq,to=item.get('src'),item.get('s'),item.get('to')
                    if (args.peer_repair and isinstance(src,int)
                        and isinstance(seq,int) and src==peer and to==i):
                        pending_backup_acks.pop((src,seq),None)
                        stats['backup_ack_confirm_recv']+=1
                elif typ == 'q':
                    src=item.get('src')
                    if args.v4 and isinstance(src,int) and 0<=src<n:
                        stats['nack_heard']+=1
                        for seq in item.get('seqs',[])[:m]:
                            if not isinstance(seq,int) or not 0<=seq<m:
                                continue
                            if args.ablation!='no_nack_suppression':
                                suppressed[(src,seq)]=max(suppressed.get((src,seq),0),elapsed+0.65+rnd.random()*.4)
                            key=(src,seq)
                            if (args.peer_repair and src!=i and key in peer_cache
                                and elapsed-last_source_hello.get(src,0)>=3.0
                                and key not in pending_peer_repairs and
                                elapsed-peer_repair_last.get(key,-10)>1.25):
                                rank=backup_peers(src,seq).index(i)
                                pending_peer_repairs[key]=elapsed+0.75+rank*0.25+rnd.uniform(0,.1)
                            if src == i and seq in sent_orig:
                                # Deduplicate NACKs across receivers and pace repair.
                                if (elapsed-source_repair_last.get(key,-10)>0.7
                                    and source_repair_count.get(key,0)<32):
                                    send({'t':'p','i':i,'s':seq,'k':TOPIC,'v':PAYLOAD},
                                         address if args.ablation=='unicast_repair' else GROUP,
                                         'repair_sent')
                                    source_repair_last[key]=elapsed
                                    source_repair_count[key]=source_repair_count.get(key,0)+1
                                else:
                                    stats['repair_suppressed']+=1
                    elif src == i:
                        for seq in item.get('seqs',[])[:m]:
                            if isinstance(seq,int) and seq in sent_orig:
                                send({'t':'p','i':i,'s':seq,'k':TOPIC,'v':PAYLOAD},
                                     address,'repair_sent')
            except (OSError,ValueError,TypeError,KeyError):
                continue

        if args.peer_repair and pending_backup_acks:
            # Confirmed replica retention, with bounded ACK retries.
            due=[key for key,(at,tries) in pending_backup_acks.items() if at<=elapsed]
            for key in due[:12]:
                at,tries=pending_backup_acks[key]
                if tries>=12 or key not in peer_cache:
                    pending_backup_acks.pop(key,None)
                    continue
                src,seq=key
                ip=known.get(src)
                if ip:
                    send({'t':'b','i':i,'src':src,'s':seq},(ip,GROUP[1]),'backup_ack_sent')
                pending_backup_acks[key]=(elapsed+1.1+rnd.uniform(0,.55),tries+1)
        if args.peer_repair and pending_peer_repairs:
            # Bounded repair work per loop, lower-ranked replicas wait longer.
            due=sorted((at,key) for key,at in pending_peer_repairs.items() if at<=elapsed)
            for _,key in due[:8]:
                payload=peer_cache.get(key)
                pending_peer_repairs.pop(key,None)
                if payload is not None:
                    src,seq=key
                    send({'t':'p','i':src,'s':seq,'k':TOPIC,'v':payload},GROUP,'peer_repairs_sent')
                    peer_repair_last[key]=elapsed
        if (args.peer_repair and i < publisher_count and len(sent_orig)==m
            and backup_durable_at is None and
            all(len(backup_acks.get(seq,set()))>=args.backup_quorum for seq in range(m))):
            backup_durable_at=elapsed
            (workdir/f'backed-{i}').touch()
        if args.v4 and i < publisher_count and len(sent_orig)==m:
            # Completion acknowledgments are local benchmark-only unless peer has read everything.
            pass
        if data_time is None and len(received) == publisher_count*m:
            data_time = elapsed
            (workdir / f'done-{i}').touch()
        if elapsed >= stop_at:
            break
        time.sleep(.004)

    expected = publisher_count*m
    end_udp_stats = udp_counters()
    missing_by_origin = []
    for origin in range(publisher_count):
        if origin == i:
            continue
        missing = [seq for seq in range(m) if (origin,seq) not in received]
        if missing:
            missing_by_origin.append({'origin':origin,'count':len(missing),
                                      'first_missing_sequence':missing[0]})
    (workdir / f'node-{i}.json').write_text(json.dumps({
        'id':i,'mode':args.mode,'v4':args.v4,'known_nodes':len(known),
        'payload_bytes':args.payload_bytes,'publish_interval_s':args.publish_interval,
        'missing_by_origin':missing_by_origin,
        'max_repairs_per_sequence':max(source_repair_count.values(),default=0),
        'samples_at_repair_limit':sum(v>=32 for v in source_repair_count.values()),
        'ablation':args.ablation,'sent_original':len(sent_orig),
        'peer_repair':args.peer_repair,'peer_cache_entries':len(peer_cache),
        'backup_acked_sequences':sum(len(backup_acks.get(seq,set()))>=args.backup_quorum for seq in range(m)) if i<publisher_count else 0,
        'backup_durable_at_s':backup_durable_at,
        'backup_ack_pending':len(pending_backup_acks),
        'incremental_repair':args.incremental_repair,'nack_batch_limit':args.nack_batch_limit,
        'watermarked_sources':len(source_watermark),
        'finished_sources':len(source_finished),
        'discovery_s':discovery_time,'ready_at_publish':ready_at_publish,
        'received':len(received),'expected':expected,
        'remote_received':len(received)-len(sent_orig),
        'remote_expected':(publisher_count-(1 if i < publisher_count else 0))*m,'duplicates':duplicate,
        'pubsub_complete_s':data_time,
        'first_data_s':first_data,'stats':stats,
        'socket_rx_overflow':rx_overflow_report,'send_errors':send_errors,
        'udp_rcvbuf_errors':end_udp_stats.get('RcvbufErrors',0)-start_udp_stats.get('RcvbufErrors',0),
        'udp_in_errors':end_udp_stats.get('InErrors',0)-start_udp_stats.get('InErrors',0),
        'cpu_s':time.process_time(),
        'maxrss_kb':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}))
    sock.close()

if __name__=='__main__':
    main()
