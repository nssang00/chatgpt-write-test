#!/usr/bin/env python3
"""RMW SHM ablation with explicit status and per-case raw logs."""
import csv, json, os, pathlib, subprocess, time, statistics, sys, shutil
import run_suite as bench

OUT = pathlib.Path("shm-results")
OUT.mkdir(exist_ok=True)
bench.OUT = OUT
bench.SECONDS = float(os.getenv("BENCH_SECONDS", "2.5"))
REPEATS = int(os.getenv("SHM_REPEATS", "3"))
NODES = [int(v) for v in os.getenv("SHM_NODES", "2,16").split(",")]
PAYLOADS = [int(v) for v in os.getenv("SHM_PAYLOADS", "1024,16384").split(",")]
# Cyclone SHM is NOT labeled as active until its build supports iceoryx and
# its RouDi daemon can be started. Unsupported is a result, not a silent fallback.
MODES = [
    ("FastDDS-UDP", "rmw_fastrtps_cpp", "off"),
    ("FastDDS-SHM", "rmw_fastrtps_cpp", "on"),
    ("Zenoh-OFF", "rmw_zenoh_cpp", "off"),
    ("Zenoh-ON", "rmw_zenoh_cpp", "on"),
    ("CycloneDDS-OFF", "rmw_cyclonedds_cpp", "off"),
    ("CycloneDDS-ON", "rmw_cyclonedds_cpp", "on"),
]
FIELDS = bench.FIELDS + ["shm_setting", "shm_verified", "transport_evidence"]

def mode_env(name, state):
    for k in ("FASTDDS_BUILTIN_TRANSPORTS", "ZENOH_CONFIG_OVERRIDE", "ZENOH_SHM_ALLOC_SIZE", "CYCLONEDDS_URI"):
        os.environ.pop(k, None)
    if name.startswith("FastDDS"):
        os.environ["FASTDDS_BUILTIN_TRANSPORTS"] = "SHM" if state == "on" else "UDPv4"
    if name.startswith("Zenoh") and state == "on":
        os.environ["ZENOH_CONFIG_OVERRIDE"] = "transport/shared_memory/enabled=true;transport/shared_memory/transport_optimization/pool_size=4194304"
        os.environ["ZENOH_SHM_ALLOC_SIZE"] = "4194304"
    # Zenoh OFF uses the ROS package default config; FastDDS UDPv4 is forced.
    # Cyclone OFF uses its default transport configuration.

def cyclone_shm_capable():
    libs = list(pathlib.Path("/opt/ros/jazzy").rglob("librmw_cyclonedds_cpp.so"))
    if not libs or not shutil.which("iox-roudi"):
        return False
    p = subprocess.run(["ldd", str(libs[0])], capture_output=True, text=True)
    return "iceoryx" in p.stdout.lower() or "iox_" in p.stdout.lower()

def main():
    rows = []
    count = 0
    bad = 0
    cyclone_capable = cyclone_shm_capable()
    print(f"CYCLONE_ICEORYX_READY={cyclone_capable}",flush=True)
    chosen = set(os.getenv("SHM_MODES", "").split(",")) if os.getenv("SHM_MODES") else None
    print("trial,stack,nodes,payload,send_hz,goodput_mib_s,delivery,p50_us,p99_us,graph_ms,status",flush=True)
    try:
        for trial in range(1,REPEATS+1):
            rotated = MODES[(trial-1)%len(MODES):] + MODES[:(trial-1)%len(MODES)]
            if chosen:
                rotated = [m for m in rotated if m[0] in chosen]
            for nodes in NODES:
                for payload in PAYLOADS:
                    for name, rmw, state in rotated:
                        count+=1
                        mode_env(name,state)
                        if name == "CycloneDDS-ON" and not cyclone_capable:
                            # No fallback result masquerading as a successful SHM run.
                            result = dict.fromkeys(bench.FIELDS)
                            result.update(trial=trial,profile="shm_onoff",stack=name,rmw=rmw,nodes=nodes,
                                          subscribers=nodes-1,payload_bytes=payload,status="unsupported_iceoryx_build_or_roudi",
                                          shm_setting=state,shm_verified="no",transport_evidence="iceoryx_or_roudi_missing")
                            rows.append(result)
                            with (OUT/"results.csv").open("w",newline="") as f:
                                w=csv.DictWriter(f,fieldnames=FIELDS);w.writeheader();w.writerows(rows)
                            print(f"{trial},{name},{nodes},{payload},UNSUPPORTED",flush=True)
                            continue
                        rates = {1024:int(os.getenv("SHM_RATE_1KB","4000")),
                                 16384:int(os.getenv("SHM_RATE_16KB","2000")),
                                 65536:int(os.getenv("SHM_RATE_64KB","500")),
                                 1048576:int(os.getenv("SHM_RATE_1MB","50"))}
                        rate = rates[payload]
                        if name == "CycloneDDS-ON":
                            # Cyclone config must only be used with an actual iceoryx-capable build.
                            cfg=OUT/"cyclone-shm.xml"
                            cfg.write_text('<CycloneDDS xmlns="https://cdds.io/config"><Domain id="any"><SharedMemory><Enable>true</Enable></SharedMemory></Domain></CycloneDDS>')
                            os.environ["CYCLONEDDS_URI"]="file://"+str(cfg.resolve())
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
