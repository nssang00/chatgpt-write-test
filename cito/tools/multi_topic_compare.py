#!/usr/bin/env python3
"""A/B on 3 Linux network namespaces with an equal schedule and tc netem.
Requires CAP_NET_ADMIN and rootless sudo from GitHub-hosted Ubuntu Actions.
"""
import argparse, csv, json, os, pathlib, re, subprocess, sys, time
BR='br-bench'
PROFILES={'baseline':(0,0,0),'limited':(1000,50,1),'degraded':(256,150,3)}
def sudo(*cmd,check=True):
    p=subprocess.run(['sudo','-n',*cmd],text=True,capture_output=True)
    if check and p.returncode:raise RuntimeError('sudo '+repr(cmd)+' rc='+str(p.returncode)+' '+p.stderr)
    return p
def setup(profile):
    rate,delay,loss=PROFILES[profile]
    cleanup()
    sudo('ip','link','add',BR,'type','bridge')
    sudo('ip','link','set','dev',BR,'type','bridge','mcast_snooping','0')
    sudo('ip','addr','add','10.201.0.1/24','dev',BR)
    sudo('ip','link','set',BR,'up')
    for i in range(3):
        name=f'cb-{i}';host=f'cbh-{i}';peer=f'cbp-{i}'
        sudo('ip','netns','add',name)
        sudo('ip','link','add',host,'type','veth','peer','name',peer)
        sudo('ip','link','set',host,'master',BR)
        sudo('ip','link','set',host,'up')
        sudo('ip','link','set',peer,'netns',name)
        sudo('ip','netns','exec',name,'ip','link','set','lo','up')
        sudo('ip','netns','exec',name,'ip','link','set',peer,'name','eth0')
        sudo('ip','netns','exec',name,'ip','addr','add',f'10.201.0.{11+i}/24','dev','eth0')
        sudo('ip','netns','exec',name,'ip','link','set','eth0','up')
        if profile!='baseline':
            import math
            opts=['limit','200']
            if delay:opts+=['delay',f'{delay/2:g}ms']
            if loss:opts+=['loss',f'{100*(1-math.sqrt(1-loss/100)):.6f}%']
            if rate:opts+=['rate',f'{rate}kbit']
            for cmd in [('tc','qdisc','replace','dev',host,'root','netem',*opts),
                        ('ip','netns','exec',name,'tc','qdisc','replace','dev','eth0','root','netem',*opts)]:
                sudo(*cmd)
            for cmd in [('tc','qdisc','show','dev',host),('ip','netns','exec',name,'tc','qdisc','show','dev','eth0')]:
                if 'netem' not in sudo(*cmd).stdout:raise RuntimeError('tc netem not installed')
def cleanup():
    for i in range(3):
        name=f'cb-{i}'
        for pid in sudo('ip','netns','pids',name,check=False).stdout.split():sudo('kill','-TERM',pid,check=False)
        sudo('ip','netns','del',name,check=False)
        sudo('ip','link','del',f'cbh-{i}',check=False)
    sudo('ip','link','del',BR,check=False)
