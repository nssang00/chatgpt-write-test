#!/usr/bin/env python3
"""Process-scaling, cold-first-message and one-to-many goodput benchmark."""
import csv
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import time

IMPLS = ["dds-cyclone", "dds-fast", "zenoh", "grpc"]
NODES = [2, 4, 8, 16]
SIZES = [1024, 16384]
SECONDS = 2.5
HERE = Path(__file__).resolve().parent
OUT = Path("middleware-results")
OUT.mkdir(exist_ok=True)
FIELDS = ["impl","total_nodes","subscribers","payload_bytes","offered_hz",
          "discovered","discovery_median_ms","discovery_max_ms",
          "sent","publisher_hz","subscriber_mean_hz","subscriber_min_hz",
          "mean_goodput_mib_s","aggregate_goodput_mib_s","delivery_percent",
          "grpc_queued_drops","status"]
def wait_until(predicate, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.03)
    return predicate()

def run_case(impl, nodes, payload_bytes, caseid):
    workdir = Path(tempfile.mkdtemp(prefix="mw_case_"))
    logs = []
    processes = []
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["ROS_DOMAIN_ID"] = str(20 + caseid)
    env["ROS_AUTOMATIC_DISCOVERY_RANGE"] = "LOCALHOST"
    env["ROS_LOCALHOST_ONLY"] = "1"
    if impl.startswith("dds-"):
        env["RMW_IMPLEMENTATION"] = ("rmw_cyclonedds_cpp" if impl == "dds-cyclone"
                                      else "rmw_fastrtps_cpp")
    num_subs = nodes-1
    port = 48000 + caseid
    rate = 4000 if payload_bytes == 1024 else 1500
    topic = "mw_bench_case_" + str(caseid)
    if impl == "zenoh":
        topic = "mw/bench/case/" + str(caseid)
    args = ["--impl",impl,"--directory",str(workdir),"--topic",topic,
            "--bytes",str(payload_bytes),"--port",str(port),
            "--rate",str(rate),"--seconds",str(SECONDS)]
    def start(role, id):
        outpath = workdir / (role + "_" + str(id) + ".log")
        log = outpath.open("w")
        logs.append(log)
        p = subprocess.Popen([sys.executable, str(HERE / "node.py"),
                              "--role",role,"--id",str(id)] + args,
                              env=env, stdout=log, stderr=subprocess.STDOUT)
        processes.append(p)
        return p
    status = "ok"
    publisher_started_ns = None
    try:
        for i in range(num_subs):
            start("sub", i)
        if not wait_until(lambda: all((workdir / ("ready_" + str(i))).exists()
                                      for i in range(num_subs)), 15):
            status = "subscriber_ready_timeout"
        publisher_started_ns = time.monotonic_ns()
        start("pub", 0)
        if not wait_until(lambda: (workdir / "publisher_ready").exists(), 15):
            status = "publisher_ready_timeout"
        wait_until(lambda: all((workdir / ("first_" + str(i))).exists()
                               for i in range(num_subs)), 10)
        (workdir / "GO").write_text(str(time.monotonic_ns()))
        if not wait_until(lambda: (workdir / "publisher.json").exists(), SECONDS+12):
            status = "publisher_timeout"
        for p in processes:
            try:
                p.wait(timeout=7)
            except subprocess.TimeoutExpired:
                if status == "ok":
                    status = "worker_timeout"
    finally:
        for p in processes:
            if p.poll() is None:
                p.terminate()
        for p in processes:
            try:
                p.wait(timeout=2)
            except subprocess.TimeoutExpired:
                p.kill()
        for f in logs:
            f.close()
    try:
        pub = json.loads((workdir / "publisher.json").read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        pub = {"sent":0,"send_seconds":SECONDS,"grpc_queue_drops":None}
    rx = []
    latency = []
    for i in range(num_subs):
        fp = workdir / ("subscriber_" + str(i) + ".json")
        if fp.exists():
            sub = json.loads(fp.read_text())
            rx.append(sub["received"])
        else:
            rx.append(0)
        first_path = workdir / ("first_" + str(i))
        if first_path.exists() and publisher_started_ns:
            latency.append((int(first_path.read_text())-publisher_started_ns)/1e6)
    sent = int(pub["sent"])
    duration = float(pub["send_seconds"])
    if len(latency) != num_subs and status == "ok":
        status = "discovery_partial"
    if not all((workdir / ("subscriber_" + str(i) + ".json")).exists()
               for i in range(num_subs)) and status == "ok":
        status = "subscriber_result_missing"
    if not sent and status == "ok":
        status = "no_messages_published"
    if sent and min(rx) == 0 and status == "ok":
        status = "no_data_received"
    mean_rx = statistics.mean(rx) if rx else 0
    row = {
        "impl":impl,"total_nodes":nodes,"subscribers":num_subs,
        "payload_bytes":payload_bytes,"offered_hz":rate,"discovered":len(latency),
        "discovery_median_ms":round(statistics.median(latency),2) if latency else None,
        "discovery_max_ms":round(max(latency),2) if latency else None,
        "sent":sent,"publisher_hz":round(sent/duration,1),
        "subscriber_mean_hz":round(mean_rx/duration,1),
        "subscriber_min_hz":round(min(rx)/duration,1),
        "mean_goodput_mib_s":round(mean_rx*payload_bytes/duration/1048576,3),
        "aggregate_goodput_mib_s":round(sum(rx)*payload_bytes/duration/1048576,3),
        "delivery_percent":round(mean_rx/sent*100,1) if sent else None,
        "grpc_queued_drops":pub.get("grpc_queue_drops"),"status":status,
    }
    with (OUT / ("case_" + str(caseid) + ".txt")).open("w") as f:
        f.write(json.dumps(row,indent=2)+"\n\n")
        for lp in sorted(workdir.glob("*.log")):
            f.write("=== " + lp.name + " ===\n")
            f.write(lp.read_text(errors="replace")[-4000:] + "\n")
    return row

def main():
    rows = []
    failed = 0
    idx = 0
    print("case,impl,nodes,payload,discovered,median_ms,min_hz,mean_MiBs,delivery_pct,status",flush=True)
    try:
        for size in SIZES:
            for nodes in NODES:
                for impl in IMPLS:
                    idx += 1
                    row = run_case(impl,nodes,size,idx)
                    rows.append(row)
                    if row["status"] != "ok":
                        failed += 1
                    print(",".join(map(str,[idx,impl,nodes,size,row["discovered"],
                          row["discovery_median_ms"],row["subscriber_min_hz"],
                          row["mean_goodput_mib_s"],row["delivery_percent"],
                          row["status"]])),flush=True)
                    with (OUT / "results.csv").open("w",newline="") as file:
                        writer = csv.DictWriter(file,fieldnames=FIELDS)
                        writer.writeheader()
                        writer.writerows(rows)
    finally:
        (OUT / "results.json").write_text(json.dumps(rows,indent=2))
    print("FINISHED cases={} failed={}".format(len(rows),failed),flush=True)
    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
