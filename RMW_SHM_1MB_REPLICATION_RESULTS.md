# Reproducibility validation: 1MiB 16-node SHM transport

- **60/60 cases successful** (10 repeats per each of 6 modes): https://github.com/nssang00/chatgpt-write-test/actions/runs/40202387155
- Full raw CSV/JSON and per-process logs: https://github.com/nssang00/chatgpt-write-test/actions/runs/40202387155/artifacts/12602477631
- Same Ubuntu 24.04 runner per test, ROS 2 Jazzy, same compiled C++ rclcpp `UInt8MultiArray` binary, 1 publisher and 15 subscriber processes, payload 1,048,576 bytes, offered 50msg/s for 4s per trial, QoS RELIABLE KEEP_LAST(10) VOLATILE, rotated order. Zenoh SHM configured with 4MiB/session pool, CycloneDDS iceoryx RouDi running, FastDDS SHM-only or UDPv4-only. All 60 modes sent at ~50.2 msg/s and achieved **100% application delivery**.

## Repeated 1MiB P99 results

| Mode | Valid trials | P50 median us | P99 median us | Trial-level P99 range us | Delivery median |
|---|---:|---:|---:|---|---:|
| **Zenoh SHM configured** | 10 | **780** | **1,339** | 993–3,360 | 100% |
| CycloneDDS SHM | 10 | 2,617 | 5,281 | 4,979–5,522 | 100% |
| Zenoh SHM OFF | 10 | 4,487 | 5,922 | 5,632–6,942 | 100% |
| FastDDS UDPv4 | 10 | 5,255 | 6,156 | 5,733–9,447 | 100% |
| CycloneDDS default | 10 | 7,848 | 10,211 | 9,654–12,906 | 100% |
| FastDDS SHM-only | 10 | 12,113 | 22,666 | 21,962–26,141 | 100% |

This **reproduces the earlier surprising 1MiB behavior**: Zenoh configured for SHM is much faster on P99 than FastDDS SHM-only, while FastDDS SHM has an unusually long P99 despite 100% delivery. This is a **specific same-host, 16-node, 1MiB/50Hz workload**. It does not prove the cause of FastDDS SHM's 1MiB latency. At 16KiB/4kHz, FastDDS SHM was faster than Zenoh SHM, and CycloneDDS SHM had the lowest P99; therefore **performance rank reverses with payload size and offered load**.

Each trial's P99 is the median of the 15 subscriber-specific P99s. Approximately 200 messages are published per trial; sample-based P99 at this rate remains sensitive to isolated scheduler events, even with 10 repeats. The experiment does not measure CPU/RSS, physical NIC throughput, or per-message SHM segment tracing. No true zero-copy is claimed because the message is dynamically sized and the ordinary publish API is used.
