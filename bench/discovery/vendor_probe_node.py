#!/usr/bin/env python3
"""Comparable application-visible Pub/Sub threshold probe for Zenoh and Cyclone DDS.

Each namespace has one publisher and one subscriber on bench/all.  The common
barrier begins *before* middleware construction.  Presence beacons are sent
periodically; two data samples follow a fixed warmup and randomized spread.
The result distinguishes presence convergence from complete unique data delivery.
"""
import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import random
import resource
import time
import os

def main():
    a=argparse.ArgumentParser()
    a.add_argument('--backend', choices=['zenoh','cyclone'],required=True)
    a.add_argument('--id',type=int,required=True)
    a.add_argument('--count',type=int,required=True)
    a.add_argument('--messages',type=int,default=2)
    a.add_argument('--warmup',type=float,default=17)
    a.add_argument('--spread',type=float,default=4)
    a.add_argument('--timeout',type=float,default=45)
    a.add_argument('--seed',type=int,default=1)
    a.add_argument('--workdir',required=True)
    args=a.parse_args()
    i,n,m=args.id,args.count,args.messages
    wd=Path(args.workdir)
    rng=random.Random(args.seed*100019+i*991)
    known={i}
    delivered={(i,s) for s in range(m)}
    recv_count=0
    write_count=0
    invalid_count=0
    init_duration=None
    ready_at_publish=None
    discovered_at=None
    finished_at=None
    errors=[]
    session=None
    pub=None
    reader=None
    writer=None
    # A ready file indicates that Python has loaded; it does not imply DDS
    # endpoint discovery or a Zenoh session has opened.
    (wd/f'ready-{i}').touch()
    while not (wd/'go').exists():
        time.sleep(.01)
    start=time.monotonic()

    def receive(kind,src,seq):
        nonlocal recv_count, invalid_count
        if not isinstance(src,int) or not 0<=src<n:
            invalid_count+=1
            return
        if kind==0:
            known.add(src)
        elif kind==1 and isinstance(seq,int) and 0<=seq<m:
            delivered.add((src,seq))
            recv_count+=1
        else:
            invalid_count+=1

    try:
        t_init=time.monotonic()
        if args.backend=='zenoh':
            import zenoh
            config=zenoh.Config()
            session=zenoh.open(config)
            def cb(sample):
                nonlocal invalid_count
                try:
                    kind,src,seq=[int(v) for v in sample.payload.to_string().split(':')]
                    receive(kind,src,seq)
                except Exception:
                    invalid_count+=1
            sub=session.declare_subscriber('bench/fair/**',cb)
            def put(kind,seq):
                nonlocal write_count
                session.put(f'bench/fair/{i}',f'{kind}:{i}:{seq}')
                write_count+=1
        else:
            from cyclonedds.domain import DomainParticipant
            from cyclonedds.topic import Topic
            from cyclonedds.pub import DataWriter
            from cyclonedds.sub import DataReader
            from cyclonedds.idl import IdlStruct
            from cyclonedds.core import Qos
            from cyclonedds.qos import Policy
            from cyclonedds.util import duration
            @dataclass
            class FairMsg(IdlStruct):
                kind:int
                origin:int
                sequence:int
            qos=Qos(Policy.Reliability.Reliable(max_blocking_time=duration(seconds=1)),
                    Policy.History.KeepAll)
            dp=DomainParticipant(domain_id=55)
            topic=Topic(dp,'bench_fair',FairMsg)
            writer=DataWriter(dp,topic,qos=qos)
            reader=DataReader(dp,topic,qos=qos)
            def put(kind,seq):
                nonlocal write_count
                writer.write(FairMsg(kind=kind,origin=i,sequence=seq))
                write_count+=1
        init_duration=time.monotonic()-t_init
        next_hello=start + rng.uniform(.0,.4)
        pub_start=start+args.warmup+rng.uniform(0,args.spread)
        next_pub=pub_start
        published=0
        while time.monotonic()-start<args.timeout and not (wd/'stop').exists():
            now=time.monotonic()
            if now>=next_hello:
                try:
                    put(0,0)
                except Exception as exc:
                    errors.append(f'HELLO:{type(exc).__name__}:{exc}')
                next_hello=now+.75
            if now>=next_pub and published<m:
                if ready_at_publish is None:
                    ready_at_publish=len(known)
                try:
                    put(1,published)
                except Exception as exc:
                    errors.append(f'DATA:{type(exc).__name__}:{exc}')
                published+=1
                next_pub+=.22
            if args.backend=='cyclone':
                try:
                    for msg in reader.take(N=256):
                        receive(msg.kind,msg.origin,msg.sequence)
                except Exception as exc:
                    errors.append(f'READ:{type(exc).__name__}:{exc}')
            if discovered_at is None and len(known)==n:
                discovered_at=time.monotonic()-start
            if finished_at is None and len(delivered)==n*m:
                finished_at=time.monotonic()-start
                (wd/f'done-{i}').touch()
            time.sleep(.01)
    except Exception as exc:
        errors.append(f'FATAL:{type(exc).__name__}:{exc}')
    finally:
        report=dict(node=i,backend=args.backend,known=len(known),
                    discovered_s=discovered_at,unique_received=len(delivered),
                    expected=n*m,remote_received=len(delivered)-m,
                    remote_expected=(n-1)*m,complete_s=finished_at,
                    started_publishing_known=ready_at_publish,
                    init_s=init_duration,send_count=write_count,
                    callback_data_samples=recv_count,invalid_samples=invalid_count,
                    cpu_s=time.process_time(),
                    maxrss_kb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                    errors=errors[:12])
        (wd/f'node-{i}.json').write_text(json.dumps(report))
        if args.backend=='zenoh' and session is not None:
            try: session.close()
            except Exception: pass

if __name__=='__main__':
    main()
