import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing

exe=sys.argv[1]
with tempfile.TemporaryDirectory() as tmp:
    root=pathlib.Path(tmp)
    db=root/"writer.db"
    ready,held,go,timed=(root/x for x in ("ready","held","go","timed"))
    subprocess.run([exe,"init",str(db)],check=True,timeout=10)
    children=[]
    def wait(path,p):
        end=time.monotonic()+15
        while not path.exists():
            if p.poll() is not None or time.monotonic()>=end:
                raise RuntimeError("barrier "+str(path))
            time.sleep(.01)
    try:
        receiver=subprocess.Popen([exe,"wait",str(db),str(ready),str(go),str(timed)])
        children.append(receiver);wait(ready,receiver)
        holder=subprocess.Popen([exe,"hold",str(db),str(held)])
        children.append(holder);wait(held,holder)
        go.touch();wait(timed,receiver)
        holder.kill();holder.wait(timeout=10)
        subprocess.run([exe,"recover",str(db)],check=True,timeout=20)
        assert receiver.wait(timeout=20)==0
        with closing(sqlite3.connect(db)) as c:
            assert c.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
            assert c.execute("SELECT seq FROM messages ORDER BY seq").fetchall()==[(i,) for i in range(1,103)]
            assert c.execute("SELECT COUNT(*) FROM messages WHERE sender='uncommitted'").fetchone()[0]==0
        print("PASS: writer timeout, killed lock owner, SQLite rollback, independent sessions, policy mismatch")
    finally:
        for p in children:
            if p.poll() is None:p.kill()
            p.wait()
