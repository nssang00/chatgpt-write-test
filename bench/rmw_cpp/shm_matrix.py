#!/usr/bin/env python3
"""Same ROS 2 Jazzy rclcpp executable, SHM ON/OFF with explicit runtime probes.

This is deliberately conservative: an ON config is not reported as verified
SHM unless evidence of process shared-memory mappings is captured.
"""
import csv
import glob
import json
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
import time
import run_suite as bench

ROOT = Path(__file__).resolve().parent
bench.OUT = Path("shm-matrix-results")
bench.OUT.mkdir(parents=True, exist_ok=True)
bench.SECONDS = float(os.environ.get("BENCH_SECONDS", "2.0"))
os.environ["BENCH_QOS_DEPTH"] = "16"   # iceoryx writer's documented max
os.environ["BENCH_PROBE_SHM"] = "1"
os.environ["ZENOH_SHM_ALLOC_SIZE"] = "16777216"
PHASE = os.environ.get("BENCH_PHASE", "smoke")
REPEATS = int(os.environ.get("BENCH_REPEATS", "3"))
STACKS = [
    ("Cyclone-NET", "rmw_cyclonedds_cpp", "off"),
    ("Cyclone-SHM", "rmw_cyclonedds_cpp", "on"),
    ("FastDDS-UDP", "rmw_fastrtps_cpp", "off"),
    ("FastDDS-SHM", "rmw_fastrtps_cpp", "on"),
    ("Zenoh-NET", "rmw_zenoh_cpp", "off"),
    ("Zenoh-SHM", "rmw_zenoh_cpp", "on"),
]
FIELDS = bench.FIELDS + ["shm_mode", "shm_claim", "proof_class"]
ROUDI = None
ROUDI_LOG = None
CYCLONE_URI = (ROOT / "cyclone_shm_on.xml").resolve().as_uri()

def launch_roudi():
    global ROUDI, ROUDI_LOG
    paths = [shutil.which("iox-roudi"), shutil.which("RouDiApp")]
    paths += glob.glob("/opt/ros/jazzy/lib/**/iox-roudi", recursive=True)
    paths += glob.glob("/opt/ros/jazzy/lib/**/RouDiApp", recursive=True)
    executable = next((p for p in paths if p and os.path.isfile(p)
                       and os.access(p, os.X_OK)), None)
    info = {"found": bool(executable), "path": executable}
    if executable:
        ROUDI_LOG = (bench.OUT / "roudi.log").open("w")
        ROUDI = subprocess.Popen([executable], stdout=ROUDI_LOG, stderr=subprocess.STDOUT)
        time.sleep(1.5)
        info["running"] = ROUDI.poll() is None
        info["exit_code"] = ROUDI.poll()
    else:
        info["running"] = False
    return info

def finish_roudi():
    if ROUDI is not None:
        if ROUDI.poll() is None:
            ROUDI.terminate()
        try:
            ROUDI.wait(timeout=3)
        except subprocess.TimeoutExpired:
            ROUDI.kill()
            ROUDI.wait(timeout=2)
    if ROUDI_LOG is not None:
        ROUDI_LOG.close()

def set_mode(stack, mode):
    for var in ("FASTDDS_BUILTIN_TRANSPORTS", "ZENOH_CONFIG_OVERRIDE",
                "CYCLONEDDS_URI", "ZENOH_SHM_ALLOC_SIZE"):
        os.environ.pop(var, None)
    os.environ["ZENOH_SHM_ALLOC_SIZE"] = "16777216"
    if stack.startswith("FastDDS"):
        os.environ["FASTDDS_BUILTIN_TRANSPORTS"] = "SHM" if mode == "on" else "UDPv4"
    elif stack.startswith("Zenoh"):
        os.environ["ZENOH_CONFIG_OVERRIDE"] = (
            "transport/shared_memory/enabled=true" if mode == "on" else
            "transport/shared_memory/enabled=false")
        os.environ["RUST_LOG"] = "warn"
    elif stack.startswith("Cyclone") and mode == "on":
        os.environ["CYCLONEDDS_URI"] = CYCLONE_URI

def assess(stack, mode, row):
    # Configuration alone does not certify that samples used shared memory.
    mapped = int(row["shm_mapping_count"])
    pids = int(row["shm_mapped_pids"])
    if row["status"] != "ok":
        return "case_failed"
    if mode == "off":
        return "network_selected"
    if mapped and pids >= 2:
        return "mapped_shm_observed"
    if mapped:
        return "shm_mapping_partial"
    return "configured_but_shm_not_observed"

def run_one(idx, trial, stack, rmw, mode, nodes, nbytes, offered_hz, profile):
    set_mode(stack, mode)
    r = bench.run_case(trial, idx, profile, stack, rmw, nodes, nbytes, offered_hz)
    r["shm_mode"] = mode
    r["proof_class"] = assess(stack, mode, r)
    r["shm_claim"] = ("observed_process_mappings" if
                      r["proof_class"] == "mapped_shm_observed" else "NOT_PROVEN")
    return r

