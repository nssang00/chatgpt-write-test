#!/usr/bin/env python3
"""Measure Cyclone DDS discovery/match vs actual writer and subscriber timing.

All clocks are Linux CLOCK_MONOTONIC and comparable across netns on the same host.
The time fields separate local user write calls from first receipt of remote data.
"""
import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import random
import resource
import time

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--id',type=int,required=True)
    p.add_argument('--nodes',type=int,required=True)
    p.add_argument('--mode',choices=['default','spdp','data-multicast'],default='default')
    p.add_argument('--duration',type=float,default=18)
    p.add_argument('--seed',type=int,default=1)
    p.add_argument('--workdir',required=True)
    p.add_argument('--internal-capture',action='store_true')
    p.add_argument('--history',choices=['default','last64','all'],default='default')
    p.add_argument('--keyed',action='store_true')
    a=p.parse_args()
    i,n=a.id,a.nodes
    wd=Path(a.workdir)
    rng=random.Random(2912411+a.seed*101+i*43)
    if a.mode!='default':
        allow='spdp' if a.mode=='spdp' else 'true'
        interface='<General><Interfaces><NetworkInterface name="eth0" multicast="true"/></Interfaces><AllowMulticast>'+allow+'</AllowMulticast></General>'
    else:
        interface=''
    tracefile=str(wd/f'cyclone-config-{i}.log')
    pcap_config=('<PacketCaptureFile>'+str(wd/f'cyclone-{i}.pcap')+'</PacketCaptureFile>') if a.internal_capture else ''
    os.environ['CYCLONEDDS_URI']=(
        '<CycloneDDS xmlns="https://cdds.io/config"><Domain id="any">'
        +interface+'<Tracing><Verbosity>config</Verbosity><OutputFile>'
        +tracefile+'</OutputFile>'+pcap_config+'</Tracing></Domain></CycloneDDS>')
    from cyclonedds.domain import DomainParticipant
    from cyclonedds.topic import Topic
    from cyclonedds.pub import DataWriter
    from cyclonedds.sub import DataReader
    from cyclonedds.builtin import BuiltinDataReader,BuiltinTopicDcpsParticipant
    from cyclonedds.idl import IdlStruct
    from cyclonedds.core import Qos
    from cyclonedds.qos import Policy
    if a.keyed:
        from cyclonedds.idl.annotations import keylist
        @dataclass
        @keylist(['origin'])
        class TraceDatum(IdlStruct):
            origin:int
            seq:int
            born_ns:int
    else:
        @dataclass
        class TraceDatum(IdlStruct):
            origin:int
            seq:int
            born_ns:int
    (wd/f'ready-{i}').touch()
    while not (wd/'go').exists():
        time.sleep(.005)
    start_ns=time.monotonic_ns()
    def secs(ns):return round((ns-start_ns)/1e9,6)
    errors=[]
    written=[]
    earliest={}
    first_sequence={}
    recv_total=0
    builtin_keys=set()
    match_full_at=None
    participants_full_at=None
    app_full_at=None
    first_remote_at=None
    timeline=[]
    blocked_write_max_ms=0
    try:
        dp=DomainParticipant(domain_id=55)
        topic=Topic(dp,'wire_diag_data',TraceDatum)
        writer=DataWriter(dp,topic)
        read_qos=(None if a.history=='default' else Qos(
            Policy.History.KeepAll if a.history=='all'
            else Policy.History.KeepLast(depth=64)))
        reader=DataReader(dp,topic,qos=read_qos)
        builtin=BuiltinDataReader(dp,BuiltinTopicDcpsParticipant)
        init_at=secs(time.monotonic_ns())
        next_pub=time.monotonic()+rng.uniform(.05,.20)
        next_stat=time.monotonic()
        seq=0
        while (time.monotonic_ns()-start_ns)/1e9<a.duration and not (wd/'stop').exists():
            now=time.monotonic()
            if now>=next_pub:
                stamp=time.monotonic_ns()
                try:
                    writer.write(TraceDatum(origin=i,seq=seq,born_ns=stamp))
                    end=time.monotonic_ns()
                    elapsed_ms=(end-stamp)/1e6
                    blocked_write_max_ms=max(blocked_write_max_ms,elapsed_ms)
                    written.append([seq,secs(stamp),round(elapsed_ms,4)])
                except Exception as e:
                    errors.append('write '+repr(e))
                seq+=1
                next_pub+=.5
            for item in reader.take(N=256):
                if not isinstance(item.origin,int) or not 0<=item.origin<n:
                    continue
                recv_total+=1
                if item.origin not in earliest:
                    recv_ns=time.monotonic_ns()
                    earliest[item.origin]={
                        'recv_s':secs(recv_ns),
                        'send_s':secs(item.born_ns),
                        'oneway_ms':round((recv_ns-item.born_ns)/1e6,3),
                        'seq':item.seq,
                    }
                    first_sequence[item.origin]=item.seq
                    if item.origin!=i and first_remote_at is None:
                        first_remote_at=secs(recv_ns)
            if now>=next_stat:
                try:
                    for sample in builtin.take(N=256):
                        builtin_keys.add(str(sample.key))
                except Exception as e:
                    errors.append('builtin '+repr(e))
                try:
                    reader_match=len(reader.get_matched_publications())
                    writer_match=len(writer.get_matched_subscriptions())
                except Exception as e:
                    errors.append('match '+repr(e))
                    reader_match=writer_match=0
                event={'t':secs(time.monotonic_ns()),'app':len(earliest),'participants':len(builtin_keys),'readers':reader_match,'writers':writer_match}
                timeline.append(event)
                if match_full_at is None and reader_match>=n and writer_match>=n:
                    match_full_at=event['t']
                if participants_full_at is None and len(builtin_keys)>=n:
                    participants_full_at=event['t']
                if app_full_at is None and len(earliest)>=n:
                    app_full_at=event['t']
                    (wd/f'done-{i}').touch()
                next_stat=now+.1
            time.sleep(.007)
        (wd/f'node-{i}.json').write_text(json.dumps({
            'node':i,'n':n,'mode':a.mode,'history':a.history,'keyed':a.keyed,'seed':a.seed,'initialized_s':init_at,
            'participants_full_s':participants_full_at,'matches_full_s':match_full_at,
            'first_remote_s':first_remote_at,'app_complete_s':app_full_at,
            'distinct_sources':len(earliest),'samples_taken':recv_total,
            'write_count':len(written),'max_write_ms':blocked_write_max_ms,
            'writes':written,'earliest':earliest,'timeline':timeline,
            'cpu_s':time.process_time(),
            'maxrss_kb':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'errors':errors[:30],
        },indent=2))
    except Exception as e:
        (wd/f'error-{i}.txt').write_text(repr(e))
        raise

if __name__=='__main__':
    main()
