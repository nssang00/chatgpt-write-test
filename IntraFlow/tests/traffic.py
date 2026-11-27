"""Thirty independent applications, four publish and eight subscribe topics each."""
import json
import math
import os
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
batch_ms=0
base_profile=wire_profile
if "_batch" in base_profile:
    base_profile, interval=base_profile.rsplit("_batch",1)
    batch_ms=int(interval)
    if not 0<=batch_ms<=500:raise ValueError("batch interval")
filtered = base_profile.endswith("_filter")
profile = base_profile[:-7] if filtered else base_profile
serialized = profile.endswith("_mutex")
profile = profile[:-6] if serialized else profile
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
if not 200<=duration<=3600000 or (endurance and profile not in ("load_100","load_300")):
    raise ValueError("unsupported duration/profile")
names = ("sensor", "status", "command", "log")
types = ("TrafficSensor", "TrafficStatus", "TrafficCommand", "TrafficLog")
periods = {"fast":[10,20,50,100],"normal":[20,40,100,200],
           "load_30":[4000,4000,4000,4000],"load_100":[600,1000,2000,6000],"load_300":[180,360,900,1800],
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
              phase_staggered=load, history_retention=load, serialize_writers=serialized,filter_topics=filtered,
              retention_sec=60 if load else 0,max_messages=100000 if load else 0,batch_ms=batch_ms)

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
    with tempfile.TemporaryDirectory(dir=os.environ.get("INTRAFLOW_TEST_TEMP") or None) as directory:
        root=pathlib.Path(directory)
        db=root/"traffic.db"
        report["test_volume"]=root.anchor
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
            transactions=sum(r["transactions"] for r in rows)
            multi_transactions=sum(r["multi_transactions"] for r in rows)
            multi_messages=sum(r["multi_messages"] for r in rows)
            report.update(message_transactions=transactions,multi_transactions=multi_transactions,
                multi_messages=multi_messages,largest_batch=max(r["largest_batch"] for r in rows),
                mean_batch_size=published/transactions,transaction_rate=transactions/send_elapsed,
                transaction_call=stats([x for r in rows for x in r["transaction_us"]]),
                publish_sample_semantics="enqueue_to_commit" if batch_ms else "synchronous_publish")
            require(transactions-multi_transactions+multi_messages==published,"batch accounting")
            require(all(r["batch_ms"]==batch_ms and len(r["transaction_us"])==r["transactions"] for r in rows),"batch sample mismatch")
            require(0<report["largest_batch"]<=32 and (batch_ms or transactions==published),"batch size")
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
                        r["serialize_writers"]==serialized and r["filter_topics"]==filtered,
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
                mode=diagnostic_args[1]
                separate=mode.startswith("separate_")
                require(config["writer"]["journal_mode"]=="wal" and config["writer"]["synchronous"]==("0" if mode=="separate_off" else "1"),"wrong WAL settings")
                require(config["separate_maintenance"]==separate and config["sync_off"]==(mode=="separate_off"),"wrong maintenance/sync mode")
                require(config["custom_hooks"]==(diagnostic_args[1] in ("hooks","root_hooks")),"wrong hook mode")
                require(config["checkpoint_trace"]==(diagnostic_args[1] in ("hooks","root_hooks","root_checkpoint")),"wrong checkpoint trace mode")
                require(config["win_io_trace"]==(mode.startswith("root_") or (separate and os.name=="nt")),"wrong Windows I/O mode")
                require(config["short_retry"]==(diagnostic_args[1] in ("retry","combined")),"wrong retry mode")
                require(config["serialize_writers"]==serialized and config["filter_topics"]==filtered,"wrong experiment mode")
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
                for key in ("busy_sleep","checkpoint","insert_step","poll_wait","read_batch","json_parse","callback","writer_wait","writer_hold","explicit_commit"):
                    n=sum(d[key]["count"] for d in ds)
                    t=sum(d[key]["total_us"] for d in ds)
                    report["diagnostics"][key]={"count":n,"total_ms":t/1000,
                        "mean_ms":t/n/1000 if n else None,
                        "max_ms":max(d[key]["max_us"] for d in ds)/1000}
                if config["win_io_trace"]:
                    report["diagnostics"]["win_io"]={}
                    for key in ds[0]["win_io"]:
                        n=sum(d["win_io"][key]["count"] for d in ds)
                        t=sum(d["win_io"][key]["total_us"] for d in ds)
                        report["diagnostics"]["win_io"][key]=dict(count=n,total_ms=t/1000,
                            mean_ms=t/n/1000 if n else None,
                            max_ms=max(d["win_io"][key]["max_us"] for d in ds)/1000)
                    require(report["diagnostics"]["win_io"]["WriteFile"]["count"]>0,"Windows I/O trace inactive")
                worst=max(ds,key=lambda d:d["slowest_insert"]["step_us"])
                report["diagnostics"]["slowest_insert"]=worst["slowest_insert"]
                report["diagnostics"]["slowest_insert_app"]=ds.index(worst)
                require(report["diagnostics"]["insert_step"]["count"]==expected_pub,"insert sample count")
                require(report["diagnostics"]["writer_wait"]["count"]==transactions,"writer wait sample count")
                require(sum(d["message_transactions"] for d in ds)==transactions,"runtime transaction count")
                require(sum(d["batched_messages"] for d in ds)==multi_messages,"runtime batch count")
                require(report["diagnostics"]["explicit_commit"]["count"]==multi_transactions,"explicit commit count")
                for key in ("raw_rows","raw_bytes","filtered_polls"):
                    report["diagnostics"][key]=sum(d[key] for d in ds)
                if filtered:
                    require(report["diagnostics"]["filtered_polls"]>0 and report["diagnostics"]["raw_rows"]==expected_rx,"filtered row count mismatch")
                require(report["diagnostics"]["checkpoint_errors"]==0,"checkpoint errors")
                mode=diagnostic_args[1]
                interval={"owner100":100,"owner250":250,"separate_normal":1000,
                          "separate_off":1000,"separate_5s":5000}.get(mode,0)
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
                if config["win_io_trace"]:
                    report["diagnostics"]["maintenance_io"]={key:dict(count=value["count"],
                        total_ms=value["total_us"]/1000,max_ms=value["max_us"]/1000)
                        for key,value in ds[0]["maintenance_io"].items()}
                report["wal_warning_64_mib"]=peak_wal>=64*1024**2
                report["wal_exceeded_256_mib"]=peak_wal>=256*1024**2
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
            report["worker_log_tails"]={}
            for p in logs:
                if p.exists() and p.stat().st_size:
                    tail=p.read_text(errors="replace")[-2000:]
                    report["worker_log_tails"][p.name]=tail
                    print(p.name,tail,file=sys.stderr)
            report["resource_samples"]=samples
            report["sampled_peak_wal_bytes"]=peak_wal
            report["sampled_peak_db_bytes"]=peak_db
            raise
        finally:
            for p in processes:
                if p.poll() is None:p.kill()
                p.wait()
            if diagnostic_args and diagnostic_args[1].startswith(("root_","separate_")):
                # Keep full per-worker logs, not just a tail. Summarize
                # longest observed stage/phase/syscall for each peer.
                log_dir=output.with_suffix(".logs")
                log_dir.mkdir(exist_ok=True)
                maxima=[]
                for p in logs:
                    if not p.exists():continue
                    shutil.copyfile(p,log_dir/p.name)
                    observed={}
                    for line in p.read_text(errors="replace").splitlines():
                        if not line.startswith("writer_stall "):continue
                        try:
                            v=json.loads(line[len("writer_stall "):])
                            for field,detail in (("stage",v),("phase",v.get("phase",{})),("win_io",v.get("win_io",{})),
                                                 ("maintenance_activity",v.get("maintenance_activity",{})),
                                                 ("maintenance_io",v.get("maintenance_io",{}))):
                                label=detail.get("stage",detail.get("operation","none"))
                                if label in ("idle","none"):continue
                                key=field+":"+label
                                if detail.get("elapsed_ms",0)>observed.get(key,{}).get("elapsed_ms",0):
                                    observed[key]=dict(elapsed_ms=detail["elapsed_ms"],snapshot=v)
                        except (ValueError,KeyError,TypeError):pass
                    if observed:maxima.append(dict(worker=p.stem,observed=observed))
                report["stall_maxima"]=maxima
                print("rootcause stall summary",json.dumps(maxima),flush=True)
except Exception as e:
    report["error"]=str(e)
    raise
finally:
    output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,sort_keys=True),flush=True)
