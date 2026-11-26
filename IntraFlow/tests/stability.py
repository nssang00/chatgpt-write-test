import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing

exe=sys.argv[1]
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory)
    db, ready=root/"messages.db", root/"ready"
    subprocess.run([exe,"concurrent",str(db),str(ready)],check=True,timeout=45)
    crash=subprocess.Popen([exe,"crash",str(db),str(ready)])
    try:
        deadline=time.monotonic()+15
        while not ready.exists():
            if crash.poll() is not None or time.monotonic()>=deadline:
                raise RuntimeError("crash setup failed")
            time.sleep(.02)
        crash.kill()
        crash.wait(timeout=5)
    finally:
        if crash.poll() is None:
            crash.kill()
        crash.wait()
    subprocess.run([exe,"reopen",str(db),str(ready)],check=True,timeout=15)
    with closing(sqlite3.connect(db)) as conn:
        import json
        rows=conn.execute("SELECT payload FROM messages WHERE topic='committed' ORDER BY seq").fetchall()
        assert [json.loads(p)["code"] for p, in rows]==[111,333]
        assert conn.execute("SELECT count(*) FROM messages WHERE topic='concurrent'").fetchone()[0]==400
        assert conn.execute("SELECT count(*) FROM messages WHERE topic='late'").fetchone()[0]==2
        assert conn.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
