#!/usr/bin/env python3
"""Experimental A+ v2 stream-aware bitmap-NACK and paced fair source repair.

Not NORM, not a durable/acknowledged PubSub protocol. Benchmark uses a finite
number of publisher samples to judge completeness, not for gap detection.
"""
import argparse
from collections import deque
import json
import random
import resource
import select
import socket
import time
from pathlib import Path

GROUP=('239.77.77.88',7702)
TOPIC='bench/all'
WINDOW=64

def main():
    p=argparse.ArgumentParser()
    for key in ('id','count','messages'):
        p.add_argument('--'+key,type=int,required=True)
    p.add_argument('--mode',default='multicast',choices=['multicast'])
    p.add_argument('--workdir',required=True)
    p.add_argument('--discovery-seconds',type=float,default=18)
    p.add_argument('--timeout',type=float,default=125)
    p.add_argument('--publish-spread',type=float,default=18)
    p.add_argument('--publishers',type=int,default=0)
    p.add_argument('--seed',type=int,default=1)
    p.add_argument('--repair-fanout',type=int,default=6)
    p.add_argument('--repair-interval',type=float,default=.9)
    p.add_argument('--publish-interval',type=float,default=.06)
    p.add_argument('--payload-bytes',type=int,default=128)
    p.add_argument('--ablation',default='full')
    p.add_argument('--v4',action='store_true')
    p.add_argument('--repair-pps',type=float,default=20)
    p.add_argument('--gap-grace',type=float,default=1.5)
    p.add_argument('--nack-suppress-seconds',type=float,default=2.0)
    p.add_argument('--repair-burst',type=float,default=6)
    p.add_argument('--nack-period',type=float,default=.8)
    args=p.parse_args()
    i,n,m=args.id,args.count,args.messages
    assert n>=2 and m>=1 and 1<=args.payload_bytes<=1200
    assert args.repair_pps>0 and args.nack_period>0
    pubn=args.publishers if args.publishers>0 else n
    own_ip=f'10.77.{i//250}.{i%250+1}'
    payload='x'*args.payload_bytes
    wd=Path(args.workdir)
    rng=random.Random(101987+71*i+args.seed*100003)
    known={i:own_ip}
    have=[set() for _ in range(n)]
    missing=[set() for _ in range(n)]
    watermark=[-1]*n
    done_marker=[False]*n
    seen=set()
    retained={}
    peer_suppression={}
    last_request={}
    source_q=deque()
    source_q_set=set()
    source_next={}
    repair_count={}
    duplicates=0
    send_errors=0
    socket_overflow=0
    stats=dict(hello_sent=0,digest_sent=0,delta_sent=0,
        data_sent=0,data_forwarded=0,progress_sent=0,
        end_sent=0,nack_sent=0,nack_suppressed=0,
        nack_heard=0,repair_sent=0,repair_deferred=0,
        packets_received=0,bitmap_bits_requested=0,
        bytes_sent=0,bytes_received=0)
    sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM,socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    sock.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,8*1024*1024)
    sock.setsockopt(socket.SOL_SOCKET,socket.SO_SNDBUF,4*1024*1024)
    sock.bind(('',GROUP[1]))
    sock.setsockopt(socket.IPPROTO_IP,socket.IP_ADD_MEMBERSHIP,
                    socket.inet_aton(GROUP[0])+socket.inet_aton(own_ip))
    sock.setsockopt(socket.IPPROTO_IP,socket.IP_MULTICAST_IF,socket.inet_aton(own_ip))
    sock.setsockopt(socket.IPPROTO_IP,socket.IP_MULTICAST_TTL,1)
    sock.setblocking(False)
    SO_RXQ_OVFL=40
    try:sock.setsockopt(socket.SOL_SOCKET,SO_RXQ_OVFL,1)
    except OSError:pass

    def udp_stats():
        try:
            lines=Path('/proc/net/snmp').read_text().splitlines()
            for a,b in zip(lines,lines[1:]):
                if a.startswith('Udp:') and b.startswith('Udp:'):
                    return {k:int(v) for k,v in zip(a.split()[1:],b.split()[1:])}
        except (OSError,ValueError):pass
        return {}
    udp_start=udp_stats()
    def send(item,destination,metric):
        nonlocal send_errors
        try:
            data=json.dumps(item,separators=(',',':')).encode()
            sock.sendto(data,destination)
            stats[metric]+=1
            stats['bytes_sent']+=len(data)
            return True
        except (OSError,ValueError):
            send_errors+=1
            return False

    def note_progress(src,upto):
        if not isinstance(src,int) or not 0<=src<pubn:
            return
        if not isinstance(upto,int) or upto<0 or upto>=m:
            return
        last=watermark[src]
        if upto>last:
            for seq in range(last+1,upto+1):
                if seq not in have[src]:
                    missing[src].add(seq)
                    # Hold gaps briefly: out-of-order packets are not losses.
                    peer_suppression[(src,seq)]=elapsed+args.gap_grace+rng.random()*.6
            watermark[src]=upto

    (wd/f'ready-{i}').touch()
    while not (wd/'go').exists():
        time.sleep(.01)
    start=time.monotonic()
    next_hello=rng.uniform(0,.6)
    next_digest=rng.uniform(.6,1.3)
    next_progress=1.0+rng.random()
    next_end=0.
    next_request=args.discovery_seconds+args.publish_spread*.25+rng.uniform(.2,1)
    next_repair=0.
    next_publish=args.discovery_seconds+rng.uniform(0,args.publish_spread)
    progress_mark=-1
    sent=0
    discovery_s=None
    complete_s=None
    first_data_s=None
    ready_at_publish=0
    next_cleanup=5.
    repair_tokens=args.repair_burst
    repair_token_at=0.
    request_cursor=i%n
    max_pending=0
    emitted_last_progress=-1

    while not (wd/'stop').exists():
        elapsed=time.monotonic()-start
        if elapsed>=next_hello and args.ablation!='no_hello':
            send({'t':'h','i':i,'a':own_ip},GROUP,'hello_sent')
            next_hello=elapsed+1.7+rng.uniform(0,.4)
        if elapsed>=next_digest and args.ablation!='no_anti_entropy':
            peers=[j for j in known if j!=i]
            for j in rng.sample(peers,min(4,len(peers))):
                send({'t':'d','i':i,'ids':sorted(known)},(known[j],GROUP[1]),'digest_sent')
            next_digest=elapsed+1.3+rng.uniform(0,.3)
        if discovery_s is None and len(known)==n:
            discovery_s=elapsed

        if i<pubn and sent<m and elapsed>=next_publish:
            if sent==0:ready_at_publish=len(known)
            seq=sent
            sample={'t':'p','i':i,'s':seq,'k':TOPIC,'v':payload}
            retained[seq]=sample
            have[i].add(seq)
            seen.add((i,seq))
            note_progress(i,seq)
            send(sample,GROUP,'data_sent')
            sent+=1
            next_publish+=args.publish_interval
            # Don't accumulate a giant catch-up burst if this process was stalled.
            if next_publish<elapsed-.2:
                next_publish=elapsed+args.publish_interval
            if sent==m:
                (wd/f'published-{i}').touch()
                next_end=elapsed+.02

        if i<pubn and elapsed>=next_progress:
            if sent>0:
                send({'t':'g','i':i,'s':sent-1,'end':sent==m},GROUP,'progress_sent')
                emitted_last_progress=sent-1
            next_progress=elapsed+.7+rng.random()*.45
        if i<pubn and sent==m and elapsed>=next_end:
            send({'t':'e','i':i,'s':m-1},GROUP,'end_sent')
            next_end=elapsed+1.25+rng.random()*.4

        # Source-owned paced retransmission queue: separate feedback capture from
        # sending, so incoming NACKs cannot cause an instantaneous replay storm.
        if elapsed>=next_repair and source_q:
            repair_tokens=min(args.repair_burst,repair_tokens+
                              args.repair_pps*max(0,elapsed-repair_token_at))
            repair_token_at=elapsed
            for _ in range(min(len(source_q),64)):
                if repair_tokens<1:break
                seq=source_q.popleft()
                source_q_set.discard(seq)
                if seq not in retained:continue
                if elapsed<source_next.get(seq,0):
                    source_q.append(seq);source_q_set.add(seq)
                    stats['repair_deferred']+=1
                    continue
                if send(retained[seq],GROUP,'repair_sent'):
                    repair_tokens-=1
                    source_next[seq]=elapsed+.65+rng.random()*.25
                    repair_count[seq]=repair_count.get(seq,0)+1
            next_repair=elapsed+.025
        elif not source_q:
            repair_token_at=elapsed

        # Fair round-robin selection of sources with missing sequence numbers;
        # bitmap compresses up to 64 sequence IDs into one multicast NACK.
        if elapsed>=next_request:
            selected=0
            for step in range(n):
                src=(request_cursor+step)%n
                if src>=pubn or src==i or not missing[src]:
                    continue
                valid=[s for s in sorted(missing[src])
                       if peer_suppression.get((src,s),0)<=elapsed]
                if not valid:
                    stats['nack_suppressed']+=1
                    continue
                first=valid[0]
                base=(first//WINDOW)*WINDOW
                bits=0
                for seq in valid:
                    if seq<base:continue
                    if seq>=base+WINDOW:break
                    bits |= 1<<(seq-base)
                if bits==0:continue
                if send({'t':'q','i':i,'src':src,'base':base,'bm':format(bits,'x')},
                        GROUP,'nack_sent'):
                    stats['bitmap_bits_requested']+=bits.bit_count()
                    for off in range(WINDOW):
                        if bits & (1<<off):
                            peer_suppression[(src,base+off)]=elapsed+args.nack_suppress_seconds+rng.random()*.4
                    last_request[src]=elapsed
                    selected+=1
                    if selected>=args.repair_fanout:
                        request_cursor=(src+1)%n
                        break
            next_request=elapsed+args.nack_period+rng.random()*.12

        # Receive more than old 120 datagrams per pass, but bound each batch
        # to guarantee repair and application publication scheduling.
        for _ in range(256):
            if not select.select([sock],[],[],0)[0]:
                break
            try:
                raw,anc,_,address=sock.recvmsg(8192,64)
                for lvl,typ,cmsg in anc:
                    if lvl==socket.SOL_SOCKET and typ==SO_RXQ_OVFL and len(cmsg)>=4:
                        socket_overflow=max(socket_overflow,int.from_bytes(cmsg[:4],'little'))
                stats['bytes_received']+=len(raw)
                item=json.loads(raw)
                stats['packets_received']+=1
                typ=item.get('t')
                peer=item.get('i')
                if typ=='h':
                    if isinstance(peer,int) and 0<=peer<n:
                        known[peer]=address[0]
                elif typ=='d':
                    if isinstance(peer,int) and 0<=peer<n:
                        known[peer]=address[0]
                    remote=set(item.get('ids',[]))
                    need=sorted(remote-known.keys())[:80]
                    if need:send({'t':'u','i':i,'ids':need},address,'delta_sent')
                    extra=[j for j in known if j not in remote][:80]
                    if extra:
                        send({'t':'r','i':i,'pairs':[[j,known[j]] for j in extra]},
                             address,'delta_sent')
                elif typ=='u':
                    pairs=[[j,known[j]] for j in item.get('ids',[]) if j in known]
                    if pairs:send({'t':'r','i':i,'pairs':pairs},address,'delta_sent')
                elif typ=='r':
                    if isinstance(peer,int) and 0<=peer<n:
                        known[peer]=address[0]
                    for j,ip in item.get('pairs',[]):
                        if isinstance(j,int) and 0<=j<n and isinstance(ip,str):
                            known[j]=ip
                elif typ in ('g','e'):
                    if isinstance(peer,int) and 0<=peer<pubn:
                        note_progress(peer,item.get('s'))
                        if typ=='e' or item.get('end'):
                            done_marker[peer]=True
                elif typ=='p':
                    src,seq=item.get('i'),item.get('s')
                    if (not isinstance(src,int) or not 0<=src<pubn or
                        not isinstance(seq,int) or not 0<=seq<m or
                        item.get('k')!=TOPIC or item.get('v')!=payload):
                        continue
                    if src!=i and first_data_s is None:first_data_s=elapsed
                    key=(src,seq)
                    if key in seen:
                        duplicates+=1
                    else:
                        seen.add(key)
                        have[src].add(seq)
                        note_progress(src,seq)
                        missing[src].discard(seq)
                        peer_suppression.pop((src,seq),None)
                elif typ=='q':
                    src,base=item.get('src'),item.get('base')
                    hx=item.get('bm')
                    if (not isinstance(src,int) or not 0<=src<pubn or
                        not isinstance(base,int) or base<0 or base>=m or
                        not isinstance(hx,str) or len(hx)>16):
                        continue
                    bits=int(hx,16)
                    stats['nack_heard']+=1
                    for off in range(WINDOW):
                        if bits & (1<<off):
                            seq=base+off
                            if seq>=m:continue
                            if args.ablation!='no_nack_suppression':
                                peer_suppression[(src,seq)]=max(
                                    peer_suppression.get((src,seq),0),
                                    elapsed+args.nack_suppress_seconds+rng.random()*.4)
                            if src==i and seq in retained and seq not in source_q_set:
                                source_q.append(seq)
                                source_q_set.add(seq)
                                max_pending=max(max_pending,len(source_q))
            except (OSError,ValueError,TypeError,KeyError,AttributeError):
                continue
        if elapsed>=next_cleanup:
            peer_suppression={k:v for k,v in peer_suppression.items() if v>=elapsed}
            next_cleanup=elapsed+5.

        if complete_s is None and len(seen)==pubn*m:
            complete_s=elapsed
            (wd/f'done-{i}').touch()
        if elapsed>=args.discovery_seconds+args.timeout:
            break
        time.sleep(.003)

    udp_end=udp_stats()
    unresolved={str(j):len(missing[j]) for j in range(pubn) if j!=i and missing[j]}
    # Missing-beacon gaps are reported separately: no application source-m progress
    # does NOT mean application data was necessarily delivered.
    rows=dict(id=i,mode=args.mode,version='AplusV2',
        known_nodes=len(known),discovery_s=discovery_s,
        ready_at_publish=ready_at_publish,received=len(seen),
        expected=pubn*m,remote_received=len(seen)-len(have[i]),
        remote_expected=(pubn-(1 if i<pubn else 0))*m,
        duplicates=duplicates,pubsub_complete_s=complete_s,
        first_data_s=first_data_s,stats=stats,
        sent_original=sent,reported_done_sources=sum(done_marker),
        gap_grace_s=args.gap_grace,nack_suppress_s=args.nack_suppress_seconds,
        source_repair_pps=args.repair_pps,
        missing_by_origin=unresolved,
        max_repairs_per_sequence=max(repair_count.values(),default=0),
        samples_at_repair_limit=0,
        repair_queue_max=max_pending,repair_queue_left=len(source_q),
        socket_rx_overflow=socket_overflow,send_errors=send_errors,
        udp_rcvbuf_errors=udp_end.get('RcvbufErrors',0)-udp_start.get('RcvbufErrors',0),
        udp_in_errors=udp_end.get('InErrors',0)-udp_start.get('InErrors',0),
        cpu_s=time.process_time(),
        maxrss_kb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    (wd/f'node-{i}.json').write_text(json.dumps(rows,separators=(',',':')))
    sock.close()

if __name__=='__main__':
    main()
