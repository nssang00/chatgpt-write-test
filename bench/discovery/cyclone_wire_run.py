#!/usr/bin/env python3
"""Time-correlated Cyclone writer/reader data probe with optional tcpdump on veth."""
import argparse
import json
import re
from pathlib import Path
import subprocess
import sys
import time
from run import prepare, cleanup, counters, ns

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--nodes',type=int,default=10)
    ap.add_argument('--mode',choices=['default','spdp','data-multicast'],default='default')
    ap.add_argument('--seed',type=int,default=1)
    ap.add_argument('--duration',type=float,default=18)
    ap.add_argument('--capture',action='store_true')
    ap.add_argument('--output',default='cyclone-wire-results')
    a=ap.parse_args()
    wd=Path(a.output).resolve()
    wd.mkdir(parents=True,exist_ok=True)
    procs=[]
    captures=[]
    try:
        prepare(a.nodes)
        before=counters(a.nodes)
        for i in range(a.nodes):
            log=(wd/f'node-{i}.log').open('w')
            command=['ip','netns','exec',ns(i),sys.executable,
                     str(Path(__file__).resolve().parent/'cyclone_wire_node.py'),
                     '--id',str(i),'--nodes',str(a.nodes),'--mode',a.mode,
                     '--seed',str(a.seed),'--duration',str(a.duration),
                     '--workdir',str(wd)]
            proc=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
            log.close()
            procs.append(proc)
        # Every packet at two veth bridge ports; includes actual RTPS data and discovery.
        if a.capture:
            for i in (0,1):
                fname=wd/f'port-{i}.pcap'
                cap=subprocess.Popen(['tcpdump','-i',f'db{i:03d}h','-n',
                    '-s','256','-U','-w',str(fname),'udp'],
                    stdout=subprocess.DEVNULL,stderr=(wd/f'tcpdump-{i}.log').open('w'))
                captures.append(cap)
            time.sleep(.2)
        ready_deadline=time.monotonic()+25
        while time.monotonic()<ready_deadline:
            if len(list(wd.glob('ready-*')))==a.nodes or any(p.poll() is not None for p in procs):
                break
            time.sleep(.03)
        ready=len(list(wd.glob('ready-*')))
        if ready!=a.nodes:
            raise RuntimeError(f'ready={ready}/{a.nodes}')
        started=time.monotonic()
        (wd/'go').touch()
        while time.monotonic()-started < a.duration+2:
            if len(list(wd.glob('done-*')))==a.nodes:
                break
            if any(p.poll() is not None for p in procs):
                break
            time.sleep(.05)
        (wd/'stop').touch()
        for p in procs:
            try:p.wait(timeout=6)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        after=counters(a.nodes)
        nodes=[json.loads(f.read_text()) for f in wd.glob('node-*.json')]
        def max_complete(k):
            values=[node[k] for node in nodes]
            return max(values) if len(values)==a.nodes and all(v is not None for v in values) else None
        first_pub=[]
        for node in nodes:
            if node['writes']:
                first_pub.append(node['writes'][0][1])
        bad_sources=[]
        if len(nodes)==a.nodes:
            for src in range(a.nodes):
                received_by=[r['node'] for r in nodes if str(src) in r['earliest']]
                if len(received_by)<a.nodes:
                    bad_sources.append({'origin':src,'seen_by':len(received_by)})
        summary={
            'nodes':a.nodes,'mode':a.mode,'seed':a.seed,'capture':a.capture,
            'reports':len(nodes),'ready':ready,
            'full_participant_s':max_complete('participants_full_s'),
            'full_endpoints_s':max_complete('matches_full_s'),
            'full_app_s':max_complete('app_complete_s'),
            'app_completed_nodes':sum(node['distinct_sources']==a.nodes for node in nodes),
            'median_first_remote_s':sorted((x['first_remote_s'] for x in nodes if x['first_remote_s'] is not None))[len(nodes)//2] if all(x['first_remote_s'] is not None for x in nodes) and len(nodes)==a.nodes else None,
            'last_first_write_s':max(first_pub) if first_pub else None,
            'worst_writer_call_ms':max((x['max_write_ms'] for x in nodes),default=None),
            'slow_sources':bad_sources,'errors':sum(bool(node['errors']) for node in nodes),
            'wall_s':round(time.monotonic()-started,3)
        }
        summary.update({f'bridge_{k}':after[k]-before[k] for k in before})
        (wd/'summary.json').write_text(json.dumps(summary,indent=2))
        print('WIRE_RESULT '+json.dumps(summary),flush=True)
        print('WIRE_NODE_SUMMARY '+json.dumps([{
            'node':r['node'],'full_match':r['matches_full_s'],'first_remote':r['first_remote_s'],
            'app_complete':r['app_complete_s'],'writes':r['write_count'],
            'first_write':r['writes'][0] if r['writes'] else None,
            'max_write_ms':round(r['max_write_ms'],3),'sources':r['distinct_sources']} for r in nodes]),flush=True)
    except Exception as e:
        print('WIRE_ERROR '+repr(e),flush=True)
        raise
    finally:
        (wd/'stop').touch()
        for p in procs:
            if p.poll() is None:
                p.kill()
                p.wait()
        for c in captures:
            if c.poll() is None:
                c.terminate()
                try:c.wait(timeout=3)
                except subprocess.TimeoutExpired:c.kill()
        # Let tcpdump flush pcap before deleting interfaces.
        cleanup(a.nodes)

if __name__=='__main__':
    main()
