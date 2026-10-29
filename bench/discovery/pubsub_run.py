#!/usr/bin/env python3
"""Actual netns Pub/Sub trial orchestration, using common network conditions."""
import argparse
import csv
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from run import prepare, netem, counters, cleanup, memory_available, ns

MODES=('multicast','tree','mesh','hybrid')

def execute(n,mode,loss,seconds,disc,m,out):
    wd=out/f'{mode}-n{n}-loss{loss:g}'
    wd.mkdir(parents=True,exist_ok=True)
    procs=[]
    try:
        for i in range(n):
            log=(wd/f'log-{i}.txt').open('w')
            p=subprocess.Popen(['ip','netns','exec',ns(i),sys.executable,
                str(Path(__file__).resolve().parent/'pubsub_node.py'),
                '--id',str(i),'--count',str(n),'--mode',mode,
                '--messages',str(m),'--discovery-seconds',str(disc),
                '--timeout',str(seconds),'--workdir',str(wd)],
                stdout=log,stderr=subprocess.STDOUT)
            log.close()
            procs.append(p)
        deadline=time.monotonic()+max(30,n*.3)
        while time.monotonic()<deadline:
            if len(list(wd.glob('ready-*')))==n or any(p.poll() is not None for p in procs):
                break
            time.sleep(.08)
        ready=len(list(wd.glob('ready-*')))
        if ready!=n:
            raise RuntimeError(f'only {ready}/{n} nodes ready; inspect logs')
        before=counters(n)
        started=time.monotonic()
        (wd/'go').touch()
        while time.monotonic()-started < (disc+seconds+3):
            if len(list(wd.glob('done-*')))==n:
                break
            if any(p.poll() is not None for p in procs):
                break
            time.sleep(.08)
        (wd/'stop').touch()
        for p in procs:
            try:
                p.wait(timeout=8)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        after=counters(n)
        rows=[]
        for f in wd.glob('node-*.json'):
            rows.append(json.loads(f.read_text()))
        expected=n
        if len(rows)!=n:
            print(f'WARN {len(rows)}/{n} reports',flush=True)
        everyone=all(r['remote_received']==r['remote_expected'] for r in rows) and len(rows)==n
        full_disc=all(r['known_nodes']==n for r in rows) and len(rows)==n
        first_pub=disc
        result={'mode':mode,'nodes':n,'loss_percent_per_direction':loss,
            'reported':len(rows),'discovery_success':full_disc,
            'fully_discovered_nodes':sum(r['known_nodes']==n for r in rows),
            'pubsub_success':everyone,
            'fully_delivered_nodes':sum(r['remote_received']==r['remote_expected'] for r in rows),
            'total_expected_remote':sum(r['remote_expected'] for r in rows),
            'total_delivered_remote':sum(r['remote_received'] for r in rows),
            'remote_delivery_rate':round(sum(r['remote_received'] for r in rows)/
              max(1,sum(r['remote_expected'] for r in rows)),6),
            'pubsub_all_complete_after_pub_s':round(max(
                (r['pubsub_complete_s'] or 0) for r in rows)-first_pub,3) if everyone else None,
            'discovery_all_complete_s':round(max(
                (r['discovery_s'] or 0) for r in rows),3) if full_disc else None,
            'minimum_known':min((r['known_nodes'] for r in rows),default=0),
            'total_duplicate_deliveries':sum(r['duplicates'] for r in rows),
            'total_nacks':sum(r['stats']['nack_sent'] for r in rows),
            'total_repairs':sum(r['stats']['repair_sent'] for r in rows),
            'total_ihave':sum(r['stats']['ihave_sent'] for r in rows),
            'total_iwant':sum(r['stats']['iwant_sent'] for r in rows),
            'total_control_packets':sum(r['stats']['hello_sent']+r['stats']['digest_sent']+
                                        r['stats']['delta_sent']+r['stats']['ihave_sent']+
                                        r['stats']['iwant_sent'] for r in rows),
            'total_data_packets':sum(r['stats']['data_sent']+r['stats']['data_forwarded'] for r in rows),
            'aggregate_cpu_s':round(sum(r['cpu_s'] for r in rows),3),
            'aggregate_maxrss_mb':round(sum(r['maxrss_kb'] for r in rows)/1024,1),
            'seconds_observed':round(time.monotonic()-started,3)}
        result.update({f'bridge_{k}':after[k]-before[k] for k in before})
        (wd/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
        return result
    finally:
        (wd/'stop').touch()
        for p in procs:
            if p.poll() is None:
                p.kill()
                p.wait()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--sizes',default='30,100')
    ap.add_argument('--modes',default='multicast,tree,mesh')
    ap.add_argument('--losses',default='0,10')
    ap.add_argument('--discovery',type=float,default=9)
    ap.add_argument('--timeout',type=float,default=24)
    ap.add_argument('--messages',type=int,default=2)
    ap.add_argument('--output',default='pubsub-results')
    args=ap.parse_args()
    if os.geteuid()!=0:
        raise SystemExit('root needed for network namespaces')
    out=Path(args.output).resolve()
    out.mkdir(parents=True,exist_ok=True)
    results=[]
    for n in [int(x) for x in args.sizes.split(',')]:
        avail=memory_available()
        if avail is not None and avail < n*17*1024*1024 + 650*1024*1024:
            results.append({'nodes':n,'status':'SKIP','reason':'memory safety guard',
                            'available_bytes':avail})
            continue
        try:
            prepare(n)
        except Exception as exc:
            results.append({'nodes':n,'status':'ERROR','reason':str(exc)})
            cleanup(n)
            continue
        try:
            for loss in [float(x) for x in args.losses.split(',')]:
                netem(n,loss)
                for mode in args.modes.split(','):
                    print(f'START n={n} mode={mode} loss={loss}%',flush=True)
                    try:
                        r=execute(n,mode,loss,args.timeout,args.discovery,args.messages,out)
                        r['status']='PASS' if r['pubsub_success'] and r['discovery_success'] else 'FAIL'
                    except Exception as exc:
                        r={'nodes':n,'mode':mode,'loss_percent_per_direction':loss,
                           'status':'ERROR','reason':str(exc)}
                    results.append(r)
                    print('RESULT '+json.dumps(r),flush=True)
        finally:
            cleanup(n)
    (out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    keys=['mode','nodes','loss_percent_per_direction','status','discovery_success',
          'pubsub_success','fully_delivered_nodes','remote_delivery_rate',
          'pubsub_all_complete_after_pub_s','discovery_all_complete_s','total_nacks',
          'total_repairs','bridge_rx_bytes','bridge_tx_bytes','aggregate_cpu_s','reason']
    with (out/'results.csv').open('w',newline='') as fh:
        w=csv.DictWriter(fh,fieldnames=keys,extrasaction='ignore')
        w.writeheader()
        w.writerows(results)
    print('RESULTS_JSON='+str(out/'results.json'),flush=True)

if __name__=='__main__':
    main()
