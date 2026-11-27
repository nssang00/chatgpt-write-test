import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing

with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    db = root / "messages.db"
    apps = []
    def start(exe, name):
        log = root / (name + ".log")
        with log.open("wb") as out:
            process = subprocess.Popen([exe, str(db)], stdin=subprocess.PIPE,
                                       stdout=out, stderr=subprocess.STDOUT)
        apps.append((process, log))
        wait(process, log, "READY")
        return process, log
    def wait(process, log, text):
        deadline = time.monotonic()+15
        while text not in log.read_text(errors="replace"):
            if process.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError(str(log)+": "+log.read_text(errors="replace"))
            time.sleep(.02)
    def send(process, text):
        process.stdin.write(text.encode("ascii")+b"\n")
        process.stdin.flush()
    try:
        sensor, control, device, display, monitor = sys.argv[1:]
        m, ml = start(monitor, "monitor")
        d, dl = start(display, "display")
        dev, devl = start(device, "device")
        c, cl = start(control, "control")
        s, sl = start(sensor, "sensor")
        send(s, "25.5")
        wait(d, dl, "SENSOR 25.5")
        wait(d, dl, "STATUS 1")
        wait(s, sl, "COMMAND 1")
        wait(c, cl, "STATUS 1")
        wait(m, ml, "DeviceApp system.status")
        d.kill()
        d.wait(timeout=5)
        d2, dl2 = start(display, "display-restarted")
        send(s, "20.5")
        wait(d2, dl2, "SENSOR 20.5")
        wait(d2, dl2, "STATUS 0")
        wait(s, sl, "COMMAND 0")
        if "SENSOR 25.5" in dl2.read_text(errors="replace"):
            raise RuntimeError("unexpected replay after restart")
        send(s, "q")
        for p in (m,dev,c,d2):
            send(p, "")
        for p in (s,m,dev,c,d2):
            if p.wait(timeout=10):
                raise RuntimeError("example exit failed")
        with closing(sqlite3.connect(db)) as conn:
            rows=conn.execute("SELECT topic FROM messages ORDER BY seq").fetchall()
            assert rows==[(t,) for t in ("sensor.data","system.command","system.status")*2]
            assert conn.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
    finally:
        for p, log in apps:
            if p.poll() is None:
                p.kill()
            p.wait()
            if p.stdin:
                p.stdin.close()
            print(log.name, log.read_text(errors="replace"))