def case(engine,exe,topics,size,samples,hz,profile,repeat,out,timeout_ms):
    base=out/f'{profile}-{engine}-t{topics}-b{size}-r{repeat}'
    base.mkdir(parents=True,exist_ok=True)
    procs=[];handles=[];started=time.monotonic()
    result={'engine':engine,'profile':profile,'topics':topics,'bytes':size,'samples_per_topic':samples,'hz_per_topic':hz,'repeat':repeat,'pass':False}
    try:
        setup(profile)
        env=dict(os.environ)
        if engine=='dds':
            env['CYCLONEDDS_URI']='<CycloneDDS><Domain id="any"><General><Interfaces><NetworkInterface name="eth0"/></Interfaces><AllowMulticast>spdp</AllowMulticast></General></Domain></CycloneDDS>'
        def launch(role,index):
            log=(base/f'{role}.log').open('w');handles.append(log)
            cmd=['sudo','-n','ip','netns','exec',f'cb-{index}',str(exe.resolve()),role,str(topics),str(size),str(samples),str(hz),'10.201.0.255',str(timeout_ms)]
            # sudo normally drops CYCLONEDDS_URI; pass it after entering the namespace.
            if engine=='dds':cmd[6:6]=['env','CYCLONEDDS_URI='+env['CYCLONEDDS_URI']]
            p=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT,env=env);procs.append((role,p));return p
        launch('subscriber',1)
        launch('negative',2)
        time.sleep(.3)
        launch('publisher',0)
        deadline=time.monotonic()+timeout_ms/1000+7
        while time.monotonic()<deadline:
            if all(p.poll() is not None for _,p in procs):break
            time.sleep(.1)
        else:result['reason']='hard timeout'
    except Exception as e:result['reason']=repr(e)
    finally:
        for _,p in procs:
            if p.poll() is None:p.terminate()
        for _,p in procs:
            try:p.wait(timeout=2)
            except subprocess.TimeoutExpired:p.kill();p.wait()
        for x in handles:x.close()
        if profile!='baseline':
            with (base/'tc_stats.txt').open('w') as output:
                for i in range(3):
                    for cmd in [('tc','-s','qdisc','show','dev',f'cbh-{i}'),('ip','netns','exec',f'cb-{i}','tc','-s','qdisc','show','dev','eth0')]:
                        r=sudo(*cmd,check=False);output.write(repr(cmd)+'\n'+r.stdout+'\n')
        cleanup()
    details={}
    for role,p in procs:
        t=(base/f'{role}.log').read_text()
        m=re.search(r'\{[^\n]*"role"[^\n]*\}',t)
        details[role]={'exit':p.returncode,'metrics':json.loads(m.group()) if m else None,'tail':t[-400:]}
    result['details']=details
    pub=details.get('publisher',{}).get('metrics') or {}
    sub=details.get('subscriber',{}).get('metrics') or {}
    neg=details.get('negative',{}).get('metrics') or {}
    expected=topics*samples
    result.update({'expected_messages':expected,'publisher_sent':pub.get('sent',0),'received':sub.get('received',0),
                   'delivery_rate':round(sub.get('received',0)/expected,6),'p95_us':sub.get('p95_us'),
                   'elapsed_ms':round((time.monotonic()-started)*1000)})
    result['pass']=not result.get('reason') and len(details)==3 and all(v['exit']==0 for v in details.values()) and pub.get('sent')==expected and sub.get('received')==expected and sub.get('bad')==0 and sub.get('duplicate')==0 and neg.get('received')==0
    (base/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

def main():
    p=argparse.ArgumentParser();p.add_argument('--cito',type=pathlib.Path,required=True);p.add_argument('--dds',type=pathlib.Path,required=True)
    p.add_argument('--profile',choices=PROFILES,default='baseline');p.add_argument('--topics',type=int,default=8);p.add_argument('--bytes',type=int,default=256)
    p.add_argument('--samples',type=int,default=20);p.add_argument('--hz',type=int,default=20);p.add_argument('--repeat',type=int,default=2)
    p.add_argument('--timeout-ms',type=int,default=10000);p.add_argument('--output',type=pathlib.Path,default=pathlib.Path('bench-results'))
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
    rows=[]
    for rep in range(1,a.repeat+1):
        for engine in (['cito','dds'] if rep%2 else ['dds','cito']):
            row=case(engine,getattr(a,engine),a.topics,a.bytes,a.samples,a.hz,a.profile,rep,a.output,a.timeout_ms)
            rows.append(row);print(json.dumps({k:v for k,v in row.items() if k!='details'}),flush=True)
    (a.output/'results.json').write_text(json.dumps(rows,indent=2)+'\n')
    cols=['engine','profile','topics','bytes','samples_per_topic','hz_per_topic','repeat','pass','expected_messages','publisher_sent','received','delivery_rate','p95_us','elapsed_ms']
    with (a.output/'summary.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=cols);w.writeheader();w.writerows({k:r.get(k) for k in cols} for r in rows)
    return 0 if all(r['pass'] for r in rows) else 1
if __name__=='__main__':sys.exit(main())
