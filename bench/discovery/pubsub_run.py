#!/usr/bin/env python3
"""Actual netns Pub/Sub trial orchestration, using common network conditions."""
import argparse
import csv
import json
import os
import random
from pathlib import Path
import subprocess
import sys
import time
from run import prepare, counters, cleanup, memory_available, ns, sh

MODES=('multicast','tree','mesh','hybrid')

def netem(n,loss):
    # Keep base latency equal between 0% and 10% loss treatments.
    for i in range(n):
        host=f'db{i:03d}h'
        sh('tc','qdisc','del','dev',host,'root',check=False)
        sh('ip','netns','exec',ns(i),'tc','qdisc','del','dev','eth0','root',check=False)
        opts=['netem','delay','2ms']
        if loss:
            opts.extend(['loss',f'{loss}%'])
        sh('tc','qdisc','add','dev',host,'root',*opts)
        sh('ip','netns','exec',ns(i),'tc','qdisc','add',
           'dev','eth0','root',*opts)


def execute(n,mode,loss,seconds,disc,m,spread,publishers,seed,fanout,interval,out,v4=False,
            payload_bytes=32,publish_interval=.28,ablation='full',fault='none',burst_seconds=3,
            proactive_replays=0,replay_interval=.065):
    wd=out/f'{mode}-n{n}-loss{loss:g}-seed{seed}'
    wd.mkdir(parents=True,exist_ok=True)
    procs=[]
    events=[]
    crashed=set()
    burst_active=False
    burst_finished=False
    burst_targets=sorted(random.Random(seed*787+7).sample(range(n),max(1,n//20)))
    def set_link_loss(ids,rate):
        opts=['netem','delay','2ms']
        if rate:opts.extend(['loss',f'{rate}%'])
        for j in ids:
            sh('tc','qdisc','replace','dev',f'db{j:03d}h','root',*opts)
            sh('ip','netns','exec',ns(j),'tc','qdisc','replace','dev','eth0','root',*opts)
    try:
        for i in range(n):
            log=(wd/f'log-{i}.txt').open('w')
            command=['ip','netns','exec',ns(i),sys.executable,
                str(Path(__file__).resolve().parent/'pubsub_node.py'),
                '--id',str(i),'--count',str(n),'--mode',mode,
                '--messages',str(m),'--discovery-seconds',str(disc),
                '--timeout',str(seconds),'--publish-spread',str(spread),
                '--publishers',str(publishers),
                '--seed',str(seed),'--repair-fanout',str(fanout),
                '--repair-interval',str(interval),
                '--publish-interval',str(publish_interval),
                '--payload-bytes',str(payload_bytes),
                '--ablation',ablation,
                '--proactive-replays',str(proactive_replays),
                '--replay-interval',str(replay_interval),
                '--workdir',str(wd)]
            if v4: command.append('--v4')
            p=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
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
        burst_begin=disc+spread*.5
        burst_end=burst_begin+burst_seconds
        while time.monotonic()-started < (disc+seconds+3):
            elapsed=time.monotonic()-started
            if fault=='burst' and not burst_active and not burst_finished and elapsed>=burst_begin:
                set_link_loss(burst_targets,100)
                burst_active=True
                events.append({'event':'burst_start','at_s':round(elapsed,3),'targets':burst_targets})
            if fault=='burst' and burst_active and elapsed>=burst_end:
                set_link_loss(burst_targets,loss)
                burst_active=False
                burst_finished=True
                events.append({'event':'burst_end','at_s':round(elapsed,3)})
            if fault=='crash' and 0 not in crashed and (wd/'published-0').exists():
                procs[0].kill()
                procs[0].wait()
                crashed.add(0)
                events.append({'event':'publisher_killed','at_s':round(elapsed,3),'id':0})
            active_count=n-len(crashed)
            if len(list(wd.glob('done-*')))>=active_count:
                break
            if any(p.poll() is not None and i not in crashed for i,p in enumerate(procs)):
                events.append({'event':'normal_deadline_expiry' if elapsed>=disc+seconds-.6
                               else 'unexpected_process_exit',
                               'at_s':round(elapsed,3)})
                break
            time.sleep(.08)
        if burst_active:
            set_link_loss(burst_targets,loss)
            events.append({'event':'burst_restored_on_shutdown','at_s':round(time.monotonic()-started,3)})
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
        survivors=n-len(crashed)
        everyone=all(r['remote_received']==r['remote_expected'] for r in rows) and len(rows)==survivors
        full_disc=all(r['known_nodes']==n for r in rows) and len(rows)==survivors
        first_pub=disc
        result={'mode':mode,'nodes':n,'publishers':publishers or n,
            'loss_percent_per_direction':loss,'seed':seed,'v4':v4,
            'payload_bytes':payload_bytes,'publish_interval_s':publish_interval,
            'messages_per_publisher':m,'ablation':ablation,'fault':fault,
            'fault_events':events,'crashed_nodes':sorted(crashed),
            'proactive_replays':proactive_replays,'replay_interval_s':replay_interval,
            'proactive_replay_sent':sum(r['stats'].get('proactive_replay_sent',0) for r in rows),
            'publish_spread_s':spread, 'repair_fanout':fanout,
            'repair_interval_s':interval,
            'reported':len(rows),'discovery_success':full_disc,
            'fully_discovered_nodes':sum(r['known_nodes']==n for r in rows),
            'pubsub_success':everyone,
            'fully_delivered_nodes':sum(r['remote_received']==r['remote_expected'] for r in rows),
            'total_expected_remote':sum(r['remote_expected'] for r in rows),
            'expected_live_receives':(n-len(crashed))*(n-1)*m,
            'all_published_marker_count':len(list(wd.glob('published-*'))),
            'total_missing_by_source':{},
            'max_repairs_per_sequence':max((r.get('max_repairs_per_sequence',0) for r in rows),default=0),
            'total_samples_at_repair_limit':sum(r.get('samples_at_repair_limit',0) for r in rows),
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
            'total_nack_suppressed':sum(r['stats'].get('nack_suppressed',0) for r in rows),
            'total_nack_heard':sum(r['stats'].get('nack_heard',0) for r in rows),
            'total_repair_suppressed':sum(r['stats'].get('repair_suppressed',0) for r in rows),
            'udp_rcvbuf_errors':sum(r.get('udp_rcvbuf_errors',0) for r in rows),
            'udp_in_errors':sum(r.get('udp_in_errors',0) for r in rows),
            'socket_rx_overflow':sum(r.get('socket_rx_overflow',0) for r in rows),
            'send_errors':sum(r.get('send_errors',0) for r in rows),
            'total_ihave':sum(r['stats']['ihave_sent'] for r in rows),
            'total_iwant':sum(r['stats']['iwant_sent'] for r in rows),
            'total_control_packets':sum(r['stats']['hello_sent']+r['stats']['digest_sent']+
                                        r['stats']['delta_sent']+r['stats']['ihave_sent']+
                                        r['stats']['iwant_sent'] for r in rows),
            'total_data_packets':sum(r['stats']['data_sent']+r['stats']['data_forwarded'] for r in rows),
            'aggregate_cpu_s':round(sum(r['cpu_s'] for r in rows),3),
            'aggregate_maxrss_mb':round(sum(r['maxrss_kb'] for r in rows)/1024,1),
            'seconds_observed':round(time.monotonic()-started,3)}
        missing_src={}
        for row in rows:
            for item in row.get('missing_by_origin',[]):
                key=str(item['origin'])
                missing_src[key]=missing_src.get(key,0)+item['count']
        result['total_missing_by_source']={k:v for k,v in sorted(
            missing_src.items(),key=lambda kv:-kv[1])[:20]}
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
    ap.add_argument('--publish-spread',type=float,default=3)
    ap.add_argument('--publishers',type=int,default=0)
    ap.add_argument('--seeds',default='1')
    ap.add_argument('--repair-fanout',type=int,default=4)
    ap.add_argument('--repair-interval',type=float,default=1.0)
    ap.add_argument('--output',default='pubsub-results')
    ap.add_argument('--v4',action='store_true')
    ap.add_argument('--payload-bytes',type=int,default=32)
    ap.add_argument('--publish-interval',type=float,default=.28)
    ap.add_argument('--ablation',choices=['full','no_anti_entropy','no_hello','no_nack_suppression','unicast_repair'],default='full')
    ap.add_argument('--fault',choices=['none','burst','crash'],default='none')
    ap.add_argument('--burst-seconds',type=float,default=3)
    ap.add_argument('--proactive-replays',type=int,default=0)
    ap.add_argument('--replay-interval',type=float,default=.065)
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
                    for seed in [int(x) for x in args.seeds.split(',')]:
                        print(f'START n={n} mode={mode} loss={loss}% seed={seed}',flush=True)
                        try:
                            r=execute(n,mode,loss,args.timeout,args.discovery,args.messages,
                                args.publish_spread,args.publishers,seed,args.repair_fanout,
                                args.repair_interval,out,args.v4,args.payload_bytes,
                                args.publish_interval,args.ablation,args.fault,args.burst_seconds,
                                args.proactive_replays,args.replay_interval)
                            r['status']='PASS' if r['pubsub_success'] and r['discovery_success'] else 'FAIL'
                        except Exception as exc:
                            r={'nodes':n,'mode':mode,'loss_percent_per_direction':loss,
                               'seed':seed,'status':'ERROR','reason':str(exc)}
                        results.append(r)
                        print('RESULT '+json.dumps(r),flush=True)
        finally:
            cleanup(n)
    (out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    keys=['mode','nodes','seed','loss_percent_per_direction','status','ablation','fault','payload_bytes','messages_per_publisher','discovery_success',
          'pubsub_success','fully_delivered_nodes','remote_delivery_rate',
          'pubsub_all_complete_after_pub_s','discovery_all_complete_s','total_nacks',
          'total_repairs','udp_rcvbuf_errors','socket_rx_overflow',
          'send_errors','bridge_rx_bytes','bridge_tx_bytes','aggregate_cpu_s','reason']
    with (out/'results.csv').open('w',newline='') as fh:
        w=csv.DictWriter(fh,fieldnames=keys,extrasaction='ignore')
        w.writeheader()
        w.writerows(results)
    print('RESULTS_JSON='+str(out/'results.json'),flush=True)

if __name__=='__main__':
    main()
