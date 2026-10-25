#!/usr/bin/env python3
"""RMW SHM ablation with explicit status and per-case raw logs."""
import csv, json, os, pathlib, subprocess, time, statistics, sys
import run_suite as bench

OUT = pathlib.Path("shm-results")
OUT.mkdir(exist_ok=True)
bench.OUT = OUT
bench.SECONDS = float(os.getenv("BENCH_SECONDS", "2.5"))
REPEATS = int(os.getenv("SHM_REPEATS", "3"))
NODES = [2, 16]
PAYLOADS = [1024, 16384]
# Cyclone SHM is NOT labeled as active until its build supports iceoryx and
# its RouDi daemon can be started. Unsupported is a result, not a silent fallback.
MODES = [
    ("FastDDS-UDP", "rmw_fastrtps_cpp", "off"),
    ("FastDDS-SHM", "rmw_fastrtps_cpp", "on"),
    ("Zenoh-OFF", "rmw_zenoh_cpp", "off"),
    ("Zenoh-ON", "rmw_zenoh_cpp", "on"),
    ("CycloneDDS-OFF", "rmw_cyclonedds_cpp", "off"),
]
FIELDS = bench.FIELDS + ["shm_setting", "shm_verified", "transport_evidence"]

def mode_env(name, state):
    for k in ("FASTDDS_BUILTIN_TRANSPORTS", "ZENOH_CONFIG_OVERRIDE", "CYCLONEDDS_URI"):
        os.environ.pop(k, None)
    if name.startswith("FastDDS"):
        os.environ["FASTDDS_BUILTIN_TRANSPORTS"] = "SHM" if state == "on" else "UDPv4"
    if name.startswith("Zenoh") and state == "on":
        os.environ["ZENOH_CONFIG_OVERRIDE"] = "transport/shared_memory/enabled=true"
    # Zenoh OFF uses the ROS package default config; FastDDS UDPv4 is forced.
    # Cyclone OFF uses its default transport configuration.

def main():
    rows = []
    count = 0
    bad = 0
    print("trial,stack,nodes,payload,send_hz,goodput_mib_s,delivery,p50_us,p99_us,graph_ms,status",flush=True)
    try:
        for trial in range(1,REPEATS+1):
            rotated = MODES[(trial-1)%len(MODES):] + MODES[:(trial-1)%len(MODES)]
            for nodes in NODES:
                for payload in PAYLOADS:
                    for name, rmw, state in rotated:
                        count+=1
                        mode_env(name,state)
                        rate = 2000 if payload == 16384 else 4000
                        result=bench.run_case(trial,count,"shm_onoff",name,rmw,nodes,payload,rate)
                        result["shm_setting"]=state
                        # Config acceptance is NOT equivalent to proving SHM was used.
                        result["shm_verified"]="not_verified" if state=="on" else "not_applicable"
                        result["transport_evidence"]="config_only" if state=="on" else "default_or_forced"
                        rows.append(result)
                        bad += result["status"]!="ok"
                        print(",".join(map(str,[trial,name,nodes,payload,result["achieved_pub_hz"],
                          result["mean_goodput_mib_s"],result["delivery_percent"],
                          result["median_p50_us"],result["median_p99_us"],
                          result["graph_discovery_ms"],result["status"]])),flush=True)
                        with (OUT/"results.csv").open("w",newline="") as f:
                            w=csv.DictWriter(f,fieldnames=FIELDS);w.writeheader();w.writerows(rows)
    finally:
        (OUT/"results.json").write_text(json.dumps(rows,indent=2))
    print(f"FINISHED cases={len(rows)} failed={bad}",flush=True)
    return 0 if not bad else 1

if __name__=="__main__":
    sys.exit(main())
