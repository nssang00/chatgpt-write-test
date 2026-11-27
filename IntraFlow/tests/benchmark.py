"""Concurrent full fan-out correctness/latency benchmark; JSON evidence per scale."""
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

exe, peers, rounds, output = sys.argv[1:]
peers, rounds = int(peers), int(rounds)
output = pathlib.Path(output)
output.parent.mkdir(parents=True, exist_ok=True)
expected = peers * rounds

def stats(values):
    values = sorted(values)
    if not values:
        raise RuntimeError("empty timing sample")
    def percentile(q):
        return values[max(0, math.ceil(len(values) * q) - 1)] / 1000
    return {"samples": len(values), "p50_ms": percentile(.5),
            "p95_ms": percentile(.95), "p99_ms": percentile(.99),
            "max_ms": values[-1] / 1000, "mean_ms": sum(values) / len(values) / 1000}

report = {"processes": peers, "messages_per_process": rounds,
          "expected_publishes": expected, "expected_deliveries": expected * peers,
          "status": "FAIL"}
try:
    with tempfile.TemporaryDirectory() as directory:
        root = pathlib.Path(directory)
        db, go, release = root / "bench.db", root / "go", root / "release"
        with closing(sqlite3.connect(db)) as conn:
            conn.execute("PRAGMA journal_mode=WAL").fetchone()
        processes, ready, results, logs = [], [], [], []
        sampled = []
        peak_rss = peak_threads = 0
        last_sample = 0
        def sample(force=False):
            global peak_rss, peak_threads, last_sample
            now = time.monotonic()
            if psutil is None or (not force and now - last_sample < .25):
                return
            last_sample = now
            rss = threads = 0
            for p in sampled:
                try:
                    with p.oneshot():
                        rss += p.memory_info().rss
                        threads += p.num_threads()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            peak_rss = max(peak_rss, rss)
            peak_threads = max(peak_threads, threads)
        def wait_all(paths, timeout):
            deadline = time.monotonic() + timeout
            while not all(path.exists() for path in paths):
                if any(p.poll() is not None for p in processes):
                    raise RuntimeError("worker exited before barrier")
                if time.monotonic() >= deadline:
                    raise RuntimeError("worker barrier timeout")
                sample()
                time.sleep(.02)
        try:
            for i in range(peers):
                r, result, log = root / ("%d.ready" % i), root / ("%d.json" % i), root / ("%d.log" % i)
                ready.append(r)
                results.append(result)
                logs.append(log)
                with log.open("wb") as handle:
                    p = subprocess.Popen([exe, str(i), str(peers), str(rounds), str(db),
                                          str(r), str(go), str(result), str(release)],
                                         stdout=handle, stderr=subprocess.STDOUT)
                processes.append(p)
                if psutil:
                    try:
                        sampled.append(psutil.Process(p.pid))
                    except psutil.NoSuchProcess:
                        pass
            wait_all(ready, 90)
            sample(True)
            start = time.monotonic()
            go.touch()
            wait_all(results, 110)
            elapsed = time.monotonic() - start
            sample(True)
            rows = [json.loads(path.read_text()) for path in results]
            latencies = [v for row in rows for v in row["latency_us"]]
            publishes = [v for row in rows for v in row["publish_us"]]
            count = sum(row["count"] for row in rows)
            duplicates = sum(row["duplicates"] for row in rows)
            invalid = sum(row["invalid"] for row in rows)
            report.update({"elapsed_seconds": elapsed, "deliveries": count,
                           "duplicates": duplicates, "invalid": invalid,
                           "missing": expected * peers - count,
                           "publish_rate_per_second": len(publishes) / elapsed,
                           "delivery_rate_per_second": count / elapsed,
                           "latency": stats(latencies) if latencies else None,
                           "publish_call": stats(publishes) if publishes else None,
                           "sampled_peak_rss_mib": peak_rss / 1048576 if psutil else None,
                           "sampled_peak_threads": peak_threads if psutil else None})
            with closing(sqlite3.connect(db)) as conn:
                total = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
                report["history_rows"] = total
            if (count != expected * peers or duplicates or invalid or
                total != expected or len(publishes) != expected or len(latencies) != count or
                any(row["id"] != i or row["count"] != expected or len(row["publish_us"]) != rounds
                    for i, row in enumerate(rows))):
                raise RuntimeError("fan-out matrix mismatch")
            release.touch()
            deadline = time.monotonic() + 20
            for p in processes:
                if p.wait(timeout=max(.1, deadline - time.monotonic())):
                    raise RuntimeError("worker failed")
            report["status"] = "PASS"
        except Exception:
            for path in logs:
                if path.exists() and path.stat().st_size:
                    print(path.name, path.read_text(errors="replace")[-1000:], file=sys.stderr)
            raise
        finally:
            for p in processes:
                if p.poll() is None:
                    p.kill()
                p.wait()
except Exception as e:
    report["error"] = str(e)
    raise
finally:
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True), flush=True)
