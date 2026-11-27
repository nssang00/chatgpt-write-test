import pathlib,sqlite3,subprocess,sys,tempfile,time
from contextlib import closing
exe,mode=sys.argv[1:3]
with tempfile.TemporaryDirectory() as d:
    root=pathlib.Path(d);db=root/"test.db";ready=root/"ready"
    p=subprocess.Popen([exe,"hold",str(db),mode,str(ready)])
    try:
        end=time.monotonic()+20
        while not ready.exists():
            if p.poll() is not None or time.monotonic()>end:raise RuntimeError("ready")
            time.sleep(.01)
        p.kill();p.wait(timeout=10)
        subprocess.run([exe,"recover",str(db),mode],check=True,timeout=30)
        with closing(sqlite3.connect(db)) as c:
            assert c.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
            assert c.execute("SELECT seq FROM messages ORDER BY seq").fetchall()==[(i,) for i in range(1,102)]
            assert c.execute("SELECT COUNT(*) FROM messages WHERE sender='uncommitted'").fetchone()[0]==0
        print("PASS:",mode,"process kill/reopen/rollback; not OS crash or power-loss proof")
    finally:
        if p.poll() is None:p.kill()
        p.wait()
