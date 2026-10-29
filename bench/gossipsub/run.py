#!/usr/bin/env python3
"""Run the real go-libp2p Gossipsub implementation on the same netns topology."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
from sys import stdout
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'discovery'))
from run import prepare,cleanup,counters,memory_available,ns
from pubsub_run import netem

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--binary',required=True)
    ap.add_argument('--nodes',type=int,required=True)
    ap.add_argument('--loss',type=int,default=0)
    ap.add_argument('--messages',type=int,default=2)
    ap.add_argument('--seed',type=int,default=1)
    ap.add_argument('--warmup',type=float,default=15)
    ap.add_argument('--spread',type=float,default=4)
    ap.add_argument('--duration',type=float,default=55)
    ap.add_argument('--output',default='gossipsub-results')
    a=ap.parse_args()
    wd=Path(a.output).resolve()
    wd.mkdir(parents=True,exist_ok=True)
    result=dict(backend='real-go-libp2p-gossipsub',nodes=a.nodes,seed=a.seed,
        loss_percent_each_veth_direction=a.loss)
    procs=[]
    try:
        available=memory_available()
        result['cgroup_available_bytes_at_launch']=available
        if available is not None and available < a.nodes*32*1024*1024+500*1024*1024:
            raise RuntimeError('RESOURCE_LIMIT: insufficient cgroup headroom for 1 Go libp2p host per node')
        prepare(a.nodes)
        netem(a.nodes,a.loss)
        env=os.environ.copy()
        env.update({'GOMAXPROCS':'1','GOGC':'50','GOMEMLIMIT':'56MiB'})
        for i in range(a.nodes):
            f=(wd/f'log-{i}.txt').open('w')
            cmd=['ip','netns','exec',ns(i),str(Path(a.binary).resolve()),
                 '--id',str(i),'--n',str(a.nodes),
                 '--messages',str(a.messages),'--seed',str(a.seed),
                 '--warmup',str(a.warmup),'--spread',str(a.spread),
                 '--duration',str(a.duration),'--workdir',str(wd)]
            p=subprocess.Popen(cmd,stdout=f,stderr=subprocess.STDOUT,env=env)
            f.close()
            procs.append(p)
        deadline=time.monotonic()+max(60,a.nodes*.5)
        while time.monotonic()<deadline:
            if len(list(wd.glob('ready-*')))==a.nodes:break
            if any(p.poll() is not None for p in procs):break
            time.sleep(.1)
        ready=len(list(wd.glob('ready-*')))
        if ready!=a.nodes:
            raise RuntimeError(f'READY_FAILURE {ready}/{a.nodes}, exits='+str(
                [p.returncode for p in procs if p.poll() is not None][:10]))
        before=counters(a.nodes)
        start=time.monotonic()
        (wd/'go').touch()
        while time.monotonic()-start<a.duration+3:
            if len(list(wd.glob('done-*')))==a.nodes:break
            if any(p.poll() is not None for p in procs):break
            time.sleep(.15)
        (wd/'stop').touch()
        for p in procs:
            try:p.wait(timeout=8)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        after=counters(a.nodes)
        rows=[json.loads(f.read_text()) for f in wd.glob('node-*.json')]
        expected=a.nodes*(a.nodes-1)*a.messages
        got=sum(r['remote_received'] for r in rows)
        full=sum(r['remote_received']==r['remote_expected'] for r in rows)
        complete=(len(rows)==a.nodes and full==a.nodes and
             not any(r['publish_errors'] for r in rows))
        result.update({
            'status':'PASS' if complete else 'FAIL',
            'ready':ready,'node_reports':len(rows),
            'fully_delivered_nodes':full,
            'remote_delivered':got,'remote_expected':expected,
            'remote_delivery_ratio':round(got/expected,6),
            'min_topic_peers':min((r['topic_peers'] for r in rows),default=0),
            'max_topic_peers':max((r['topic_peers'] for r in rows),default=0),
            'min_host_peers':min((r['host_peers'] for r in rows),default=0),
            'publish_errors':sum(r['publish_errors'] for r in rows),
            'connect_errors':sum(r['connect_errors'] for r in rows),
            'duplicates':sum(r['duplicates'] for r in rows),
            'max_all_received_s':max((r['full_s'] for r in rows),default=0) if complete else None,
            'wall_s':round(time.monotonic()-start,3),
        })
        result.update({f'bridge_{k}':after[k]-before[k] for k in before})
    except Exception as e:
        result.update({'status':'ERROR','reason':str(e)})
    finally:
        (wd/'stop').touch()
        for p in procs:
            if p.poll() is None:p.kill()
        if procs:
            for p in procs:
                try:p.wait(timeout=5)
                except subprocess.TimeoutExpired:pass
        cleanup(a.nodes)
    (wd/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
    print('GOSSIPSUB_RESULT '+json.dumps(result),flush=True)

if __name__=='__main__':
    main()
