#!/usr/bin/env python3
"""Cito runtime UDP Discovery: isolated netns capacity gate on GitHub Linux runners."""
import argparse, csv, json, math, re, subprocess, time
from pathlib import Path

BR='br-ctscale'
# Synthetic network conditions; not measurements of actual LAN / Wi-Fi / radios.
# tuple: nominal rate kbit/s, one-way delay ms, jitter ms, one-way loss pct.
PROFILES={
    'baseline':(None,0,0,0),
    'lan':(100000,1,0,0),
    'wifi':(10000,10,2,0.1),
    'bandwidth_1m':(1000,0,0,0),
    'latency_100ms':(None,100,10,0),
    'loss_1pct':(None,0,0,1),
    'congested':(1000,50,10,1),
    'degraded':(256,150,20,3),
    'extreme':(64,300,50,5),
}
def netem_opts(profile,queue_packets):
    rate,delay,jitter,loss=PROFILES[profile]
    if profile=='baseline': return []
    opts=['limit',str(queue_packets)]
    # Each packet traverses two shaped egress interfaces per one-way path.
    if delay:
        opts+=['delay',f'{delay/2:g}ms']
        if jitter: opts += [f'{jitter/2:g}ms']
    if loss:
        per_hop=100*(1-math.sqrt(1-loss/100))
        opts+=['loss',f'{per_hop:.6f}%']
    if rate:opts+=['rate',f'{rate}kbit']
    return opts
def sudo(*a, check=True):
    return subprocess.run(['sudo','-n',*a],capture_output=True,text=True,check=check)
