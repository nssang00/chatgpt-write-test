#!/usr/bin/env python3
"""Per-run matched Zenoh/Cyclone threshold finder on GitHub Linux runners."""
import argparse
import csv
import json
from pathlib import Path
import re
import subprocess
import sys
import time

from run import prepare,cleanup,counters,ns,sh

def apply_netem(n, loss):
    # Equal base delay for all network modes and both directions.
    for i in range(n):
        for root in (True,False):
            cmd=[] if root else ['ip','netns','exec',ns(i)]
            dev=f'db{i:03d}h' if root else 'eth0'
            sh(*(cmd+['tc','qdisc','del','dev',dev,'root']),check=False)
            opts=['netem','delay','2ms']
            if loss:
                opts+=['loss',f'{loss}%']
            sh(*(cmd+['tc','qdisc','add','dev',dev,'root']+opts))

def drops(n):
    total=0
    for i in range(n):
        p=subprocess.run(['tc','-s','qdisc','show','dev',f'db{i:03d}h'],
            capture_output=True,text=True)
        total+=sum(int(x) for x in re.findall(r'dropped\s+(\d+)',p.stdout))
    return total

def exercise(a,out):
    n=a.nodes
    wd=out/f'{a.backend}-n{n}-loss{a.loss:g}-seed{a.seed}'
    wd.mkdir(parents=True,exist_ok=True)
    procs=[]
    try:
        for i in range(n):
            log=open(wd/f'log-{i}.txt','w')
            p=subprocess.Popen(['ip','netns','exec',ns(i),sys.executable,
                str(Path(__file__).resolve().parent/'vendor_probe_node.py'),
                '--backend',a.backend,'--id',str(i),'--count',str(n),
                '--messages',str(a.messages),'--warmup',str(a.warmup),
                '--spread',str(a.spread),'--timeout',str(a.timeout),
                '--seed',str(a.seed),'--workdir',str(wd)],stdout=log,
                stderr=subprocess.STDOUT)
            log.close()
            procs.append(p)
        limit=time.monotonic()+max(35,n*.32)
        while time.monotonic()<limit:
            if len(list(wd.glob('ready-*')))==n or any(p.poll() is not None for p in procs):
                break
            time.sleep(.05)
        ready=len(list(wd.glob('ready-*')))
        if ready!=n:
            raise RuntimeError(f'only {ready}/{n} nodes ready')
        before=counters(n)
        before_drop=drops(n)
        start=time.monotonic()
        (wd/'go').touch()
        while time.monotonic()-start<a.timeout+3:
            if len(list(wd.glob('done-*')))==n:
                break
            if any(p.poll() is not None for p in procs):
                break
            time.sleep(.08)
        (wd/'stop').touch()
        for p in procs:
            try: p.wait(timeout=7)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        after=counters(n)
        node_rows=[json.loads(f.read_text()) for f in wd.glob('node-*.json')]
        presence=sum(x['known']==n for x in node_rows)
        full_data=sum(x['remote_received']==x['remote_expected'] for x in node_rows)
        strict=(len(node_rows)==n and presence==n and full_data==n
                and not any(x['errors'] for x in node_rows))
        present_times=[x['discovered_s'] for x in node_rows if x['discovered_s'] is not None]
        complete_times=[x['complete_s'] for x in node_rows if x['complete_s'] is not None]
        result={'backend':a.backend,'nodes':n,'loss_pct_each_direction':a.loss,
            'seed':a.seed,'reports':len(node_rows),'ready':ready,
            'strict_success':strict,'presence_converged_nodes':presence,
            'data_complete_nodes':full_data,
            'presence_all_s':round(max(present_times),3) if presence==n else None,
            'data_all_s':round(max(complete_times),3) if full_data==n else None,
            'remote_received':sum(x['remote_received'] for x in node_rows),
            'remote_expected':sum(x['remote_expected'] for x in node_rows),
            'process_errors':sum(bool(x['errors']) for x in node_rows),
            'process_cpu_s':round(sum(x['cpu_s'] for x in node_rows),2),
            'process_rss_sum_mb':round(sum(x['maxrss_kb'] for x in node_rows)/1024,1),
            'bridge_tc_dropped':drops(n)-before_drop,
            'elapsed_wall_s':round(time.monotonic()-start,3)}
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
    a=argparse.ArgumentParser()
    a.add_argument('--backend',choices=['zenoh','cyclone'],required=True)
    a.add_argument('--nodes',type=int,required=True)
    a.add_argument('--loss',type=float,default=0)
    a.add_argument('--seed',type=int,default=1)
    a.add_argument('--warmup',type=float,default=17)
    a.add_argument('--spread',type=float,default=4)
    a.add_argument('--timeout',type=float,default=45)
    a.add_argument('--messages',type=int,default=2)
    a.add_argument('--output',default='vendor-threshold-results')
    a=a.parse_args()
    out=Path(a.output).resolve()
    out.mkdir(parents=True,exist_ok=True)
    try:
        prepare(a.nodes)
        apply_netem(a.nodes,a.loss)
        result=exercise(a,out)
        result['status']='PASS' if result['strict_success'] else 'FAIL'
    except Exception as exc:
        result={'backend':a.backend,'nodes':a.nodes,'loss_pct_each_direction':a.loss,
                'seed':a.seed,'status':'ERROR','reason':str(exc)}
    finally:
        cleanup(a.nodes)
    (out/'results.json').write_text(json.dumps(result,indent=2)+'\n')
    with (out/'results.csv').open('w',newline='') as fh:
        w=csv.DictWriter(fh,fieldnames=sorted(result))
        w.writeheader()
        w.writerow(result)
    print('THRESHOLD_RESULT '+json.dumps(result),flush=True)

if __name__=='__main__':
    main()
