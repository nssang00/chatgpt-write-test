#!/usr/bin/env python3
"""Transport ablation: identical rclcpp 16KiB fan-out, FastDDS transport selection."""
import csv
import json
import os
from pathlib import Path
import sys
import run_suite as bench

bench.OUT = Path("ablation-results")
bench.OUT.mkdir(exist_ok=True)
bench.SECONDS = float(os.environ.get("BENCH_SECONDS", "2.5"))
TRIALS = int(os.environ.get("ABLATION_REPEATS", "5"))
PROFILES = [
    ("FastDDS-DEFAULT", "rmw_fastrtps_cpp", "DEFAULT"),
    ("FastDDS-SHM", "rmw_fastrtps_cpp", "SHM"),
    ("FastDDS-UDPv4", "rmw_fastrtps_cpp", "UDPv4"),
    ("CycloneDDS", "rmw_cyclonedds_cpp", None),
]
FIELDS = bench.FIELDS + ["transport_setting"]

def main():
    rows = []
    count = 0
    failures = 0
    print("trial,stack,transport,send_hz,mean_mib_s,delivery_pct,median_p50_us,median_p99_us,graph_ms,status", flush=True)
    try:
        for trial in range(1, TRIALS + 1):
            rotated = PROFILES[(trial - 1) % len(PROFILES):] + PROFILES[:(trial - 1) % len(PROFILES)]
            for name, rmw, transport in rotated:
                count += 1
                if transport:
                    os.environ["FASTDDS_BUILTIN_TRANSPORTS"] = transport
                else:
                    os.environ.pop("FASTDDS_BUILTIN_TRANSPORTS", None)
                # The 4k/s of 16KiB to 15 receivers is the original anomalous case.
                result = bench.run_case(
                    trial, count, "16KiB-16nodes-4000Hz",
                    name, rmw, 16, 16384, 4000
                )
                result["transport_setting"] = transport or "n/a"
                rows.append(result)
                failures += result["status"] != "ok"
                print(",".join(map(str, [
                    trial, name, transport, result["achieved_pub_hz"],
                    result["mean_goodput_mib_s"], result["delivery_percent"],
                    result["median_p50_us"], result["median_p99_us"],
                    result["graph_discovery_ms"], result["status"]
                ])), flush=True)
                with (bench.OUT / "results.csv").open("w", newline="") as f:
                    writer = csv.DictWriter(f, fieldnames=FIELDS)
                    writer.writeheader()
                    writer.writerows(rows)
    finally:
        (bench.OUT / "results.json").write_text(json.dumps(rows, indent=2))
    print(f"FINISHED cases={len(rows)} failed={failures}", flush=True)
    return 0 if failures == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
