#!/usr/bin/env python3
"""Cyclone DDS SPDP participant / SEDP endpoint-only benchmark.

No application data is written.  All nodes create exactly one participant,
one DataWriter and one DataReader on an otherwise idle Topic.  The built-in
participant stream and matched endpoint handles are measured separately.
"""
import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import resource
import time

def udp_stats():
    try:
        lines=Path('/proc/net/snmp').read_text().splitlines()
        for idx in range(len(lines)-1):
            if lines[idx].startswith('Udp:') and lines[idx+1].startswith('Udp:'):
                return {k:int(v) for k,v in zip(lines[idx].split()[1:],lines[idx+1].split()[1:])}
    except (OSError, ValueError):
        pass
    return {}

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--id',type=int,required=True)
    p.add_argument('--count',type=int,required=True)
    p.add_argument('--workdir',required=True)
    p.add_argument('--config',choices=['default','eth0','spdp-only','lease60','spdp1s','lease60-spdp1s','resp500ms','resp1s','resp2s'],default='default')
    p.add_argument('--seed',type=int,default=1)
    p.add_argument('--timeout',type=float,default=25)
    p.add_argument('--trace',action='store_true')
    p.add_argument('--join-spread-ms',type=float,default=0.0)
    a=p.parse_args()
    wd=Path(a.workdir)
    if a.config!='default' or a.trace:
        iface=('' if a.config not in ('eth0','spdp-only') else
            '<General><Interfaces><NetworkInterface name="eth0" multicast="true"/>'
            '</Interfaces><AllowMulticast>'+('spdp' if a.config=='spdp-only' else 'true')+
            '</AllowMulticast></General>')
        lease=('<LeaseDuration>60s</LeaseDuration>' if 'lease60' in a.config else '')
        spdp=('<SPDPInterval>1s</SPDPInterval>' if 'spdp1s' in a.config else '')
        discovery=('<Discovery>'+lease+spdp+'</Discovery>') if lease or spdp else ''
        resp=({'resp500ms':'500ms','resp1s':'1s','resp2s':'2s'}.get(a.config))
        internal=('<Internal><SPDPResponseMaxDelay>'+resp+
                  '</SPDPResponseMaxDelay></Internal>') if resp else ''
        trace=('<Tracing><Verbosity>fine</Verbosity><OutputFile>'+
              str(wd/f'dds-trace-{a.id}.log')+'</OutputFile></Tracing>') if a.trace else ''
        os.environ['CYCLONEDDS_URI']=(
            '<CycloneDDS xmlns="https://cdds.io/config"><Domain id="any">'+
            iface+discovery+internal+trace+'</Domain></CycloneDDS>')
    # Imports complete before the common barrier; DDS entities created after it.
    from cyclonedds.domain import DomainParticipant
    from cyclonedds.topic import Topic
    from cyclonedds.pub import DataWriter
    from cyclonedds.sub import DataReader
    from cyclonedds.idl import IdlStruct
    from cyclonedds.builtin import BuiltinDataReader,BuiltinTopicDcpsParticipant

    @dataclass
    class IdleSample(IdlStruct):
        sequence:int

    (wd/f'ready-{a.id}').touch()
    while not (wd/'go').exists():
        time.sleep(.005)
    start=time.monotonic()
    if a.join_spread_ms>0:
        # Stagger DDS participant creation while keeping one global measurement clock.
        slot=(a.id*37+a.seed*19)%a.count
        time.sleep((slot/max(1,a.count-1))*a.join_spread_ms/1000.0)
    begin_udp=udp_stats()
    first_participant={}
    participant_keys=set()
    matched_read=0
    matched_write=0
    init_s=None
    participant_full_s=None
    readers_full_s=None
    writers_full_s=None
    all_full_s=None
    errors=[]
    transient_errors={'builtin':0,'matched_read':0,'matched_write':0}
    transient_samples=[]
    timeline=[]
    polls=0
    try:
        dp=DomainParticipant(domain_id=55)
        topic=Topic(dp,'discovery_only_topic',IdleSample)
        reader=DataReader(dp,topic)
        writer=DataWriter(dp,topic)
        builtin=BuiltinDataReader(dp,BuiltinTopicDcpsParticipant)
        init_s=time.monotonic()-start

        while time.monotonic()-start<a.timeout and not (wd/'stop').exists():
            now=time.monotonic()-start
            # Built-in SPDP samples (including self, as observed in prior runs).
            try:
                for item in builtin.take(N=256):
                    k=str(item.key)
                    if k not in participant_keys:
                        participant_keys.add(k)
                        first_participant[k]=round(now,6)
            except (IndexError,ValueError,RuntimeError) as e:
                transient_errors['builtin']+=1
                if len(transient_samples)<10:
                    transient_samples.append(['builtin',round(now,4),repr(e)])
            try:
                matched_read=len(reader.get_matched_publications())
            except (IndexError,ValueError,RuntimeError) as e:
                transient_errors['matched_read']+=1
                if len(transient_samples)<10:
                    transient_samples.append(['matched_read',round(now,4),repr(e)])
            try:
                matched_write=len(writer.get_matched_subscriptions())
            except (IndexError,ValueError,RuntimeError) as e:
                transient_errors['matched_write']+=1
                if len(transient_samples)<10:
                    transient_samples.append(['matched_write',round(now,4),repr(e)])
            polls+=1
            if len(participant_keys)>=a.count and participant_full_s is None:
                participant_full_s=now
            if matched_read>=a.count and readers_full_s is None:
                readers_full_s=now
            if matched_write>=a.count and writers_full_s is None:
                writers_full_s=now
            if (participant_full_s is not None and readers_full_s is not None
                and writers_full_s is not None and all_full_s is None):
                all_full_s=now
                (wd/f'done-{a.id}').touch()
            if len(timeline)<800:
                timeline.append([round(now,4),len(participant_keys),matched_read,matched_write])
            time.sleep(.035)
    except Exception as e:
        errors.append(type(e).__name__+': '+str(e))
        (wd/f'error-{a.id}.txt').write_text(repr(e))
    end_udp=udp_stats()
    results={
        'node':a.id,'count':a.count,'config':a.config,'seed':a.seed,
        'join_spread_ms':a.join_spread_ms,
        'init_s':init_s,'participant_full_s':participant_full_s,
        'reader_full_s':readers_full_s,'writer_full_s':writers_full_s,
        'all_full_s':all_full_s,'participant_count':len(participant_keys),
        'participant_keys':sorted(participant_keys),
        'participant_first_seen':first_participant,
        'matched_publications':matched_read,'matched_subscriptions':matched_write,
        'polls':polls,'user_data_sent':0,
        'timeline':timeline,'errors':errors,
        'transient_errors':transient_errors,'transient_samples':transient_samples,
        'cpu_s':round(time.process_time(),3),
        'maxrss_kb':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        'udp_rcvbuf_errors':end_udp.get('RcvbufErrors',0)-begin_udp.get('RcvbufErrors',0),
        'udp_in_errors':end_udp.get('InErrors',0)-begin_udp.get('InErrors',0)
    }
    (wd/f'node-{a.id}.json').write_text(json.dumps(results,indent=2))
    if errors:
        raise SystemExit(1)

if __name__=='__main__':
    main()
