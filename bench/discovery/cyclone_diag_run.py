#!/usr/bin/env python3
"""One isolated runner per Cyclone diagnostic variant."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
from run import prepare,cleanup,counters,ns

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--nodes',type=int,default=10)
    p.add_argument('--batch',type=int,default=1)
    p.add_argument('--config',choices=['default','eth0','eth0-fastspdp','auto-fastspdp','eth0-multicast','eth0-250ms'],default='default')
    p.add_argument('--timeout',type=float,default=30)
    p.add_argument('--seed',type=int,default=1)
    p.add_argument('--output',default='cyclone-diag-results')
    a=p.parse_args()
    wd=Path(a.output).resolve()
    wd.mkdir(parents=True,exist_ok=True)
    procs=[]
    try:
        prepare(a.nodes)
        for i in range(a.nodes):
            f=(wd/f'log-{i}.txt').open('w')
            proc=subprocess.Popen(['ip','netns','exec',ns(i),sys.executable,
                str(Path(__file__).resolve().parent/'cyclone_diag_node.py'),
                '--id',str(i),'--count',str(a.nodes),'--batch',str(a.batch),
                '--config',a.config,'--seed',str(a.seed),'--timeout',str(a.timeout),
                '--workdir',str(wd)],stdout=f,stderr=subprocess.STDOUT)
            f.close()
            procs.append(proc)
        deadline=time.monotonic()+max(30,a.nodes*.35)
        while time.monotonic()<deadline:
            if len(list(wd.glob('ready-*')))==a.nodes or any(x.poll() is not None for x in procs):
                break
            time.sleep(.05)
        ready=len(list(wd.glob('ready-*')))
        if ready!=a.nodes:
            raise RuntimeError(f'Only {ready}/{a.nodes} Python processes ready')
        before=counters(a.nodes)
        start=time.monotonic()
        (wd/'go').touch()
        while time.monotonic()-start < a.timeout+2:
            if len(list(wd.glob('done-*')))==a.nodes:
                break
            if any(x.poll() is not None for x in procs):
                break
            time.sleep(.08)
        (wd/'stop').touch()
        for p in procs:
            try:p.wait(timeout=7)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        after=counters(a.nodes)
        rows=[json.loads(f.read_text()) for f in wd.glob('node-*.json')]
        def maxfull(k):
            v=[r[k] for r in rows]
            return round(max(v),3) if len(v)==a.nodes and all(x is not None for x in v) else None
        def med(k):
            v=sorted(r[k] for r in rows if r[k] is not None)
            return round(v[len(v)//2],3) if v else None
        report={'nodes':a.nodes,'config':a.config,'take_batch':a.batch,
            'ready':ready,'reported':len(rows),
            'app_complete_nodes':sum(r['app_known']==a.nodes for r in rows),
            'full_app_s':maxfull('app_full_s'),
            'median_app_s':med('app_full_s'),
            'full_participant_s':maxfull('participant_full_s'),
            'full_reader_match_s':maxfull('reader_match_full_s'),
            'full_writer_match_s':maxfull('writer_match_full_s'),
            'median_init_s':med('init_s'),
            'first_remote_s':med('app_first_remote_s'),
            'sample_receive_total':sum(r['received_samples'] for r in rows),
            'sent_total':sum(r['sent_samples'] for r in rows),
            'errors':sum(bool(r['errors']) for r in rows),
            'observed_wall_s':round(time.monotonic()-start,3)}
        report.update({f'bridge_{k}':after[k]-before[k] for k in before})
        (wd/'summary.json').write_text(json.dumps(report,indent=2)+'\n')
        print('DIAG_RESULT '+json.dumps(report),flush=True)
        for r in rows:
            print('DIAG_NODE '+json.dumps({k:r[k] for k in (
              'id','app_known','app_full_s','init_s','participant_count',
              'participant_full_s','matched_read','reader_match_full_s',
              'matched_write','writer_match_full_s','received_samples',
              'sent_samples')}),flush=True)
    except Exception as e:
        print('DIAG_ERROR '+repr(e),flush=True)
        raise
    finally:
        (wd/'stop').touch()
        for p in procs:
            if p.poll() is None:
                p.kill()
                p.wait()
        cleanup(a.nodes)

if __name__=='__main__':
    main()
