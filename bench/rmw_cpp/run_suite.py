#!/usr/bin/env python3
"""Identical rclcpp workloads across three RMW implementations, with process isolation."""
import csv
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent
BINARY = Path(os.environ.get("BENCH_BINARY", "/tmp/rmw-bench-build/rmw_bench"))
OUT = Path("rmw-cpp-results")
OUT.mkdir(parents=True, exist_ok=True)
STACKS = [
    ("CycloneDDS", "rmw_cyclonedds_cpp"),
    ("FastDDS", "rmw_fastrtps_cpp"),
    ("Zenoh", "rmw_zenoh_cpp"),
]
NODES = [2, 4, 8, 16]
PAYLOADS = [1024, 16384]
REPEATS = int(os.environ.get("BENCH_REPEATS", "2"))
SECONDS = float(os.environ.get("BENCH_SECONDS", "2.5"))
FIELDS = [
    "trial", "profile", "stack", "rmw", "nodes", "subscribers", "payload_bytes",
    "requested_hz", "discovered_subscribers", "graph_discovery_ms", "ready_to_graph_ms",
    "sent", "achieved_pub_hz", "mean_received_hz", "min_received_hz",
    "mean_goodput_mib_s", "aggregate_goodput_mib_s", "delivery_percent",
    "median_p50_us", "median_p99_us", "duplicates", "seq_gaps",
    "status",
]

def wait_until(check, seconds, procs=()):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return True
        if any(p.poll() is not None and p.returncode != 0 for p in procs):
            return False
        time.sleep(0.025)
    return check()

def run_case(trial, case_id, profile, stack, rmw, nodes, payload, rate):
    work = Path(tempfile.mkdtemp(prefix="ros_cpp_rmw_"))
    processes = []
    log_files = []
    zenoh_router = None
    cyclone_roudi = None
    env = os.environ.copy()
    env["RMW_IMPLEMENTATION"] = rmw
    env["ROS_DOMAIN_ID"] = str(20 + (case_id % 160))
    env["RCUTILS_LOGGING_USE_STDOUT"] = "1"
    subs = nodes - 1
    topic = "/cpp_bench/topic_" + str(case_id)
    port_params = [
        "--directory", str(work), "--topic", topic,
        "--subscribers", str(subs), "--bytes", str(payload),
        "--rate", str(rate), "--seconds", str(SECONDS),
    ]

    def launch(role, idx):
        fp = (work / f"{role}_{idx}.log").open("w")
        log_files.append(fp)
        p = subprocess.Popen(
            [str(BINARY), "--role", role, "--id", str(idx)] + port_params,
            env=env, stdout=fp, stderr=subprocess.STDOUT,
        )
        processes.append(p)
        return p

    status = "ok"
    try:
        if rmw == "rmw_cyclonedds_cpp" and env.get("CYCLONEDDS_URI"):
            # iceoryx transport requires the RouDi shared-memory daemon.
            import shutil
            roudi_path = shutil.which("iox-roudi")
            if not roudi_path:
                status = "roudi_unavailable"
            else:
                roudi_log = (work / "iceoryx_roudi.log").open("w")
                log_files.append(roudi_log)
                cyclone_roudi = subprocess.Popen(
                    [roudi_path], env=env, stdout=roudi_log, stderr=subprocess.STDOUT
                )
                time.sleep(1.0)
                if cyclone_roudi.poll() is not None:
                    status = "roudi_start_failure"
        if status == "ok" and rmw == "rmw_zenoh_cpp":
            # Isolate Zenoh router graph state between independent scenarios.
            # Router startup is not included in the measured publisher graph time.
            router_path = os.environ.get(
                "BENCH_ZENOH_ROUTER", "/opt/ros/jazzy/lib/rmw_zenoh_cpp/rmw_zenohd"
            )
            router_log = (work / "zenoh_router.log").open("w")
            log_files.append(router_log)
            zenoh_router = subprocess.Popen(
                [router_path], env=env, stdout=router_log, stderr=subprocess.STDOUT
            )
            time.sleep(1.0)
            if zenoh_router.poll() is not None:
                status = "router_start_failure"
        if status == "ok":
            for i in range(subs):
                launch("sub", i)
                # Prevent simultaneous graph endpoint bursts on a 4-vCPU runner.
                time.sleep(0.015)
        if not wait_until(
            lambda: all((work / f"ready_{i}").exists() for i in range(subs)),
            20, processes,
        ):
            status = "subscriber_ready_failure"
        if status == "ok":
            pub = launch("pub", 0)
            if not wait_until(
                lambda: (work / "graph_ready").exists() or (work / "publisher_failure").exists(),
                20, [pub],
            ) or (work / "publisher_failure").exists():
                status = "graph_discovery_failure"
        if status == "ok":
            (work / "GO").write_text(str(time.monotonic_ns()))
            if not wait_until(lambda: (work / "publisher.json").exists(), SECONDS + 12, [pub]):
                status = "publisher_failure"
        for p in processes:
            try:
                p.wait(timeout=8 if status == "ok" else 1)
            except subprocess.TimeoutExpired:
                status = "worker_timeout"
    finally:
        for p in processes:
            if p.poll() is None:
                p.terminate()
        for p in processes:
            try:
                p.wait(timeout=1.5)
            except subprocess.TimeoutExpired:
                p.kill()
        if cyclone_roudi is not None:
            if cyclone_roudi.poll() is None:
                cyclone_roudi.terminate()
            try:
                cyclone_roudi.wait(timeout=3)
            except subprocess.TimeoutExpired:
                cyclone_roudi.kill()
                cyclone_roudi.wait(timeout=2)
        if zenoh_router is not None:
            if zenoh_router.poll() is None:
                zenoh_router.terminate()
            try:
                zenoh_router.wait(timeout=3)
            except subprocess.TimeoutExpired:
                zenoh_router.kill()
                zenoh_router.wait(timeout=2)
        for f in log_files:
            f.close()

    def read_json(name, default):
        try:
            return json.loads((work / name).read_text())
        except (FileNotFoundError, ValueError):
            return default

    pub_stats = read_json("publisher.json", {})
    results = [read_json(f"subscriber_{i}.json", {}) for i in range(subs)]
    sent = int(pub_stats.get("sent", 0))
    elapsed = float(pub_stats.get("send_seconds", SECONDS))
    elapsed = max(elapsed, 0.001)
    receives = [int(r.get("received", 0)) for r in results]
    p50 = [float(r["p50_us"]) for r in results if r.get("received", 0)]
    p99 = [float(r["p99_us"]) for r in results if r.get("received", 0)]
    if status == "ok" and (not sent or len([r for r in results if r]) != subs):
        status = "incomplete_results"
    if status == "ok" and any(n == 0 for n in receives):
        status = "zero_delivery"
    if status == "ok" and any(p.returncode != 0 for p in processes):
        status = "worker_exit_failure"
    if status == "ok" and rmw == "rmw_zenoh_cpp" and env.get("ZENOH_CONFIG_OVERRIDE", "").find("shared_memory/enabled=true") >= 0:
        if any("Error creating lazy ShmProvider" in p.read_text(errors="replace") or
               "Unable to create POSIX shm segment" in p.read_text(errors="replace")
               for p in work.glob("*.log")):
            status = "shm_allocation_failure"
    total_received = sum(receives)
    row = dict(
        trial=trial, profile=profile, stack=stack, rmw=rmw, nodes=nodes, subscribers=subs,
        payload_bytes=payload, requested_hz=rate,
        discovered_subscribers=int(pub_stats.get("matched", 0)),
        graph_discovery_ms=round(float(pub_stats.get("cold_to_graph_ms", 0)), 3),
        ready_to_graph_ms=round(float(pub_stats.get("startup_to_graph_ms", 0)), 3),
        sent=sent, achieved_pub_hz=round(sent / elapsed, 1),
        mean_received_hz=round(statistics.mean(receives) / elapsed, 1),
        min_received_hz=round(min(receives) / elapsed, 1),
        mean_goodput_mib_s=round(statistics.mean(receives) * payload / elapsed / 1048576, 3),
        aggregate_goodput_mib_s=round(total_received * payload / elapsed / 1048576, 3),
        delivery_percent=round(statistics.mean(receives) / sent * 100, 2) if sent else 0,
        median_p50_us=round(statistics.median(p50), 1) if p50 else None,
        median_p99_us=round(statistics.median(p99), 1) if p99 else None,
        duplicates=sum(r.get("duplicates", 0) for r in results),
        seq_gaps=sum(r.get("gaps", 0) for r in results),
        status=status,
    )
    with (OUT / f"case_{case_id:03d}.txt").open("w") as f:
        f.write(json.dumps(row, indent=2) + "\n")
        f.write("publisher.json: " + json.dumps(pub_stats) + "\n")
        f.write("subscribers.json: " + json.dumps(results) + "\n")
        for log in sorted(work.glob("*.log")):
            f.write("\n=== " + log.name + " ===\n")
            f.write(log.read_text(errors="replace")[-2500:] + "\n")
        failure = work / "publisher_failure"
        if failure.exists():
            f.write("\n" + failure.read_text())
    return row

