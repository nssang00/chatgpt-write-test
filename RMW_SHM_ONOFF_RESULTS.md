# CycloneDDS, FastDDS, Zenoh: identical C++ SHM ON/OFF experiment

Date: 2026-10-25. OS: Ubuntu 24.04 / ROS 2 Jazzy in GitHub Actions containers. Identical C++ rclcpp binary for every run, with `RMW_IMPLEMENTATION` and transport configuration switched. All processes are on one runner, with 1 publisher and 15 subscribers. `std_msgs/msg/UInt8MultiArray` with exactly 16,384 payload bytes. RELIABLE, KEEP_LAST(10), VOLATILE. Zenoh uses a separate router; CycloneDDS SHM uses a separate iceoryx RouDi process. Each router is launched before subscriber creation and not included in publisher graph-ready time.

## Verified successful evidence

- **High-load stress, 4,000 msg/s, 3 repeats x 6 configurations = 18/18 successful cases:** https://github.com/nssang00/chatgpt-write-test/actions/runs/40201095779
- High-load raw CSV, JSON, case logs and environment: https://github.com/nssang00/chatgpt-write-test/actions/runs/40201095779/artifacts/12602042713
- **Moderate load, 2,000 msg/s, 2 repeats x 6 configurations = 12/12 successful cases:** https://github.com/nssang00/chatgpt-write-test/actions/runs/40200927121
- Moderate-load raw artifact: https://github.com/nssang00/chatgpt-write-test/actions/runs/40200927121/artifacts/12601723875
- Source: `bench/rmw_cpp/node.cpp`, `bench/rmw_cpp/run_suite.py`, `bench/rmw_cpp/shm_onoff.py`; workflow `.github/workflows/rmw-shm-onoff.yml`.
- Stress runner AMD EPYC 9V45 (4 logical CPUs); moderate-load runner AMD EPYC 9V74 (4 logical CPUs). **Do not directly compare absolute values between the two runner instances.** All six modes within each run used the same machine.

## Stress result: 16 nodes, 16 KiB, offered 4,000 msg/s

Values are medians across three trial-level measurements. P99 is the median of the 15 subscribers' individual P99 values in each trial.

| Mode | P50 latency us | P99 latency us | Actual publisher msg/s | Mean receiver goodput MiB/s | Delivery % |
|---|---:|---:|---:|---:|---:|
| **CycloneDDS SHM enabled (iceoryx + RouDi)** | **102.9** | **226.2** | 4,000.2 | 62.48 | 99.96 |
| CycloneDDS default transport | 211.7 | 423.9 | 3,999.9 | 62.50 | 99.99 |
| FastDDS SHM-only | 169.4 | 314.8 | 4,000.2 | 62.50 | 100.00 |
| FastDDS UDPv4-only | 205.4 | 700.8 | 3,999.8 | 62.45 | 99.93 |
| Zenoh SHM configured (4 MiB/session pool) | 265.1 | 589.8 | 4,000.2 | 62.30 | 99.68 |
| Zenoh default SHM-off | 278.5 | 645.3 | 4,000.2 | 62.50 | 100.00 |

At this offered rate, all six modes reached the target publisher speed. Therefore the result primarily distinguishes **tail latency and delivery**, not maximum throughput.

CycloneDDS SHM was **~47% lower P99** than CycloneDDS default transport (226.2 vs 423.9 us), and **~28% lower P99** than FastDDS SHM (226.2 vs 314.8 us) in this particular run. Zenoh SHM improved P99 relative to Zenoh OFF but had a measurable **0.32% delivery deficit**. These are observations from three repetitions, not statistically guaranteed general rankings.

## Moderate load: 16 nodes, 16 KiB, offered 2,000 msg/s

| Mode | P99 latency us | Actual publisher msg/s | Delivery % |
|---|---:|---:|---:|
| CycloneDDS SHM | **266.55** | 2,000.3 | 100.00 |
| CycloneDDS default | 355.35 | 2,000.2 | 100.00 |
| FastDDS SHM | 282.65 | 2,000.3 | 100.00 |
| FastDDS UDPv4 | 364.90 | 2,000.2 | 100.00 |
| Zenoh SHM configured | 465.55 | 2,000.3 | 99.93 |
| Zenoh OFF | 415.35 | 2,000.3 | 100.00 |

The relative Zenoh SHM benefit was not stable between the two load levels. The two load levels ran on different runner CPU models.

## Why the validation steps matter

1. **QoS compatibility:** The prior C++ benchmark used KEEP_LAST(128). CycloneDDS iceoryx SHM requires depth <= 16 for its documented SHM path, so this test rebuilds the **same C++ binary** for all three RMWs with KEEP_LAST(10). The old QoS128 results must not be compared directly to the QoS10 figures.
2. **CycloneDDS RouDi:** An initial CycloneDDS-ON run without RouDi stalled. The final implementation starts `iox-roudi` for each CycloneDDS-ON case, waits for it, and captures its log. The final logs show `RouDi is ready for clients`. The publisher and 15 subscribers exchange the expected payload and all cases complete.
3. **Zenoh memory allocation:** With the default 48MiB/session Zenoh SHM pool, the benchmark emitted `Error creating lazy ShmProvider: Unable to create POSIX shm segment: OS error 12`, even after enlarging container `/dev/shm` from 64MiB to 2GiB. Those early Zenoh-ON results are **INVALID** as SHM measurements, even though application messages were delivered via fallback. The final run explicitly sets `ZENOH_CONFIG_OVERRIDE='transport/shared_memory/enabled=true;transport/shared_memory/transport_optimization/pool_size=4194304'` and `ZENOH_SHM_ALLOC_SIZE=4194304`, inherited by all nodes and the router. A benchmark case is marked failed if any log contains SHM provider allocation errors. The final two successful runs had **no such allocation errors**.
4. **Transport proof boundary:** FastDDS SHM is explicitly selected by `FASTDDS_BUILTIN_TRANSPORTS=SHM`. CycloneDDS is configured for iceoryx with a working RouDi daemon. Zenoh is configured for SHM and its runtime logs confirm SHM subsystem initialization; however, there is **no per-message independent tracing of SHM segments**, so not every Zenoh message can be proven to have traversed SHM.
5. **No zero-copy claim:** `UInt8MultiArray` is dynamically sized, and ordinary `publish()` is used; no loaned-message path or zero-copy guarantee.
6. **Limitations:** One-host loopback/SHM only, no Ethernet or wireless, no measured CPU/RSS, 3 repeats for stress, 2 for moderate, no physical network utilization, no statistics on distribution confidence. Discovery times include publisher initialization and graph visibility and are not pure RTPS protocol discovery.

## Historical interpretation

The earlier high-load result where FastDDS default P99 was much lower than CycloneDDS default was affected by a transport asymmetry: FastDDS uses SHM by default for same-host peers, whereas CycloneDDS SHM was not configured. This new test demonstrates that **CycloneDDS SHM can match or beat FastDDS SHM** in the same workload. It does not show a historical FastDDS regression or CycloneDDS version speedup.
