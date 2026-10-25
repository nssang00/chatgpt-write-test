#!/usr/bin/env python3
"""SHM ON/OFF benchmark with capability probes and no misleading SHM claims.

Uses the exact same rclcpp C++ executable and ROS QoS for all variants.
A failed Cyclone DDS SHM probe is recorded as UNSUPPORTED, not as a slow score.
"""
import csv
import json
import os
from pathlib import Path
import resource
import statistics
import sys
import threading
import time

import run_suite as previous

HERE = Path(__file__).resolve().parent
SIZE = int(os.environ.get("MATRIX_SIZE", "16384"))
REPS = int(os.environ.get("MATRIX_REPEATS", "10"))
SECONDS = float(os.environ.get("MATRIX_SECONDS", "2.0"))
NODES = tuple(int(v) for v in os.environ.get("MATRIX_NODES", "2,4,8,16").split(","))
RATE = {1024: 8000, 16384: 2500, 65536: 400, 1048576: 25}[SIZE]
BASE = Path(os.environ.get("MATRIX_ROOT", "shm-onoff-results"))
OUT = BASE / f"payload_{SIZE}"
OUT.mkdir(parents=True, exist_ok=True)
previous.OUT = OUT
previous.SECONDS = SECONDS
os.environ["BENCH_QOS_DEPTH"] = "8"
os.environ["RCUTILS_LOGGING_SEVERITY_THRESHOLD"] = "WARN"
CYCLONE_CONFIG = HERE / "cyclonedds-shm.xml"

VARIANTS = [
    ("CycloneDDS-OFF", "rmw_cyclonedds_cpp", "off"),
    ("CycloneDDS-ON", "rmw_cyclonedds_cpp", "on"),
    ("FastDDS-OFF", "rmw_fastrtps_cpp", "off"),
    ("FastDDS-ON", "rmw_fastrtps_cpp", "on"),
    ("Zenoh-OFF", "rmw_zenoh_cpp", "off"),
    ("Zenoh-ON", "rmw_zenoh_cpp", "on"),
]
EXTRA_FIELDS = ["transport", "capability", "cpu_seconds_children",
                "peak_children_rss_mib", "shm_mapping_evidence", "note"]
HEADERS = previous.FIELDS + EXTRA_FIELDS


def set_variant(name, rmw, onoff):
    for k in ("FASTDDS_BUILTIN_TRANSPORTS", "CYCLONEDDS_URI",
              "ZENOH_CONFIG_OVERRIDE", "ZENOH_SHM_ALLOC_SIZE"):
        os.environ.pop(k, None)
    if rmw == "rmw_fastrtps_cpp":
        os.environ["FASTDDS_BUILTIN_TRANSPORTS"] = "SHM" if onoff == "on" else "UDPv4"
    elif rmw == "rmw_zenoh_cpp" and onoff == "on":
        os.environ["ZENOH_CONFIG_OVERRIDE"] = "transport/shared_memory/enabled=true"
    elif rmw == "rmw_cyclonedds_cpp" and onoff == "on":
        os.environ["CYCLONEDDS_URI"] = CYCLONE_CONFIG.resolve().as_uri()
    return {
        "FastDDS-ON": "FastDDS SHM-only", "FastDDS-OFF": "FastDDS UDPv4-only",
        "CycloneDDS-ON": "CycloneDDS iceoryx-enabled XML",
        "CycloneDDS-OFF": "CycloneDDS default network",
        "Zenoh-ON": "Zenoh implicit SHM enabled (node+router)",
        "Zenoh-OFF": "Zenoh default config SHM disabled",
    }[name]


def sample_children(done, snapshots):
    """Sample separate child processes; diagnostics, not a transport-packet trace."""
    while not done.is_set():
        children = []
        try:
            for ent in Path("/proc").iterdir():
                if not ent.name.isdigit():
                    continue
                try:
                    cmd = (ent / "cmdline").read_bytes().replace(b"\x00", b" ").decode(
                        "utf-8", errors="ignore")
                except (FileNotFoundError, ProcessLookupError, PermissionError):
                    continue
                if ("/tmp/rmw-bench-build/rmw_bench" in cmd or
                        "/opt/ros/jazzy/lib/rmw_zenoh_cpp/rmw_zenohd" in cmd):
                    children.append(ent)
        except OSError:
            pass
        rss = 0
        shm_evidence = set()
        for p in children:
            try:
                data = (p / "status").read_text(errors="replace")
                for line in data.splitlines():
                    if line.startswith("VmRSS:"):
                        rss += int(line.split()[1]) * 1024
                        break
                for line in (p / "maps").read_text(errors="replace").splitlines():
                    if any(token in line.lower() for token in (
                        "/dev/shm", "memfd:", "iceoryx", "/iox", "zenoh_shm"
                    )):
                        shm_evidence.add(line.rsplit(" ", 1)[-1].strip()[:120])
            except (FileNotFoundError, PermissionError, ProcessLookupError, OSError):
                pass
        snapshots["peak"] = max(snapshots.get("peak", 0), rss)
        snapshots.setdefault("evidence", set()).update(shm_evidence)
        done.wait(0.1)


