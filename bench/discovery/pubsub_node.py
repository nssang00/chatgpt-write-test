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
    ap.add_argument('--workdir', required=True)
    ap.add_argument('--discovery-seconds', type=float, default=9)
    ap.add_argument('--timeout', type=float, default=24)
    ap.add_argument('--messages', type=int, default=2)
    ap.add_argument('--publish-spread', type=float, default=3)
    ap.add_argument('--publishers', type=int, default=0)
    args = ap.parse_args()

    i, n, m = args.id, args.count, args.messages
    publisher_count = args.publishers if args.publishers > 0 else n
    workdir = Path(args.workdir)
    own_ip = f'10.77.{i // 250}.{i % 250 + 1}'
    rnd = random.Random(33550336 + i * 17)
    known = {i: own_ip}
    received = set()
    last_missing = set()
    lazy_pending = {}
    request_last = {}
    duplicate = 0
    stats = dict(hello_sent=0, digest_sent=0, delta_sent=0,
                 data_sent=0, data_forwarded=0, nack_sent=0,
                 repair_sent=0, packets_received=0,
                 ihave_sent=0, iwant_sent=0)
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

    def send(msg, address, kind):
        try:
            sock.sendto(json.dumps(msg, separators=(',', ':')).encode(), address)
            stats[kind] += 1
        except (OSError, ValueError):
            pass

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
        if args.mode != 'hybrid':
            return
        for peer in mesh_neighbors():
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
    stop_at = args.discovery_seconds + args.timeout

    while not (workdir / 'stop').exists():
        elapsed = time.monotonic() - start

        if elapsed >= next_hello:
            send({'t':'h','i':i,'a':own_ip}, GROUP, 'hello_sent')
            next_hello = elapsed + 1.6 + rnd.uniform(0, .5)

        if elapsed - last_digest >= 1.2:
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
            relay(i, seq)
            publ_at += .28

        # Explicit missing-data repair; discovery and data are independent.
        # First repair interval follows the last scheduled publish.
        if (elapsed > args.discovery_seconds + args.publish_spread +
              m*.28 + .6 and elapsed-last_nack >= .75):
            # Bounded, per-origin selective requests; oldest last request first.
            # Aggregates missing sequence IDs; prevents the previous NACK storm.
            missing_sources = [src for src in known if src < publisher_count and
                               any((src,seq) not in received for seq in range(m))
                               and src != i]
            missing_sources.sort(key=lambda src: request_last.get(src,-1))
            for src in missing_sources[:8]:
                seqs=[seq for seq in range(m) if (src,seq) not in received]
                send({'t':'q','i':i,'src':src,'seqs':seqs},
                     (known[src], GROUP[1]), 'nack_sent')
                request_last[src]=elapsed
            last_nack = elapsed

        if args.mode == 'hybrid' and lazy_pending:
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
                raw,address = sock.recvfrom(65535)
                item = json.loads(raw)
                stats['packets_received'] += 1
                typ = item.get('t')
                peer = item.get('i')
                if typ == 'h':
                    if isinstance(peer,int) and 0 <= peer < n:
                        known[peer] = address[0]
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
                    if (args.mode == 'hybrid'
                        and isinstance(src,int) and isinstance(seq,int)
                        and 0 <= src < n and 0 <= seq < m
                        and (src,seq) not in received):
                        lazy_pending[(src,seq)] = (address[0],
                            elapsed + .12 + rnd.random()*.12)
                elif typ == 'w':
                    src, seq = item.get('src'), item.get('s')
                    if args.mode == 'hybrid' and (src,seq) in received:
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
                    if key not in received:
                        received.add(key)
                        lazy_pending.pop(key, None)
                        if args.mode != 'multicast':
                            relay(src,seq)
                    else:
                        duplicate += 1
                elif typ == 'q':
                    src=item.get('src')
                    if src == i:
                        for seq in item.get('seqs',[])[:m]:
                            if isinstance(seq,int) and seq in sent_orig:
                                send({'t':'p','i':i,'s':seq,'k':TOPIC,'v':PAYLOAD},
                                     address,'repair_sent')
            except (OSError,ValueError,TypeError,KeyError):
                continue

        if data_time is None and len(received) == publisher_count*m:
            data_time = elapsed
            (workdir / f'done-{i}').touch()
        if elapsed >= stop_at:
            break
        time.sleep(.004)

    expected = publisher_count*m
    (workdir / f'node-{i}.json').write_text(json.dumps({
        'id':i,'mode':args.mode,'known_nodes':len(known),
        'discovery_s':discovery_time,'ready_at_publish':ready_at_publish,
        'received':len(received),'expected':expected,
        'remote_received':len(received)-len(sent_orig),
        'remote_expected':(publisher_count-(1 if i < publisher_count else 0))*m,'duplicates':duplicate,
        'pubsub_complete_s':data_time,
        'first_data_s':first_data,'stats':stats,
        'cpu_s':time.process_time(),
        'maxrss_kb':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}))
    sock.close()

if __name__=='__main__':
    main()
