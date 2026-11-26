import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing

exe, mode = sys.argv[1:]
roles = ["sensor", "control", "device", "display", "monitor"] if mode == "roles" else ["peer%d" % i for i in range(int(mode))]
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    db, go = root / "messages.db", root / "go"
    with closing(sqlite3.connect(db)) as conn:
        conn.execute("PRAGMA journal_mode=WAL").fetchone()
    processes = []
    try:
        for role in roles:
            ready = root / (role + ".ready")
            p = subprocess.Popen([exe, role, str(db), str(ready), str(go), str(len(roles))])
            processes.append((p, ready))
        deadline = time.monotonic() + 30
        while not all(ready.exists() for _, ready in processes):
            if time.monotonic() > deadline or any(p.poll() is not None for p, _ in processes):
                raise RuntimeError("startup failed")
            time.sleep(.02)
        go.touch()
        for p, _ in processes:
            if p.wait(timeout=40):
                raise RuntimeError("application failed")
        with closing(sqlite3.connect(db)) as conn:
            actual = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
            expected = 3 if mode == "roles" else len(roles)
            if actual != expected:
                raise RuntimeError("unexpected history count: %d != %d" % (actual, expected))
    finally:
        for p, _ in processes:
            if p.poll() is None:
                p.kill()
            p.wait()
