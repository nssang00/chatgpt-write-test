"""Thirty independent applications, four publish and eight subscribe topics each."""
import json
import math
import pathlib
import sqlite3
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import closing

try:
    import psutil
except ImportError:
    psutil = None

exe, wire_profile, output = sys.argv[1:4]
serialized = wire_profile.endswith("_mutex")
profile = wire_profile[:-6] if serialized else wire_profile
args = sys.argv[4:]
load = profile.startswith("load_")
duration = 6000
if load:
    if len(args) not in (1,3):
        raise ValueError("load profile requires duration and optional diagnostic threshold/mode")
    duration = int(args[0])
    diagnostic_args = args[1:]
else:
    diagnostic_args = args
    if diagnostic_args and len(diagnostic_args)!=2:
        raise ValueError("expected checkpoint threshold and diagnostic mode")
output = pathlib.Path(output)
output.parent.mkdir(parents=True, exist_ok=True)
snapshot = output.with_suffix(".db")
if snapshot.exists():
    snapshot.unlink()
peers, groups = 30, 6
endurance = duration >= 3600000
if not 200<=duration<=3600000 or (endurance and profile!="load_300"):
    raise ValueError("unsupported duration/profile")
names = ("sensor", "status", "command", "log")
types = ("TrafficSensor", "TrafficStatus", "TrafficCommand", "TrafficLog")
periods = {"fast":[10,20,50,100],"normal":[20,40,100,200],
           "load_30":[4000,4000,4000,4000],"load_300":[180,360,900,1800],
           "load_900":[60,120,300,600],"load_1800":[30,60,150,300],
           "load_2700":[20,40,100,200],"load_5400":[10,20,50,100]}[profile]