def dump(rows):
    with (OUT / "results.csv").open("w", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=FIELDS)
        wr.writeheader()
        wr.writerows(rows)
    (OUT / "results.json").write_text(json.dumps(rows, indent=2))

def main():
    if not BINARY.is_file():
        raise RuntimeError(f"binary not found: {BINARY}")
    rows = []
    count = 0
    failed = 0
    print("trial,profile,stack,nodes,bytes,offered_hz,graph_ms,publisher_hz,mean_goodput_MiBs,delivery_pct,p99_us,status", flush=True)
    baseline = [("baseline", payload, nodes, 4000 if payload == 1024 else 1500)
                for payload in PAYLOADS for nodes in NODES]
    stress = [("stress", 1024, n, 16000) for n in (2, 16)] + [
        ("stress", 16384, n, 4000) for n in (2, 16)]
    try:
        for trial in range(1, REPEATS + 1):
            rotated = STACKS[(trial - 1) % 3:] + STACKS[:(trial - 1) % 3]
            for profile, payload, nodes, rate in baseline + stress:
                for stack, rmw in rotated:
                    count += 1
                    row = run_case(trial, count, profile, stack, rmw, nodes, payload, rate)
                    rows.append(row)
                    failed += (row["status"] != "ok")
                    print(",".join(str(v) for v in (
                        trial, profile, stack, nodes, payload, rate, row["graph_discovery_ms"],
                        row["achieved_pub_hz"], row["mean_goodput_mib_s"],
                        row["delivery_percent"], row["median_p99_us"], row["status"]
                    )), flush=True)
                    dump(rows)
    finally:
        dump(rows)
    print(f"FINISHED cases={len(rows)} failed={failed}", flush=True)
    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
