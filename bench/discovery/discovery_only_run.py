#!/usr/bin/env python3
"""Root-level 30/35/40-node Cyclone DDS discovery-only topology diagnostic."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import time
from run import prepare,cleanup,ns,counters,sh

def tc_drops(n):
    total=0
    overlimits=0
    qdisc_samples=[]
    for i in range(n):
        for prefix,dev in (([],f'db{i:03d}h'),(['ip','netns','exec',ns(i)],'eth0')):
            r=subprocess.run(prefix+['tc','-s','qdisc','show','dev',dev],
                text=True,capture_output=True)
            line=r.stdout
            dm=re.findall(r'dropped\s+(\d+)',line)
            om=re.findall(r'overlimits\s+(\d+)',line)
            total+=sum(map(int,dm))
            overlimits+=sum(map(int,om))
            if (dm and any(int(x)>0 for x in dm)) or r.returncode:
                qdisc_samples.append({'i':i,'side':'host' if not prefix else 'ns',
                                      'output':line[:1400],'stderr':r.stderr[:300]})
    return {'dropped':total,'overlimits':overlimits,'nonzero_samples':qdisc_samples[:24]}

def setup_netem(n,delay):
    if not delay:
        return
    for i in range(n):
        sh('tc','qdisc','replace','dev',f'db{i:03d}h','root',
           'netem','delay',f'{delay}ms')
        sh('ip','netns','exec',ns(i),'tc','qdisc','replace',
           'dev','eth0','root','netem','delay',f'{delay}ms')

def start_pcap(n,wd):
    procs=[]
    for i in (0,min(1,n-1)):
        fn=wd/f'bridge-port-{i}.pcap'
        stderr=(wd/f'tcpdump-{i}.log').open('w')
        p=subprocess.Popen(['tcpdump','-n','-i',f'db{i:03d}h',
            '-s','256','-U','-w',str(fn),'udp'],stdout=subprocess.DEVNULL,stderr=stderr)
        stderr.close()
        procs.append(p)
    return procs

def link_drops(n):
    total=0
    for i in range(n):
        try:
            v=json.loads(subprocess.check_output(['ip','-j','-s','link','show',
                f'db{i:03d}h'],text=True))[0]
            total+=int(v['stats64']['rx']['dropped'])+int(v['stats64']['tx']['dropped'])
        except (KeyError,IndexError,ValueError):
            pass
    return total

def main():
    a=argparse.ArgumentParser()
    a.add_argument('--nodes',type=int,required=True)
    a.add_argument('--seed',type=int,required=True)
    a.add_argument('--config',choices=['default','eth0','spdp-only','lease60','spdp1s','lease60-spdp1s','resp500ms','resp1s','resp2s'],default='default')
    a.add_argument('--delay-ms',type=float,default=0.0)
    a.add_argument('--timeout',type=float,default=25.0)
    a.add_argument('--capture',action='store_true')
    a.add_argument('--trace',action='store_true')
    a.add_argument('--join-spread-ms',type=float,default=0.0)
    a.add_argument('--output',default='discovery-only-results')
    args=a.parse_args()
    wd=Path(args.output).resolve()
    wd.mkdir(parents=True,exist_ok=True)
    processes=[]
    captures=[]
    report={'nodes':args.nodes,'seed':args.seed,'config':args.config,
            'delay_ms_each_end':args.delay_ms,'configured_loss_pct':0,
            'join_spread_ms':args.join_spread_ms}
    try:
        prepare(args.nodes)
        setup_netem(args.nodes,args.delay_ms)
        for i in range(args.nodes):
            f=(wd/f'node-{i}.log').open('w')
            cmd=['ip','netns','exec',ns(i),sys.executable,
                str(Path(__file__).resolve().parent/'discovery_only_node.py'),
                '--id',str(i),'--count',str(args.nodes),
                '--config',args.config,'--seed',str(args.seed),
                '--timeout',str(args.timeout),'--workdir',str(wd),
                '--join-spread-ms',str(args.join_spread_ms)]
            if args.trace:
                cmd.append('--trace')
            p=subprocess.Popen(cmd,stdout=f,stderr=subprocess.STDOUT)
            f.close()
            processes.append(p)
        barrier=time.monotonic()+max(30,args.nodes*.4)
        while time.monotonic()<barrier:
            if len(list(wd.glob('ready-*')))==args.nodes:
                break
            if any(p.poll() is not None for p in processes):
                break
            time.sleep(.04)
        ready=len(list(wd.glob('ready-*')))
        if ready!=args.nodes:
            raise RuntimeError(f'only {ready}/{args.nodes} processes reached ready')
        if args.capture:
            captures=start_pcap(args.nodes,wd)
            time.sleep(.22)
        before=counters(args.nodes)
        drop_start=tc_drops(args.nodes)
        link_drop_start=link_drops(args.nodes)
        started=time.monotonic()
        (wd/'go').touch()
        while time.monotonic()-started<args.timeout+2:
            if len(list(wd.glob('done-*')))==args.nodes:
                break
            if any(p.poll() is not None for p in processes):
                break
            time.sleep(.05)
        (wd/'stop').touch()
        for p in processes:
            try:p.wait(timeout=6)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        after=counters(args.nodes)
        drop_end=tc_drops(args.nodes)
        link_drop_end=link_drops(args.nodes)
        rows=[json.loads(f.read_text()) for f in wd.glob('node-*.json')]
        globally_seen=set().union(*(set(r['participant_keys']) for r in rows))
        failure_rows=[]
        for r in rows:
            missing=sorted(globally_seen-set(r['participant_keys']))
            if (missing or r['matched_publications']<args.nodes or
                r['matched_subscriptions']<args.nodes or r['errors']):
                failure_rows.append({'node':r['node'],
                    'seen_participants':r['participant_count'],
                    'missing_guids_from_global_union':missing,
                    'matched_publications':r['matched_publications'],
                    'matched_subscriptions':r['matched_subscriptions'],
                    'errors':r['errors']})
        def worst(field):
            if (len(rows)==args.nodes and
                all(r[field] is not None for r in rows)):
                return round(max(r[field] for r in rows),4)
            return None
        strict=(len(rows)==args.nodes and not failure_rows
                and len(globally_seen)==args.nodes and
                all(r['all_full_s'] is not None for r in rows))
        report.update({
            'status':'PASS' if strict else 'FAIL',
            'reported':len(rows),'ready':ready,
            'full_participant_nodes':sum(r['participant_count']>=args.nodes for r in rows),
            'full_reader_nodes':sum(r['matched_publications']>=args.nodes for r in rows),
            'full_writer_nodes':sum(r['matched_subscriptions']>=args.nodes for r in rows),
            'full_all_nodes':sum(r['all_full_s'] is not None for r in rows),
            'global_observed_unique_guids':len(globally_seen),
            'all_participant_s':worst('participant_full_s'),
            'all_reader_s':worst('reader_full_s'),
            'all_writer_s':worst('writer_full_s'),
            'all_match_s':worst('all_full_s'),
            'max_init_s':round(max([r['init_s'] for r in rows if r['init_s'] is not None],default=0),4),
            'missing_nodes':failure_rows,'cpu_total_s':round(sum(r['cpu_s'] for r in rows),3),
            'maxrss_sum_mb':round(sum(r['maxrss_kb'] for r in rows)/1024,2),
            'udp_rcvbuf_errors':sum(r['udp_rcvbuf_errors'] for r in rows),
            'udp_in_errors':sum(r['udp_in_errors'] for r in rows),
            'tc_drops':drop_end['dropped']-drop_start['dropped'],
            'tc_overlimits':drop_end['overlimits']-drop_start['overlimits'],
            'host_link_drops':link_drop_end-link_drop_start,
            'tc_nonzero_evidence':drop_end['nonzero_samples'],
            'user_data_sent':sum(r['user_data_sent'] for r in rows),
            'transient_builtin_errors':sum(r.get('transient_errors',{}).get('builtin',0) for r in rows),
            'transient_matched_read_errors':sum(r.get('transient_errors',{}).get('matched_read',0) for r in rows),
            'transient_matched_write_errors':sum(r.get('transient_errors',{}).get('matched_write',0) for r in rows),
            'seconds_observed':round(time.monotonic()-started,3),
        })
        report.update({f'bridge_{k}':after[k]-before[k] for k in before})
    except Exception as e:
        report.update({'status':'ERROR','reason':str(e)})
    finally:
        (wd/'stop').touch()
        for p in processes:
            if p.poll() is None:
                p.kill()
                p.wait()
        for p in captures:
            if p.poll() is None:
                p.terminate()
                try:p.wait(timeout=3)
                except subprocess.TimeoutExpired:p.kill()
        cleanup(args.nodes)
    (wd/'summary.json').write_text(json.dumps(report,indent=2)+'\n')
    print('DISCOVERY_ONLY_RESULT '+json.dumps({k:v for k,v in report.items()
        if k not in ('missing_nodes','tc_nonzero_evidence')}),flush=True)
    print('MISSING_GUID_DETAILS '+json.dumps(report.get('missing_nodes',[])[:8]),flush=True)

if __name__=='__main__':
    main()