if load and any(duration%p or duration//p<2 for p in periods):
    raise ValueError("duration must contain whole periods and at least two sends per type")
counts = [duration // p for p in periods]
expected_pub = peers * sum(counts)
expected_rx = expected_pub * 10
report = dict(status="FAIL", profile=profile, processes=peers, topics=24,
              subscriptions=240, target_duration_ms=duration, periods_ms=dict(zip(names, periods)),
              expected_publishes=expected_pub, expected_deliveries=expected_rx,
              target_publish_rate=expected_pub/(duration/1000),
              poll_ms=10 if load else 5, busy_ms=5000 if load else 30000,
              phase_staggered=load, history_retention=load, serialize_writers=serialized,
              retention_sec=60 if load else 0,max_messages=100000 if load else 0)

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def stats(values):
    values = sorted(values)
    if not values:
        return None
    def p(q):
        return values[max(0, math.ceil(len(values)*q)-1)]/1000
    return dict(samples=len(values), p50_ms=p(.5), p95_ms=p(.95), p99_ms=p(.99),
                max_ms=values[-1]/1000, mean_ms=sum(values)/len(values)/1000)

def verify_db(db):
    with closing(sqlite3.connect(db)) as conn:
        require(conn.execute("PRAGMA integrity_check").fetchone()[0]=="ok", "integrity check")
        topics = dict(conn.execute("SELECT name,type FROM topics"))
        require(topics=={f"group.{g}.{n}":t for g in range(groups) for n,t in zip(names,types)}, "topic registry mismatch")
        next_idx = [[None if load else 0]*4 for _ in range(peers)]
        raw_bytes = 0
        retained=0
        first_seq,last_seq=None,None
        first_ts,last_ts=None,None
        for seq,t,sender,ts,payload in conn.execute("SELECT seq,topic,sender,timestamp,payload FROM messages ORDER BY seq"):
            if first_seq is None:first_seq,first_ts=seq,ts
            if last_seq is not None:require(seq==last_seq+1,"history is not contiguous suffix")
            last_seq,last_ts=seq,ts
            retained+=1
            _,g,n = t.split(".")
            k=names.index(n)
            m=json.loads(payload)
            h=m["header"]
            src,idx=h["source"],h["index"]
            require(0<=src<peers and src%groups==int(g) and sender==f"TrafficApp{src}" and
                    (next_idx[src][k] is None or idx==next_idx[src][k]) and
                    0<=idx<counts[k] and h["sent_us"]>0, "DB sequence/publisher mismatch")
            next_idx[src][k]=idx+1
            raw_bytes+=len(payload.encode("utf-8"))
            if k==3:
                require(m["text"]==chr(65+src%26)*4096, "DB log mismatch")
        require(last_seq==expected_pub and conn.execute("SELECT seq FROM sqlite_sequence WHERE name='messages'").fetchone()[0]==expected_pub,
                "DB high-water mismatch")
        require(all(row==counts for row in next_idx),"DB history tail mismatch")
        require(retained==last_seq-first_seq+1,"DB history suffix count mismatch")
        if load:
            require(retained<=100127,"retention sequence window exceeded")
            if expected_pub>100127 or endurance:
                require(retained<expected_pub,"retention did not prune")
            if endurance:
                require(last_ts-first_ts<=65*1000000,"retention age window exceeded")
        else:
            require(retained==expected_pub,"DB full history mismatch")
        report.update(retained_messages=retained,pruned_messages=expected_pub-retained,
                      retained_span_seconds=(last_ts-first_ts)/1000000,
                      db_freelist_pages=conn.execute("PRAGMA freelist_count").fetchone()[0],
                      db_page_count=conn.execute("PRAGMA page_count").fetchone()[0])
        require(conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0]==0,"checkpoint failed")
        if not load:
            with closing(sqlite3.connect(snapshot)) as dest:
                conn.backup(dest)
                require(dest.execute("PRAGMA integrity_check").fetchone()[0]=="ok","snapshot integrity")
        return raw_bytes

try:
    with tempfile.TemporaryDirectory() as directory:
        root=pathlib.Path(directory)
        db=root/"traffic.db"
        go,drain,release=(root/x for x in ("go","drain","release"))
        with closing(sqlite3.connect(db)) as conn:
            conn.execute("PRAGMA journal_mode=WAL").fetchone()
        processes=[]; ready=[]; sent=[]; results=[]; logs=[]; sampled=[]
        peak_rss=peak_threads=peak_wal=peak_db=0
        samples=[]
        last_sample=last_record=0
        sample_start=time.monotonic()
        def sample(force=False):
            global last_sample,last_record,peak_rss,peak_threads,peak_wal,peak_db
            now=time.monotonic()
            if not force and now-last_sample<.25:
                return
            last_sample=now
            try: wal_bytes=pathlib.Path(str(db)+"-wal").stat().st_size
            except FileNotFoundError: wal_bytes=0
            db_bytes=db.stat().st_size
            peak_wal=max(peak_wal,wal_bytes)
            peak_db=max(peak_db,db_bytes)
            if load:
                require(db_bytes+wal_bytes<=4*1024**3,"test disk growth limit (4 GiB)")
                require(shutil.disk_usage(root).free>=2*1024**3,"test free disk safety limit (2 GiB)")
            if psutil is None: return
            rss=threads=0
            for p in sampled:
                try:
                    with p.oneshot():
                        rss+=p.memory_info().rss
                        threads+=p.num_threads()
                except (psutil.NoSuchProcess,psutil.AccessDenied):
                    pass
            peak_rss=max(peak_rss,rss)
            peak_threads=max(peak_threads,threads)
            if load and (force or now-last_record>=60):
                last_record=now
                samples.append(dict(seconds=now-sample_start,db_bytes=db_bytes,wal_bytes=wal_bytes,
                                    rss_mib=rss/1048576,threads=threads))
                if endurance:
                    print("endurance sample",json.dumps(samples[-1]),flush=True)
        def cpu_seconds():
            if psutil is None or len(sampled)!=peers: return None
            try:
                return sum(t.user+t.system for t in (p.cpu_times() for p in sampled))
            except (psutil.NoSuchProcess,psutil.AccessDenied):
                return None
        def wait_all(paths,timeout):
            deadline=time.monotonic()+timeout
            while not all(p.exists() for p in paths):
                require(not any(p.poll() is not None for p in processes), "worker exited before barrier: "+str([(i,p.returncode) for i,p in enumerate(processes) if p.poll() is not None]))
                require(time.monotonic()<deadline,"barrier timeout")
                sample()
                time.sleep(.02)
        try:
            for i in range(peers):
                r,s,j,l=(root/f"{i}.{ext}" for ext in ("ready","sent","json","log"))
                ready.append(r);sent.append(s);results.append(j);logs.append(l)
                with l.open("wb") as out:
                    p=subprocess.Popen([exe,str(i),str(duration),wire_profile,str(db),str(r),str(go),str(s),str(drain),str(j),str(release)]+diagnostic_args,stdout=out,stderr=subprocess.STDOUT)
                processes.append(p)
                if psutil:
                    try: sampled.append(psutil.Process(p.pid))
                    except psutil.NoSuchProcess: pass
            wait_all(ready,60)
            sample(True)
            cpu_start=cpu_seconds()
            start=time.monotonic()
            go.touch()
            wait_all(sent,max(180,duration/1000+180))
            send_elapsed=time.monotonic()-start
            drain.touch()
            wait_all(results,180 if endurance else 60)
            elapsed=time.monotonic()-start
            cpu_end=cpu_seconds()
            sample(True)
            rows=[json.loads(p.read_text()) for p in results]
            published=sum(sum(r["published"]) for r in rows)
            received=sum(sum(r["received"]) for r in rows)
            report.update(actual_publishes=published, actual_deliveries=received,
                          missing=expected_rx-received,
                          duplicates=sum(r["duplicates"] for r in rows),
                          invalid=sum(r["invalid"] for r in rows),
                          out_of_order=sum(r["out_of_order"] for r in rows),
                          skipped_sequences=sum(r["skipped_sequences"] for r in rows),
                          send_elapsed_seconds=send_elapsed, elapsed_seconds=elapsed,
                          publish_rate_per_second=published/send_elapsed,
                          delivery_rate_per_second=received/elapsed,
                          sampled_peak_rss_mib=peak_rss/1048576 if psutil else None,
                          sampled_peak_threads=peak_threads if psutil else None,
                          sampled_peak_wal_bytes=peak_wal,
                          sampled_peak_db_bytes=peak_db, resource_samples=samples,
                          target_rate_fraction=(published/send_elapsed)/(expected_pub/(duration/1000)),
                          peer_cpu_seconds=(cpu_end-cpu_start) if cpu_end is not None and cpu_start is not None else None,
                          per_app_receive_min=min(sum(r["received"]) for r in rows),
                          per_app_receive_max=max(sum(r["received"]) for r in rows))
            report["per_type"]={}
            for k,n in enumerate(names):
                report["per_type"][n]=dict(target_period_ms=periods[k],
                    publishes=sum(r["published"][k] for r in rows),
                    deliveries=sum(r["received"][k] for r in rows),
                    **{key:stats([x for r in rows for x in r[field][k]]) for key,field in
                       (("delivery_latency","latency_us"),("publish_call","publish_us"),
                        ("deadline_lateness","lateness_us"),("actual_send_gap","gaps_us"))})
            require(published==expected_pub and received==expected_rx and not any(report[k] for k in ("duplicates","invalid","out_of_order")),"delivery matrix failed")
            for i,r in enumerate(rows):
                require(r["id"]==i and r["group"]==i%groups and r["published"]==counts and
                        r["received"]==[10*c for c in counts],"per-app matrix failed")
                require(r["poll_ms"]==report["poll_ms"] and r["busy_ms"]==report["busy_ms"] and
                        r["retention_sec"]==report["retention_sec"] and r["max_messages"]==report["max_messages"] and
                        r["serialize_writers"]==serialized,
                        "unexpected session options")
                require(r["skipped_sequences"]==0,"receiver sequence gap")
                for k in range(4):
                    require(len(r["latency_us"][k])==10*counts[k] and len(r["publish_us"][k])==counts[k] and
                            len(r["lateness_us"][k])==counts[k] and len(r["gaps_us"][k])==counts[k]-1,"timing sample mismatch")
            if diagnostic_args:
                ds=[r["diagnostics"] for r in rows]
                config=ds[0]["config"]
                require(all(d["config"]==config for d in ds),"inconsistent SQLite options")
                requested=int(diagnostic_args[0])
                if requested>=0:
                    require(int(config["writer"]["wal_autocheckpoint"])==requested,"wrong checkpoint threshold")
                require(config["writer"]["journal_mode"]=="wal" and config["writer"]["synchronous"]=="1","wrong WAL settings")
                require(config["custom_hooks"]==(diagnostic_args[1]=="hooks"),"wrong hook mode")
                require(config["short_retry"]==(diagnostic_args[1] in ("retry","combined")),"wrong retry mode")
                require(config["serialize_writers"]==serialized,"wrong writer lock mode")
                require(all(r["timer_1ms_active"]==(diagnostic_args[1] in ("timer","combined")) for r in rows),"wrong timer mode")
                report["diagnostics"]={"config":config,
                    "requested_checkpoint_pages":requested,
                    "mode":diagnostic_args[1],
                    "timer_1ms_active":rows[0]["timer_1ms_active"],
                    "busy_calls":sum(d["busy_calls"] for d in ds),
                    "busy_episodes":sum(d["busy_episodes"] for d in ds),
                    "checkpoint_busy":sum(d["checkpoint_busy"] for d in ds),
                    "checkpoint_errors":sum(d["checkpoint_errors"] for d in ds),
                    "wal_commits":sum(d["wal_commits"] for d in ds)}
                for key in ("busy_sleep","checkpoint","insert_step","poll_wait","read_batch","json_parse","callback","writer_wait"):
                    n=sum(d[key]["count"] for d in ds)
                    t=sum(d[key]["total_us"] for d in ds)
                    report["diagnostics"][key]={"count":n,"total_ms":t/1000,
                        "mean_ms":t/n/1000 if n else None,
                        "max_ms":max(d[key]["max_us"] for d in ds)/1000}
                worst=max(ds,key=lambda d:d["slowest_insert"]["step_us"])
                report["diagnostics"]["slowest_insert"]=worst["slowest_insert"]
                report["diagnostics"]["slowest_insert_app"]=ds.index(worst)
                require(report["diagnostics"]["insert_step"]["count"]==expected_pub,"insert sample count")
                require(report["diagnostics"]["writer_wait"]["count"]==expected_pub,"writer wait sample count")
                require(report["diagnostics"]["checkpoint_errors"]==0,"checkpoint errors")
                mode=diagnostic_args[1]
                interval={"owner100":100,"owner250":250}.get(mode,0)
                require([r["maintenance_interval_ms"] for r in rows]==[interval]+[0]*(peers-1),"wrong checkpoint owner")
                maintenance=ds[0]["maintenance"]
                require(all(d["maintenance"]["timing"]["count"]==0 for d in ds[1:]),"non-owner checkpoint")
                require(maintenance["errors"]==0,"maintenance checkpoint error")
                if interval:
                    require(maintenance["timing"]["count"]>0 and maintenance["valid"]>0 and
                            maintenance["max_backfilled_frames"]>0,"no actual checkpoint progress")
                else:
                    require(maintenance["timing"]["count"]==0,"unexpected maintenance checkpoint")
                report["diagnostics"]["maintenance"]=maintenance
                report["diagnostics"]["maintenance_interval_ms"]=interval
                report["diagnostics"]["owner_sensor_latency"]=stats(rows[0]["latency_us"][0])
                report["diagnostics"]["other_sensor_latency"]=stats([x for r in rows[1:] for x in r["latency_us"][0]])
            release.touch()
            deadline=time.monotonic()+20
            for p in processes:
                require(p.wait(timeout=max(.1,deadline-time.monotonic()))==0,"worker failed")
            report["payload_bytes"]=verify_db(db)
            report["final_db_bytes"]=db.stat().st_size
            if not load:
                report["snapshot_bytes"]=snapshot.stat().st_size
            report["status"]="PASS"
        except Exception:
            for p in logs:
                if p.exists() and p.stat().st_size:
                    print(p.name,p.read_text(errors="replace")[-1000:],file=sys.stderr)
            raise
        finally:
            for p in processes:
                if p.poll() is None:p.kill()
                p.wait()
except Exception as e:
    report["error"]=str(e)
    raise
finally:
    output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,sort_keys=True),flush=True)