def addr(i):
    x=i+11
    return '10.201.%d.%d'%(x//256,x%256)
def publisher_stats(t):
    m=re.findall(r'snapshot_requests=(\d+) route_requests=(\d+) discovered=(\d+) sent=(\d+)',t)
    return dict(zip(('snapshots','routes','discovered','sent'),map(int,m[-1]))) if m else None

def trial(binary,n,rep,out,timeout,lifetime,stagger,profile,queue_packets):
    folder=out/('n%04d-r%d'%(n,rep))
    opts=netem_opts(profile,queue_packets)
    folder.mkdir(parents=True,exist_ok=True)
    namespaces=[]
    processes=[]
    streams=[]
    result=dict(profile=profile,nodes=n,repeat=rep,expected=n-2,passed=False,received=0,discovered=0,
                sent=0,route_requests=0,time_to_publish_ms=None,reason='',elapsed_ms=None)
    start=time.monotonic()
    pub=None
    try:
        sudo('ip','link','del',BR,check=False)
        sudo('ip','link','add',BR,'type','bridge')
        sudo('ip','addr','add','10.201.0.1/22','dev',BR)
        sudo('ip','link','set',BR,'up')
        for i in range(n):
            name='ctscale-%04d'%i
            host='cth%04d'%i
            peer='ctp%04d'%i
            sudo('ip','netns','add',name)
            namespaces.append(name)
            sudo('ip','link','add',host,'type','veth','peer','name',peer)
            sudo('ip','link','set',host,'master',BR)
            sudo('ip','link','set',host,'up')
            sudo('ip','link','set',peer,'netns',name)
            sudo('ip','netns','exec',name,'sh','-ec',
                 'ip link set lo up; ip link set '+peer+' name eth0; ip addr add '+addr(i)+'/22 dev eth0; ip link set eth0 up')
            if opts:
                # Namespace eth0 egress = outgoing, host veth egress = incoming.
                sudo('tc','qdisc','replace','dev',host,'root','netem',*opts)
                sudo('ip','netns','exec',name,'tc','qdisc','replace','dev','eth0','root','netem',*opts)
                for check_cmd in [
                    ('tc','qdisc','show','dev',host),
                    ('ip','netns','exec',name,'tc','qdisc','show','dev','eth0')
                ]:
                    if 'netem' not in sudo(*check_cmd).stdout:
                        raise RuntimeError('netem not applied: '+repr(check_cmd))
        discovery_start=time.monotonic()
        def launch(i,arguments):
            f=(folder/('publisher.log' if i==0 else 'node-%04d.log'%i)).open('w')
            streams.append(f)
            p=subprocess.Popen(['sudo','-n','ip','netns','exec','ctscale-%04d'%i,
                                str(binary),*arguments],stdout=f,stderr=subprocess.STDOUT)
            processes.append(p)
            return p
        pub=launch(0,['publisher','100','47100',str(n-2),str(lifetime)])
        time.sleep(0.2)
        for i in range(1,n):
            match=(i<n-1)
            launch(i,['subscriber',str(1000+i),'100' if match else '200',
                      str(49000+i),str(48000+i),'47100','10.201.3.255',
                      '1' if match else '0',str(lifetime)])
            if stagger: time.sleep(stagger/1000)
        deadline=time.monotonic()+timeout
        pub_exit=None
        while time.monotonic()<deadline:
            if pub.poll() is not None and pub_exit is None: pub_exit=time.monotonic()
            if all(p.poll() is not None for p in processes): break
            time.sleep(.05)
        else:
            result['reason']='timeout'
        if pub_exit is None and pub.poll() is not None: pub_exit=time.monotonic()
        if pub_exit is not None and pub.returncode==0: result['time_to_publish_ms']=round((pub_exit-discovery_start)*1000)
        if opts:
            with (folder/'tc_qdisc_stats.txt').open('w') as output:
                for i in range(n):
                    name='ctscale-%04d'%i
                    for label,cmd in [
                        ('inbound',('tc','-s','qdisc','show','dev','cth%04d'%i)),
                        ('outbound',('ip','netns','exec',name,'tc','-s','qdisc','show','dev','eth0'))
                    ]:
                        q=sudo(*cmd,check=False)
                        output.write('## %s %s rc=%d\n%s%s\n'%(name,label,q.returncode,q.stdout,q.stderr))
    except Exception as e:
        result['reason']='setup_or_execution: '+str(e)
    finally:
        for name in namespaces:
            for pid in sudo('ip','netns','pids',name,check=False).stdout.split():
                sudo('kill','-TERM',pid,check=False)
        for p in processes:
            if p.poll() is None: p.terminate()
        for p in processes:
            try: p.wait(timeout=2)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        for f in streams: f.close()
        for name in reversed(namespaces): sudo('ip','netns','del',name,check=False)
        sudo('ip','link','del',BR,check=False)
        result['elapsed_ms']=round((time.monotonic()-start)*1000)
    pfile=folder/'publisher.log'
    stats=publisher_stats(pfile.read_text()) if pfile.exists() else None
    if stats:
        peak=re.search(r'\bpeak_discovered=(\d+)\b',pfile.read_text())
        elapsed=re.search(r'\bdiscovery_elapsed_ms=(\d+)\b',pfile.read_text())
        result['peak_discovered']=int(peak.group(1)) if peak else stats['discovered']
        result['publisher_elapsed_ms']=int(elapsed.group(1)) if elapsed else None
        result['discovered']=stats['discovered']
        result['sent']=stats['sent']
        result['route_requests']=stats['routes']
        result['snapshot_requests']=stats['snapshots']
    received=0
    receive_elapsed=[]
    negatives=0
    for i in range(1,n):
        f=folder/('node-%04d.log'%i)
        t=f.read_text() if f.exists() else ''
        if i<n-1:
            if re.search(r'\breceived=1\b',t):
                received+=1
                m=re.search(r'\breceive_elapsed_ms=(\d+)\b',t)
                if m: receive_elapsed.append(int(m.group(1)))
        else:
            negatives+=bool(re.search(r'\breceived=0 route_requests=0\b',t))
    result['received']=received
    result['peak_discovered']=result.get('peak_discovered',result['discovered'])
    result['discovery_route_rate']=round(result['peak_discovered']/(n-2),6)
    result['delivery_success_rate']=round(received/(n-2),6)
    receive_elapsed.sort()
    result['receive_elapsed_p95_ms']=(receive_elapsed[math.ceil(.95*len(receive_elapsed))-1] if receive_elapsed else None)
    ok=(len(processes)==n and all(p.returncode==0 for p in processes)
        and stats is not None and stats['routes']>=n-2 and stats['discovered']==n-2
        and stats['sent']==n-2 and received==n-2 and negatives==1
        and not result['reason'])
    result['passed']=bool(ok)
    if not ok and not result['reason']:
        result['reason']='incomplete; statuses='+str([p.returncode for p in processes if p.returncode!=0][:12])
    (folder/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--binary',required=True,type=Path)
    p.add_argument('--counts',default='3,10,30,50,100,200,300,400')
    p.add_argument('--profile',choices=sorted(PROFILES),default='baseline')
    p.add_argument('--queue-packets',type=int,default=200)
    p.add_argument('--repeats',type=int,default=2)
    p.add_argument('--timeout',type=int,default=35)
    p.add_argument('--lifetime-ms',type=int,default=22000)
    p.add_argument('--stagger-ms',type=int,default=5)
    p.add_argument('--output',type=Path,default=Path('discovery-scale-results'))
    a=p.parse_args()
    counts=list(map(int,a.counts.split(',')))
    if not a.binary.is_file() or a.repeats<1 or a.timeout<1 or a.queue_packets<10 or sorted(set(counts))!=counts or not all(3<=x<=700 for x in counts):
        p.error('invalid binary, repeats, timeout, or counts')
    a.output.mkdir(exist_ok=True,parents=True)
    (a.output/'profile.json').write_text(json.dumps(dict(name=a.profile, rate_kbit=PROFILES[a.profile][0], delay_ms=PROFILES[a.profile][1], jitter_ms=PROFILES[a.profile][2], loss_pct=PROFILES[a.profile][3]),indent=2)+'\n')
    rows=[]
    for n in counts:
        for rep in range(1,a.repeats+1):
            print('::group::discovery nodes=%d repeat=%d'%(n,rep),flush=True)
            row=trial(a.binary.resolve(),n,rep,a.output,a.timeout,a.lifetime_ms,a.stagger_ms,a.profile,a.queue_packets)
            rows.append(row)
            print(json.dumps(row,sort_keys=True),flush=True)
            with (a.output/'results.csv').open('w',newline='') as f:
                w=csv.DictWriter(f,fieldnames=list(rows[0]))
                w.writeheader()
                w.writerows(rows)
            print('::endgroup::',flush=True)
            if not row['passed']: break
        if not rows[-1]['passed']: break
    fully_passing=[n for n in counts if len([r for r in rows if r['nodes']==n and r['passed']])==a.repeats]
    summary={'profile':a.profile,'last_fully_passing_count':max(fully_passing,default=0),
             'first_failed_count':next((r['nodes'] for r in rows if not r['passed']),None),
             'rows':rows,'environment':'one Linux GitHub runner; no physical-network inference'}
    (a.output/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print('SCALE_SUMMARY',json.dumps({k:v for k,v in summary.items() if k!='rows'}),flush=True)
    return int(any(not r['passed'] for r in rows))
if __name__=='__main__': raise SystemExit(main())