def persist(rows, name):
    (bench.OUT / (name + ".json")).write_text(json.dumps(rows, indent=2))
    if rows:
        with (bench.OUT / (name + ".csv")).open("w", newline="") as fp:
            w = csv.DictWriter(fp, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(rows)

def log_row(row):
    print(",".join(str(row[k]) for k in
                   ("trial", "profile", "stack", "nodes", "payload_bytes",
                    "requested_hz", "achieved_pub_hz",
                    "mean_goodput_mib_s", "delivery_percent",
                    "median_p99_us", "shm_mapped_pids", "status",
                    "proof_class")), flush=True)

def main():
    versions = {
        "phase": PHASE, "qos": "reliable keep_last(16) volatile",
        "payload_type": "std_msgs/msg/UInt8MultiArray",
        "bin": str(bench.BINARY),
        "cyclone_uri": CYCLONE_URI,
        "shm_size": os.environ["ZENOH_SHM_ALLOC_SIZE"],
    }
    roudi = launch_roudi()
    versions["roudi"] = roudi
    (bench.OUT / "environment.json").write_text(json.dumps(versions, indent=2))
    (bench.OUT / "transport_modes.json").write_text(json.dumps(STACKS, indent=2))
    if not bench.BINARY.is_file():
        raise RuntimeError("missing C++ executable")
    print("trial,profile,stack,nodes,bytes,requested_hz,actual_hz,goodput,delivery,p99,shm_pids,status,proof",flush=True)
    smoke = []
    rows = []
    failures = 0
    idx = 0
    try:
        # Capability probe: Cyclone SHM requires RouDi, a working middleware
        # build and actual shared-memory evidence. No fallback is relabeled SHM.
        for stack, rmw, mode in STACKS:
            if stack == "Cyclone-SHM" and not roudi["running"]:
                print("SKIP Cyclone-SHM: no runnable iceoryx RouDi found", flush=True)
                continue
            idx += 1
            r = run_one(idx, 0, stack, rmw, mode, 2, 16384, 300, "capability_probe")
            smoke.append(r)
            persist(smoke, "smoke")
            log_row(r)
        preflights = {r["stack"]: r for r in smoke}
        usable = []
        exclusions = []
        for name, rmw, mode in STACKS:
            probe = preflights.get(name)
            if not probe or probe["status"] != "ok":
                exclusions.append({"stack": name, "reason": "unavailable_probe_failed",
                                   "details": probe["status"] if probe else "roudi_missing"})
                continue
            if mode == "on" and probe["proof_class"] != "mapped_shm_observed":
                exclusions.append({"stack": name, "reason": "ON_not_verified",
                                   "details": probe["proof_class"]})
                # Keep it in measurements as an ON-config attempt, but never
                # present it as genuinely proven SHM.
            usable.append((name, rmw, mode))
        (bench.OUT / "exclusions.json").write_text(json.dumps(exclusions, indent=2))
        print("PREFLIGHT modes="+str([x[0] for x in usable]),flush=True)
        print("PREFLIGHT exclusions="+json.dumps(exclusions),flush=True)
        if PHASE == "smoke":
            return 0 if any(r["status"] == "ok" for r in smoke) else 1
        if not usable:
            return 2
        # Re-check transport mappings at 16-node fan-out under a low rate,
        # without contaminating the timed high-rate workload with /proc reads.
        endpoint_probe = []
        for name, rmw, mode in usable:
            idx += 1
            verification = run_one(
                idx, 0, name, rmw, mode, 16, 16384, 300, "16node_path_probe")
            endpoint_probe.append(verification)
            log_row(verification)
        persist(endpoint_probe, "endpoint_probe")
        mapped_stacks = {
            p["stack"] for p in endpoint_probe
            if p["status"] == "ok" and p["proof_class"] == "mapped_shm_observed"
        }
        # Remove intrusive /proc memory inspection during rate/latency trials.
        os.environ["BENCH_PROBE_SHM"] = "0"
        # All modes use identical C++ source / QoS, same achieved offered-rate
        # scenarios, and randomized/rotated profile order per repetition.
        conditions = [
            ("fixed", 2, 16384, 1500),
            ("fixed", 8, 16384, 1500),
            ("fixed", 16, 16384, 1500),
            ("stress", 2, 16384, 4000),
            ("stress", 16, 16384, 4000),
            ("large", 2, 65536, 500),
            ("large", 16, 65536, 500),
            ("jumbo", 2, 1048576, 50),
            ("small", 16, 1024, 4000)
        ]
        for trial in range(1, REPEATS + 1):
            for ci, (profile, nodes, nbytes, hz) in enumerate(conditions):
                rotated = usable[(trial + ci) % len(usable):] + usable[:(trial + ci) % len(usable)]
                for stack, rmw, mode in rotated:
                    idx += 1
                    r = run_one(idx, trial, stack, rmw, mode, nodes, nbytes, hz, profile)
                    # The timed case is not independently traced; SHM proof
                    # comes from the separate 16-node same-config validation.
                    if mode == "on":
                        r["proof_class"] = (
                            "16node_transport_mappings_confirmed" if stack in mapped_stacks
                            else "SHM_on_but_16node_unverified")
                        r["shm_claim"] = (
                            "separate_preflight_mappings_only" if stack in mapped_stacks
                            else "NOT_PROVEN")
                    else:
                        r["proof_class"] = "network_selected"
                        r["shm_claim"] = "NOT_APPLICABLE"
                    rows.append(r)
                    failures += (r["status"] != "ok")
                    persist(rows, "results")
                    log_row(r)
    finally:
        persist(smoke, "smoke")
        persist(rows, "results")
        finish_roudi()
    print(f"FINISHED measured={len(rows)} failures={failures} excluded_modes={len(exclusions)}",flush=True)
    # Missing or unsupported SHM is a capability finding, not a fraudulent
    # success case, but unexpected worker failures make the workflow fail.
    return 0 if failures == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
