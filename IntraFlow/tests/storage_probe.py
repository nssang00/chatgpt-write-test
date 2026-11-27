"""Independent Windows storage probes; no IntraFlow, no concurrent IPC."""
import ctypes
import json
import math
import msvcrt
import os
import pathlib
import sqlite3
import sys
import tempfile
import time
from contextlib import closing
from ctypes import wintypes

out=pathlib.Path(sys.argv[1]);out.parent.mkdir(parents=True,exist_ok=True)
seconds=int(sys.argv[2]) if len(sys.argv)>2 else 120
if not 5<=seconds<=600:raise ValueError("duration")
flush=ctypes.WinDLL("kernel32",use_last_error=True).FlushFileBuffers
flush.argtypes=[wintypes.HANDLE];flush.restype=wintypes.BOOL
def summary(samples):
    if not samples:return dict(count=0)
    a=sorted(samples)
    return dict(count=len(a),mean_ms=sum(a)/len(a),p50_ms=a[math.ceil(.5*len(a))-1],
        p99_ms=a[math.ceil(.99*len(a))-1],max_ms=a[-1],
        over_100ms=sum(x>=100 for x in a),over_1000ms=sum(x>=1000 for x in a),
        over_5000ms=sum(x>=5000 for x in a))
def measure(f):
    t=time.perf_counter();f();return (time.perf_counter()-t)*1000
def sync(fd):
    if not flush(msvcrt.get_osfhandle(fd)):raise ctypes.WinError(ctypes.get_last_error())
def raw_probe(root):
    writes=[];syncs=[];events=[]
    with open(root/"raw.bin","w+b",buffering=0) as f:
        block=os.urandom(65536)
        f.write(block*64);sync(f.fileno())
        start=time.monotonic();i=0
        while time.monotonic()-start<seconds:
            f.seek((i%64)*len(block))
            w=measure(lambda:f.write(block));s=measure(lambda:sync(f.fileno()))
            writes.append(w);syncs.append(s)
            if max(w,s)>=500:
                event=dict(iteration=i,write_ms=w,flush_ms=s)
                events.append(event);print("storage stall",json.dumps(event),flush=True)
            i+=1;time.sleep(max(0,start+i*.1-time.monotonic()))
    return dict(write=summary(writes),flush=summary(syncs),events=events)
def sql_probe(root):
    inserts=[];checks=[];events=[]
    with closing(sqlite3.connect(root/"single.db",isolation_level=None)) as c:
        assert c.execute("PRAGMA journal_mode=WAL").fetchone()[0]=="wal"
        c.execute("PRAGMA synchronous=NORMAL");c.execute("PRAGMA wal_autocheckpoint=0")
        c.execute("CREATE TABLE messages(id INTEGER PRIMARY KEY,payload TEXT)")
        c.execute("CREATE INDEX by_payload ON messages(payload)")
        payload="x"*512;start=time.monotonic();next_cp=start+1;i=0
        while time.monotonic()-start<seconds:
            m=measure(lambda:c.execute("INSERT INTO messages VALUES(?,?)",(i,payload)))
            inserts.append(m);i+=1
            if time.monotonic()>=next_cp:
                cp=measure(lambda:c.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone())
                checks.append(cp);next_cp=time.monotonic()+1
                if cp>=500:
                    event=dict(iteration=i,checkpoint_ms=cp)
                    events.append(event);print("single sqlite stall",json.dumps(event),flush=True)
            time.sleep(max(0,start+i/300-time.monotonic()))
        assert c.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
        assert c.execute("SELECT COUNT(*) FROM messages").fetchone()[0]==i
        c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return dict(sqlite_version=sqlite3.sqlite_version,inserts=summary(inserts),
                checkpoints=summary(checks),events=events)
bases=[pathlib.Path(tempfile.gettempdir()),pathlib.Path(os.environ.get("GITHUB_WORKSPACE",os.getcwd()))]
report=dict(seconds=seconds,probes=[])
seen=set()
# Alternate volume ordering across independent runs in CI.
if os.environ.get("INTRAFLOW_REVERSE_VOLUMES")=="1":bases.reverse()
try:
    for base in bases:
        volume=base.anchor.casefold()
        if volume in seen:continue
        seen.add(volume)
        entry=dict(volume=base.anchor,base=str(base));report["probes"].append(entry)
        with tempfile.TemporaryDirectory(prefix="intraflow-storage-",dir=base) as tmp:
            root=pathlib.Path(tmp)
            entry["raw"]=raw_probe(root)
            entry["single_sqlite"]=sql_probe(root)
        print("storage probe",json.dumps(entry),flush=True)
finally:
    out.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
