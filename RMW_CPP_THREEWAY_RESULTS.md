# CycloneDDS vs FastDDS vs Zenoh — controlled ROS 2 C++ benchmark

Measured 2026-10-25 on a GitHub Actions Ubuntu 24.04 runner.

## Auditable evidence

- **Final successful run: 72 / 72 cases**: https://github.com/nssang00/chatgpt-write-test/actions/runs/40187842041
- **Full result artifact ZIP (CSV, JSON, logs)**: https://github.com/nssang00/chatgpt-write-test/actions/runs/40187842041/artifacts/12597366567
- Benchmark code: bench/rmw_cpp/node.cpp, bench/rmw_cpp/run_suite.py.
- Workflow: .github/workflows/rmw-threeway-cpp.yml.
- An earlier high-load run failed 1/72 cases due to a Zenoh subscriber-creation stall (interest DeclareFinal timeout): https://github.com/nssang00/chatgpt-write-test/actions/runs/40187286124. The final run creates a **fresh router per Zenoh case** and staggers node launches equally for all three RMWs. The anomaly is retained as evidence; do not claim there were never Zenoh initialization problems.
- The earliest C++ implementation accidentally inserted 1 ms sleep after each receive callback and artificially limited subscribers to ~1k msg/s. Its results are **invalid for comparisons** (run 40186509358). The fixed implementation uses blocking-when-idle spin_once, with no per-message sleep.

## Common workload and environment

- **Identical application binary:** C++17 -O3 ROS 2 Jazzy rclcpp; only RMW_IMPLEMENTATION changes to rmw_cyclonedds_cpp, rmw_fastrtps_cpp, or rmw_zenoh_cpp.
- RMW packages: ros-jazzy-rmw-cyclonedds-cpp 2.2.4; ros-jazzy-rmw-fastrtps-cpp 8.4.4; ros-jazzy-rmw-zenoh-cpp 0.2.11.
- Host: AMD EPYC 7763, Ubuntu 24.04, four available vCPUs, Docker ROS Jazzy container.
- Separate processes: one publisher and N-1 subscribers, where N = 2, 4, 8, or 16.
- Message: std_msgs/msg/UInt8MultiArray with exact byte lengths (1,024 or 16,384 bytes), same sequence/timestamp/filler contents for every implementation.
- Same QoS for each: RELIABLE, KEEP_LAST(128), VOLATILE.
- Baseline: 4,000 msg/s for 1 KiB, 1,500 msg/s for 16 KiB at all four node counts.
- Stress: 16,000 msg/s for 1 KiB and 4,000 msg/s for 16 KiB at 2 and 16 nodes.
- 2.5 seconds per run; two repeats per condition with rotated backend order. All 72 case statuses are ok in the final run.
- Zenoh's router is running before any subscriber is created, and router startup is excluded from publisher timing. The router is an additional process not required by the DDS implementations.

## Definitions

- **Graph-ready time**: elapsed from starting publisher-process rclcpp initialization until the publisher observes all N-1 subscriptions through count_subscribers(topic). Includes node/publisher creation and RMW graph propagation; **NOT pure DDS SPDP/SEDP discovery time**. Startup of already prepared subscriber processes, and Zenoh router startup, are excluded. The CSV also has a separate ready_to_graph_ms field.
- **Actual publisher msg/s**: sent messages / publish loop duration. Sending is rate limited to offered_hz and may be throttled by middleware/backpressure under overload.
- **Mean receiver goodput**: mean receiver count * application payload size / publisher duration in MiB/s. **Not NIC throughput**, and not the aggregate bandwidth across all receivers.
- **Delivery %**: mean received messages divided by actual messages published; 100% is insufficient evidence of meeting the offered rate when sender was throttled.
- **P99 latency**: computed individually in each subscriber from publisher monotonic timestamp to subscriber callback; median of subscribers' P99 per trial, then median of the two trials. Same-host monotonic clock only; no network clock-synchronization errors.
- All tabulated values below are medians of two trial-level results (NOT a statistical confidence interval).

## Baseline: 16-node results (one publisher, 15 receivers)

| Payload | RMW | Graph ready ms | Achieved publisher msg/s | Mean receiver MiB/s | Delivery | Median subscriber P99 us |
|---|---|---:|---:|---:|---:|---:|
| 1 KiB | CycloneDDS | 28.16 | 4000.1 | 3.906 | 100% | 367 |
| 1 KiB | FastDDS | 287.35 | 3999.7 | 3.906 | 100% | 583 |
| 1 KiB | Zenoh | 32.31 | 4000.1 | 3.906 | 100% | 1276 |
| 16 KiB | CycloneDDS | 28.58 | 1500.2 | 23.441 | 100% | 467 |
| 16 KiB | FastDDS | 212.45 | 1500.3 | 23.442 | 100% | 435 |
| 16 KiB | Zenoh | 25.16 | 1500.3 | 23.443 | 100% | 573 |

In the baseline, all three meet the sender target with 100% delivery. Throughput is capped by the benchmark offered rate, so these numbers **do not rank maximum transport capacity**.

## Stress: 16-node results (one publisher, 15 receivers)

| Payload / offered rate | RMW | Achieved publisher msg/s | Mean receiver MiB/s | Delivery | Median subscriber P99 us |
|---|---|---:|---:|---:|---:|
| 1 KiB / 16,000 msg/s | CycloneDDS | 11,457 | 11.143 | 99.60% | 6,395 |
| 1 KiB / 16,000 msg/s | FastDDS | 12,409 | 11.913 | 98.32% | 7,404 |
| 1 KiB / 16,000 msg/s | Zenoh | 15,999 | 15.616 | 99.95% | 4,219 |
| 16 KiB / 4,000 msg/s | CycloneDDS | 3,998 | 62.380 | 99.86% | 7,159 |
| 16 KiB / 4,000 msg/s | FastDDS | 4,000 | 62.495 | 100% | 778 |
| 16 KiB / 4,000 msg/s | Zenoh | 3,999 | 62.465 | 99.97% | 2,003 |

**Observed:** Under high fan-out of small 1 KiB messages, Zenoh sustained the highest receiver goodput. For high fan-out 16 KiB messages, all three reached about 62.4 MiB/s/receiver, while FastDDS had the lowest observed P99 latency. CycloneDDS 16 KiB stress P99 varied substantially across repetitions (2,873 and 11,445 us), so its two-run median should not be viewed as a stable tail-latency estimate.

## Graph-ready scaling at 1 KiB baseline (ms, two-trial median)

| RMW | 2 nodes | 4 nodes | 8 nodes | 16 nodes |
|---|---:|---:|---:|---:|
| CycloneDDS | 7.33 | 17.12 | 17.15 | 28.16 |
| FastDDS | 117.27 | 120.20 | 257.48 | 287.35 |
| Zenoh | 9.04 | 10.83 | 18.52 | 32.31 |

CycloneDDS and Zenoh showed faster startup-to-full-graph visibility than FastDDS in these runs. This metric includes vendor-specific ROS middleware initialization and is **not** proof of a fixed ratio for raw protocol discovery.

## Boundaries on the conclusion

These comparisons are relevant to a fixed 4-vCPU, one-host, multi-process ROS 2 workload. They do not include wireless drone links, Ethernet NIC limits, loaned messages, shared-memory configuration tuning, cybersecurity, payload structures typical of sensor transforms, different DDS QoS policies, or CPU/memory profiling. Results from two repetitions are not enough for statistical guarantees or a historical regression claim. The maximum capacity of Zenoh at 1 KiB was not established because it was still meeting the offered 16,000 msg/s target.
