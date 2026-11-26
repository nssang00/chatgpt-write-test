"""Thirty independent applications, four publish and eight subscribe topics each."""
import json
import math
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing

try:
    import psutil
except ImportError:
    psutil = None

exe, profile, output = sys.argv[1:]
output = pathlib.Path(output)
output.parent.mkdir(parents=True, exist_ok=True)
snapshot = output.with_suffix(".db")
if snapshot.exists():
    snapshot.unlink()
peers, groups, duration = 30, 6, 6000
names = ("sensor", "status", "command", "log")
types = ("TrafficSensor", "TrafficStatus", "TrafficCommand", "TrafficLog")
periods = [10, 20, 50, 100] if profile == "fast" else [20, 40, 100, 200]
counts = [duration // p for p in periods]
expected_pub = peers * sum(counts)
expected_rx = expected_pub * 10
report = dict(status="FAIL", profile=profile, processes=peers, topics=24,
              subscriptions=240, target_duration_ms=duration, periods_ms=dict(zip(names, periods)),
              expected_publishes=expected_pub, expected_deliveries=expected_rx)

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
        next_idx = [[0]*4 for _ in range(peers)]
        raw_bytes = 0
        for t,sender,payload in conn.execute("SELECT topic,sender,payload FROM messages ORDER BY seq"):
            _,g,n = t.split(".")
            k=names.index(n)
            m=json.loads(payload)
            h=m["header"]
            src,idx=h["source"],h["index"]
            require(0<=src<peers and src%groups==int(g) and sender==f"TrafficApp{src}" and
                    idx==next_idx[src][k] and idx<counts[k] and h["sent_us"]>0, "DB sequence/publisher mismatch")
            next_idx[src][k]+=1
            raw_bytes+=len(payload.encode("utf-8"))
            if k==3:
                require(m["text"]==chr(65+src%26)*4096, "DB log mismatch")
        require(all(row==counts for row in next_idx),"DB history count mismatch")
        require(conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0]==0,"checkpoint failed")
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
        peak_rss=peak_threads=0
        last_sample=0
        def sample(force=False):
            global last_sample,peak_rss,peak_threads
            now=time.monotonic()
            if psutil is None or (not force and now-last_sample<.25):
                return
            last_sample=now
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
        def wait_all(paths,timeout):
            deadline=time.monotonic()+timeout
            while not all(p.exists() for p in paths):
                require(not any(p.poll() is not None for p in processes),"worker exited before barrier")
                require(time.monotonic()<deadline,"barrier timeout")
                sample()
                time.sleep(.02)
        try:
            for i in range(peers):
                r,s,j,l=(root/f"{i}.{ext}" for ext in ("ready","sent","json","log"))
                ready.append(r);sent.append(s);results.append(j);logs.append(l)
                with l.open("wb") as out:
                    p=subprocess.Popen([exe,str(i),str(duration),profile,str(db),str(r),str(go),str(s),str(drain),str(j),str(release)],stdout=out,stderr=subprocess.STDOUT)
                processes.append(p)
                if psutil:
                    try: sampled.append(psutil.Process(p.pid))
                    except psutil.NoSuchProcess: pass
            wait_all(ready,60)
            sample(True)
            start=time.monotonic()
            go.touch()
            wait_all(sent,180)
            send_elapsed=time.monotonic()-start
            drain.touch()
            wait_all(results,60)
            elapsed=time.monotonic()-start
            sample(True)
            rows=[json.loads(p.read_text()) for p in results]
            published=sum(sum(r["published"]) for r in rows)
            received=sum(sum(r["received"]) for r in rows)
            report.update(actual_publishes=published, actual_deliveries=received,
                          missing=expected_rx-received,
                          duplicates=sum(r["duplicates"] for r in rows),
                          invalid=sum(r["invalid"] for r in rows),
                          out_of_order=sum(r["out_of_order"] for r in rows),
                          send_elapsed_seconds=send_elapsed, elapsed_seconds=elapsed,
                          publish_rate_per_second=published/send_elapsed,
                          delivery_rate_per_second=received/elapsed,
                          sampled_peak_rss_mib=peak_rss/1048576 if psutil else None,
                          sampled_peak_threads=peak_threads if psutil else None,
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
                for k in range(4):
                    require(len(r["latency_us"][k])==10*counts[k] and len(r["publish_us"][k])==counts[k] and
                            len(r["lateness_us"][k])==counts[k] and len(r["gaps_us"][k])==counts[k]-1,"timing sample mismatch")
            release.touch()
            deadline=time.monotonic()+20
            for p in processes:
                require(p.wait(timeout=max(.1,deadline-time.monotonic()))==0,"worker failed")
            report["payload_bytes"]=verify_db(db)
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
