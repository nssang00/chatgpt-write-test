# RMW SHM ON/OFF node-scaling experiment

- Successful workflow **96/96 cases**: https://github.com/nssang00/chatgpt-write-test/actions/runs/40201325936
- Full raw artifact CSV, JSON, per-case logs: https://github.com/nssang00/chatgpt-write-test/actions/runs/40201325936/artifacts/12602445820
- Same ROS 2 Jazzy C++ rclcpp binary, QoS RELIABLE/KEEP_LAST(10)/VOLATILE, 1 publisher + N-1 independent subscribers, N = 2/4/8/16, 1KiB at 4,000msg/s and 16KiB at 2,000msg/s, 2 trials per condition. FastDDS UDPv4 vs SHM, Zenoh SHM disabled vs enabled with 4MiB/session pools, CycloneDDS default vs iceoryx SHM with RouDi. Zenoh router is a separate process. Docker `/dev/shm` is 2GiB.
- **P99 values below are microseconds, lower is better**. They are medians of 2 runs; they are *not* confidence intervals. Values may vary substantially with CPU contention and 2 repetitions are insufficient to guarantee a ranking.

## 16KiB P99 latency (us) by node count

| Mode | 2 nodes | 4 nodes | 8 nodes | 16 nodes |
|---|---:|---:|---:|---:|
| CycloneDDS default | 181.0 | 222.1 | 151.9 | 439.4 |
| **CycloneDDS SHM** | **49.9** | **69.9** | **129.2** | **250.9** |
| FastDDS UDPv4 | 128.4 | 70.5 | 269.8 | 354.0 |
| FastDDS SHM | 65.2 | 206.9 | 215.4 | 291.5 |
| Zenoh SHM off | 266.5 | 118.9 | 368.5 | 364.1 |
| Zenoh SHM configured | 97.2 | 228.2 | 180.7 | 388.9 |

## 1KiB P99 latency (us) by node count

| Mode | 2 nodes | 4 nodes | 8 nodes | 16 nodes |
|---|---:|---:|---:|---:|
| CycloneDDS default | 131.2 | 126.8 | 73.9 | 189.8 |
| CycloneDDS SHM | 38.2 | 39.4 | 151.2 | 227.7 |
| FastDDS UDPv4 | 117.8 | 165.4 | 137.4 | 464.3 |
| FastDDS SHM | 102.3 | 59.1 | 154.1 | 271.5 |
| Zenoh SHM off | 69.9 | 225.5 | 216.9 | 691.1 |
| Zenoh SHM configured | 78.2 | 222.4 | 173.4 | 624.0 |

## Startup-to-graph-ready scaling for 16KiB (ms)

| Mode | 2 nodes | 4 nodes | 8 nodes | 16 nodes |
|---|---:|---:|---:|---:|
| CycloneDDS default | 4.7 | 15.2 | 18.9 | 23.6 |
| CycloneDDS SHM | 8.4 | 16.0 | 17.3 | 23.5 |
| FastDDS UDPv4 | 117.3 | 116.7 | 182.9 | 259.7 |
| FastDDS SHM | 118.3 | 119.7 | 120.6 | 128.9 |
| Zenoh SHM off | 8.0 | 8.2 | 9.9 | 18.6 |
| Zenoh SHM configured | 7.4 | 9.9 | 12.1 | 20.1 |

The graph-ready metric includes publisher initialization, node creation and ROS graph visibility; it **does not include subscriber startup or Zenoh router/RouDi startup** and is not pure DDS discovery. At 16 nodes, FastDDS SHM graph-ready time was substantially shorter than FastDDS UDPv4 in this run.

## Interpretation and limitations

All **96/96 cases completed successfully** with the required nodes and no SHM provider allocation error. The offered rates were mostly met; delivery was generally near 100%, but Zenoh SHM 16-node cases had slightly lower delivery (~99.7–99.8%). For 16KiB at 16 nodes, CycloneDDS SHM P99 was 251us vs FastDDS SHM 292us. At 1KiB and 16 nodes, CycloneDDS **default** had lower P99 than CycloneDDS SHM, demonstrating that SHM is not always beneficial for small messages.

All experiments are **same-host only**. SHM ON means transport configured and runtime started successfully; Zenoh SHM has not been independently traced per-message. The ROS application is not zero-copy; it publishes a dynamically sized `UInt8MultiArray` via ordinary `publish()`. No CPU/RSS profiling or cross-host wireless results. The independent high-load 16KiB 4kHz experiment has 3 repeats: see `RMW_SHM_ONOFF_RESULTS.md`.