def run_case(counter, rep, name, rmw, onoff, nodes, payload, rate, profile):
    transport = set_variant(name, rmw, onoff)
    start_rusage = resource.getrusage(resource.RUSAGE_CHILDREN)
    snapshots = {}
    done = threading.Event()
    sampler = threading.Thread(target=sample_children, args=(done, snapshots), daemon=True)
    sampler.start()
    try:
        row = previous.run_case(rep, counter, profile, name, rmw, nodes, payload, rate)
    finally:
        done.set()
        sampler.join(timeout=2)
    end_rusage = resource.getrusage(resource.RUSAGE_CHILDREN)
    cpu = (end_rusage.ru_utime + end_rusage.ru_stime) - (
        start_rusage.ru_utime + start_rusage.ru_stime)
    row.update(transport=transport,
               capability="SHM_requested_unverified" if onoff == "on" else "SHM_disabled_by_config",
               cpu_seconds_children=round(cpu, 3),
               peak_children_rss_mib=round(snapshots.get("peak", 0) / 1048576, 2),
               shm_mapping_evidence="; ".join(sorted(snapshots.get("evidence", set())))[:1000],
               note="")
    return row


def save(rows, capability):
    with (OUT / "results.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=HEADERS)
        writer.writeheader()
        writer.writerows(rows)
    (OUT / "results.json").write_text(json.dumps(rows, indent=2))
    (OUT / "capabilities.json").write_text(json.dumps(capability, indent=2))


def main():
    if not previous.BINARY.is_file():
        raise RuntimeError(f"Missing common C++ executable: {previous.BINARY}")
    rows, capability = [], {}
    counter = 0
    print(f"RUNNER payload={SIZE} rate={RATE} qos_depth=8 nodes={NODES} repeats={REPS}", flush=True)
    # Always probe SHM capability before labeling results.
    for name, rmw, onoff in VARIANTS:
        counter += 1
        probe = run_case(counter, 0, name, rmw, onoff, 2, 16384, 200, "probe")
        passed = probe["status"] == "ok" and probe["delivery_percent"] >= 95
        capability[name] = {
            "passed_data_exchange": passed,
            "status": probe["status"],
            "delivery_percent": probe["delivery_percent"],
            "interpretation": (
                "configuration succeeded; transport-path proof NOT available from this probe"
                if passed and onoff == "on" else
                "default/off data exchange successful" if passed else
                "SHM configuration not usable; DO NOT compare as SHM active"
            ),
        }
        probe["note"] = "capability_probe_not_a_performance_measurement"
        rows.append(probe)
        save(rows, capability)
        print("PROBE", name, probe["status"], probe["delivery_percent"], flush=True)

    valid = [v for v in VARIANTS if capability[v[0]]["passed_data_exchange"]]
    for rep in range(1, REPS + 1):
        rotated = valid[(rep - 1) % len(valid):] + valid[:(rep - 1) % len(valid)]
        for nodes in NODES:
            for name, rmw, onoff in rotated:
                counter += 1
                row = run_case(counter, rep, name, rmw, onoff, nodes, SIZE, RATE, "steady")
                rows.append(row)
                save(rows, capability)
                print(",".join(str(x) for x in (
                    rep,name,nodes,SIZE,RATE,row["achieved_pub_hz"],
                    row["mean_goodput_mib_s"], row["delivery_percent"],
                    row["median_p99_us"],row["graph_discovery_ms"],row["cpu_seconds_children"],
                    row["peak_children_rss_mib"],row["status"]
                )),flush=True)
    failures=[r for r in rows if r["profile"]=="steady" and r["status"]!="ok"]
    print("FINISHED", "size", SIZE, "probes", len(capability), "valid", len(valid),
          "steady",sum(x["profile"]=="steady" for x in rows),
          "failed",len(failures), flush=True)
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
