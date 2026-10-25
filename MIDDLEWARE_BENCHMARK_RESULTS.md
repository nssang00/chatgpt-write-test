# ROS 2 DDS / Zenoh / gRPC+Protobuf node-scaling: measured results (2026-10-25)

## Auditable GitHub Actions evidence

- **Run A — success (32/32 scenarios)**: https://github.com/nssang00/chatgpt-write-test/actions/runs/40183037117
  - 4 vCPUs, AMD EPYC 9V74, Ubuntu 24.04 / ROS 2 Jazzy Docker.
  - CSV, JSON, and all 32 per-case logs: https://github.com/nssang00/chatgpt-write-test/actions/runs/40183037117/artifacts/12594807906
- **Run B — success (32/32 scenarios)**: https://github.com/nssang00/chatgpt-write-test/actions/runs/40184132434
  - 4 vCPUs, Intel Xeon Platinum 8573C, Ubuntu 24.04 / ROS 2 Jazzy Docker.
  - CSV, JSON, and all 32 per-case logs: https://github.com/nssang00/chatgpt-write-test/actions/runs/40184132434/artifacts/12594989595
- Source: `bench/middleware/node.py`, `bench/middleware/run_suite.py`. Workflows: `.github/workflows/middleware-scaling-linux.yml` and `.github/workflows/middleware-bench-linux.yml`.
- Middleware packages: `ros-jazzy-rmw-cyclonedds-cpp 2.2.4`, `ros-jazzy-rmw-fastrtps-cpp 8.4.4`, eclipse-zenoh 1.10.1, grpcio 1.84.1. Python protobuf differed (7.36.2 versus 6.33.6), so the two runs are *cross-environment checks, not exact controlled repeats*.

## Setup and metric definitions

- **4 stacks**: CycloneDDS and FastDDS through ROS 2 Jazzy `rclpy`, Zenoh through eclipse-zenoh Python, and Python gRPC bidirectional setup/server-streaming using protobuf `BytesValue`.
- **Node counts**: 2, 4, 8, 16. Exactly 1 publisher and N−1 separate subscriber processes, same machine.
- **Payloads and fixed offered rates**: 1,024 bytes at 4,000 messages/second; 16,384 bytes at 1,500 messages/second; 2.5 seconds per scenario.
- **Discovery surrogate**: milliseconds from *publisher process launch* until the first heartbeat appears at each subscriber; table below shows median across subscribers. **This includes language/runtime startup and transport initialization**, not pure DDS Participant discovery. gRPC uses explicit server endpoint and has no DDS-style discovery.
- **Receiver goodput**: mean successfully received application-payload bytes per subscriber divided by publisher send duration, MiB/s. Source sender can throttle/backpressure; the offered rate is not necessarily achieved.
- **Delivery percentage**: mean messages received per subscriber / messages actually sent. Reporting `status=ok` means processes generated results, **not** that 100% of data was delivered.
- **Scope**: localhost and Docker networking only; no NIC, wireless link, QoS/security sweep, independent per-message latency, actual ROS 2 complex messages, CPU profiling or native C++ API measurements.

## 16-node goodput (MiB/s per receiver), Run A / Run B

| Stack | 1 KiB | 16 KiB |
|---|---:|---:|
| CycloneDDS | 1.252 / 1.124 | 11.998 / 13.351 |
| FastDDS | 1.403 / 1.172 | 19.349 / 18.835 |
| Zenoh | **3.906 / 3.907** | **23.443 / 23.443** |
| gRPC + Protobuf | 0.747 / 0.773 | 11.309 / 12.235 |

## 16-node delivery percentage, Run A / Run B

| Stack | 1 KiB | 16 KiB |
|---|---:|---:|
| CycloneDDS | 90.2% / 58.5% | 100.0% / 95.6% |
| FastDDS | 36.0% / 30.2% | 82.6% / 80.4% |
| Zenoh | **100.0% / 100.0%** | **100.0% / 100.0%** |
| gRPC + Protobuf | 19.1% / 19.8% | 48.2% / 52.2% |

### Important context for 16-node 16 KiB

- CycloneDDS sender achieved **767.9 / 893.4 messages/s** despite requested 1,500/s. A 100% delivery ratio in Run A does **not** imply that the requested send rate was sustained.
- FastDDS sender achieved **1,498.4 / 1,499.5 messages/s** but subscribers delivered only ~81%.
- Zenoh both achieved ~1,500 messages/s and 100% delivery.
- gRPC showed substantial application-server queue drops (`29,119 / 26,868` across receivers) at 16 KiB, 16 nodes. Its result is influenced by **the benchmark's bounded 128-message Python queues**, not solely gRPC transport.

## First-heartbeat median on 1 KiB, Run A / Run B (ms)

| Stack | N=2 | N=4 | N=8 | N=16 |
|---|---:|---:|---:|---:|
| CycloneDDS | 181.70 / 177.33 | 188.89 / 183.67 | 209.31 / 188.07 | 236.29 / 226.90 |
| FastDDS | 376.47 / 284.82 | 447.22 / 442.54 | 412.83 / 310.33 | 444.47 / 482.36 |
| Zenoh | 40.85 / 42.16 | 44.05 / 93.53 | 41.13 / 46.51 | 62.93 / 60.42 |
| gRPC + Protobuf | 1089.47 / 1251.84 | 917.64 / 1018.86 | 1147.35 / 1039.81 | 265.84 / 1250.67 |

Large run-to-run variation (especially gRPC at N=16 and FastDDS 16 KiB) demonstrates that cold startup measurements are noisy. Do **not** equate these first-heartbeat numbers with pure protocol discovery or use them as statistical latency guarantees.

## Grounded conclusion

Under this exact 4-vCPU, single-host, Python, fixed-offered-load fan-out workload, **Zenoh consistently met both offered rates for all node counts with 100% recorded delivery in both runs**. This does **not** establish its maximum throughput, latency, or superiority on drone radio links, real DDS QoS workloads, or different hardware. Pure middleware discovery, controlled multi-trial CPU-matched experiments, and realistic wireless networking remain unmeasured.
