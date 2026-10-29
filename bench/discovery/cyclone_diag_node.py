#!/usr/bin/env python3
"""Disentangle Cyclone SPDP/SEDP match from application receive lag (diagnostic only)."""
import argparse
import json
import os
import random
import resource
import time
from dataclasses import dataclass
from pathlib import Path

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--id',type=int,required=True)
    ap.add_argument('--count',type=int,required=True)
    ap.add_argument('--batch',type=int,default=1)
    ap.add_argument('--config',choices=['default','eth0','eth0-fastspdp','auto-fastspdp','eth0-multicast','eth0-250ms'],default='default')
    ap.add_argument('--workdir',required=True)
    ap.add_argument('--timeout',type=float,default=30)
    ap.add_argument('--seed',type=int,default=1)
    a=ap.parse_args()
    if a.config!='default':
        disc = ('<SPDPInterval>250ms</SPDPInterval>' if a.config=='eth0-250ms'
                else '<SPDPInterval>1s</SPDPInterval>' if a.config in
                ('eth0-fastspdp','auto-fastspdp') else '')
        iface = '' if a.config=='auto-fastspdp' else (
            '<General><Interfaces><NetworkInterface name="eth0" multicast="true"/>'
            '</Interfaces><AllowMulticast>' +
            ('true' if a.config=='eth0-multicast' else 'spdp') +
            '</AllowMulticast></General>')
        os.environ['CYCLONEDDS_URI']=(
            '<CycloneDDS xmlns="https://cdds.io/config"><Domain id="any">'
            +iface+f'<Discovery>{disc}</Discovery></Domain></CycloneDDS>')
    from cyclonedds.domain import DomainParticipant
    from cyclonedds.topic import Topic
    from cyclonedds.pub import DataWriter
    from cyclonedds.sub import DataReader
    from cyclonedds.idl import IdlStruct
    from cyclonedds.builtin import BuiltinDataReader,BuiltinTopicDcpsParticipant
    @dataclass
    class Presence(IdlStruct):
        origin:int
        sequence:int
    i,n=a.id,a.count
    rng=random.Random(a.seed*100003+i*31)
    wd=Path(a.workdir)
    known={i}
    app_first={}
    participant_keys=set()
    participant_first=0
    matched_read=0
    matched_write=0
    t_participant_all=None
    t_reader_matched_all=None
    t_writer_matched_all=None
    t_app_full=None
    t_app_first=None
    t_init=None
    taken=0
    sent=0
    errors=[]
    timeline=[]
    dp=None
    try:
        (wd/f'ready-{i}').touch()
        while not (wd/'go').exists():
            time.sleep(.009)
        start=time.monotonic()
        dp=DomainParticipant(domain_id=55)
        topic=Topic(dp,'bench_diag_55',Presence)
        writer=DataWriter(dp,topic)
        reader=DataReader(dp,topic)
        builtin=BuiltinDataReader(dp,BuiltinTopicDcpsParticipant)
        t_init=time.monotonic()-start
        next_pub=time.monotonic()+rng.uniform(0,.25)
        next_check=0
        seq=0
        while time.monotonic()-start<a.timeout and not (wd/'stop').exists():
            now=time.monotonic()-start
            if time.monotonic()>=next_pub:
                writer.write(Presence(origin=i,sequence=seq))
                seq+=1
                sent+=1
                next_pub=time.monotonic()+.7
            for v in reader.take(N=a.batch):
                if isinstance(v.origin,int) and 0<=v.origin<n:
                    if v.origin not in app_first:
                        app_first[v.origin]=now
                        if v.origin!=i and t_app_first is None:t_app_first=now
                    known.add(v.origin)
                    taken+=1
            if now>=next_check:
                for v in builtin.take(N=256):
                    try:participant_keys.add(str(v.key))
                    except Exception as e:errors.append('builtin-key '+repr(e))
                try:
                    matched_read=len(reader.get_matched_publications())
                    matched_write=len(writer.get_matched_subscriptions())
                except Exception as e:
                    errors.append('matched-'+str(e))
                if t_participant_all is None and len(participant_keys)>=n:
                    t_participant_all=now
                if t_reader_matched_all is None and matched_read>=n:
                    t_reader_matched_all=now
                if t_writer_matched_all is None and matched_write>=n:
                    t_writer_matched_all=now
                if t_app_full is None and len(known)==n:
                    t_app_full=now
                    (wd/f'done-{i}').touch()
                if len(timeline)<200:
                    timeline.append({'t':round(now,3),'app':len(known),
                                     'participants':len(participant_keys),
                                     'matched_read':matched_read,
                                     'matched_write':matched_write})
                next_check=now+.125
            time.sleep(.012)
        report={
            'id':i,'config':a.config,'batch':a.batch,'count':n,
            'init_s':t_init,'participant_full_s':t_participant_all,
            'reader_match_full_s':t_reader_matched_all,
            'writer_match_full_s':t_writer_matched_all,
            'app_first_remote_s':t_app_first,'app_full_s':t_app_full,
            'app_known':len(known),'participant_count':len(participant_keys),
            'matched_read':matched_read,'matched_write':matched_write,
            'app_first_timestamps':app_first,'received_samples':taken,
            'sent_samples':sent,'timeline':timeline,
            'cpu_s':time.process_time(),
            'maxrss_kb':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'errors':errors[:20]}
        (wd/f'node-{i}.json').write_text(json.dumps(report))
    except Exception as e:
        (wd/f'error-{i}.txt').write_text(repr(e))
        raise

if __name__=='__main__':
    main()
