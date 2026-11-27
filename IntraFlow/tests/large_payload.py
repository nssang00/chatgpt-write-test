import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing

exe, path = sys.argv[1:]
db = pathlib.Path(path)
db.parent.mkdir(parents=True, exist_ok=True)
for suffix in ("", "-wal", "-shm"):
    p = pathlib.Path(str(db) + suffix)
    if p.exists():
        p.unlink()
with tempfile.TemporaryDirectory() as directory:
    ready = pathlib.Path(directory) / "ready"
    receiver = subprocess.Popen([exe, "receiver", str(db), str(ready)])
    try:
        deadline = time.monotonic() + 20
        while not ready.exists():
            if receiver.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError("receiver startup failed")
            time.sleep(.02)
        subprocess.run([exe, "publisher", str(db), str(ready)], check=True, timeout=30)
        if receiver.wait(timeout=35):
            raise RuntimeError("receiver failed")
    finally:
        if receiver.poll() is None:
            receiver.kill()
        receiver.wait()
with closing(sqlite3.connect(db)) as conn:
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0] == 0
    rows = conn.execute("SELECT topic,sender,typeof(payload),payload FROM messages").fetchall()
    assert len(rows) == 1
    topic, sender, storage, raw = rows[0]
    assert (topic, sender, storage) == ("device.data", "publisher", "text")
    data = json.loads(raw)
    assert data["id"] == 42 and len(data["temperatures"]) == 128
    assert data["channels"] == list(range(256))
    assert data["matrix"] == [[i*16+j for j in range(16)] for i in range(16)]
    assert len(data["positions"]) == 32 and data["positions"][-1]["x"] == 31
    assert data["trajectory"] == [data["positions"][-1]] * 8
    assert data["samples"] == [1.25] * 1024
    assert data["labels"] == ["Motor"] * 32
    assert data["descriptions"] == ["first", 'line\nwith "quotes"', "\uD55C\uAE00"]
    assert data["document"] == "\n" + "D"*(512*1024-2) + '"'
    assert data["largeText"] == "L"*(256*1024)
    assert data["boundedSamples"] == [7]*1024
    typename, schema_hash, schema = conn.execute("SELECT type,hash,schema FROM topics WHERE name=?", (topic,)).fetchone()
    assert typename == "DeviceData" and len(schema_hash) == 64
    fields = dict(json.loads(schema)["fields"])
    assert fields["matrix"] == ["array", ["array", "float", 16], 16]
    assert fields["largeText"] == ["string", 262144]
    print("verified SQLite TEXT JSON bytes:", len(raw.encode("utf-8")))
print("inspectable DB:", db)
