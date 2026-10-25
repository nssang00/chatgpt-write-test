# Large payload SHM ON/OFF benchmark: 64KiB and 1MiB

- **48/48 cases successful**: https://github.com/nssang00/chatgpt-write-test/actions/runs/40201988836
- Raw CSV/JSON and per-case process/router/RouDi logs: https://github.com/nssang00/chatgpt-write-test/actions/runs/40201988836/artifacts/12602241908
- One host, Ubuntu 24.04, ROS 2 Jazzy, identical C++ rclcpp `std_msgs/msg/UInt8MultiArray` message, RELIABLE/KEEP_LAST(10)/VOLATILE; 1 publisher + N-1 subscribers (N=2 or 16). 64KiB offered at 500msg/s; 1MiB offered at 50msg/s; 2 repeats per mode.
- FastDDS UDPv4-only vs SHM-only, CycloneDDS default vs iceoryx SHM + RouDi, Zenoh default SHM-off vs SHM-enabled with 4MiB/session pool and router. 2GiB Docker /dev/shm. All 48 conditions exchanged data without detected Zenoh SHM allocation failures.
- **P99 in microseconds, median across 2 trial-level P99 results.** Low sample count (1MiB at 50msg/s for 2.5s ~126 samples per receiver) makes P99 noisy; results are indicative, not definitive.

## 16-node P99 latency

| Payload | CycloneDDS default | CycloneDDS SHM | FastDDS UDP | FastDDS SHM | Zenoh OFF | Zenoh SHM configured |
|---|---:|---:|---:|---:|---:|---:|
| 64KiB / 500Hz | 1068us | **565us** | 1096us | 734us | 798us | 767us |
| 1MiB / 50Hz | 13446us | 6436us | 10127us | 24830us | 7868us | **2091us** |

## 2-node P99 latency

| Payload | CycloneDDS default | CycloneDDS SHM | FastDDS UDP | FastDDS SHM | Zenoh OFF | Zenoh SHM configured |
|---|---:|---:|---:|---:|---:|---:|
| 64KiB / 500Hz | 153us | **125us** | 178us | 149us | 198us | 174us |
| 1MiB / 50Hz | 1916us | 1207us | 1003us | 5742us | 1909us | **528us** |

All six modes reached the offered rates and had 100% delivery at both payload sizes and both node counts in this run. Thus this is **latency at controlled rates**, not maximum transport throughput. At 1MiB, Zenoh SHM had the lowest observed P99, while FastDDS SHM had unusually high P99. The root cause of FastDDS SHM large-payload tail latency is **not established**; possible queue/history management, allocation, fragmentation or runner scheduling effects require instrumentation. Avoid asserting a universal ranking from two repeats.

## Context

The separate 16KiB 4kHz high-load stress (3 repeats) showed CycloneDDS SHM fastest P99: `RMW_SHM_ONOFF_RESULTS.md`. The 2/4/8/16-node 1/16KiB matrix (96/96 successful) is documented in `RMW_SHM_SCALING_RESULTS.md`. The Zenoh SHM config was previously corrected after POSIX SHM allocation failures, and final cases have no such logged errors. **Actual per-message Zenoh SHM path was not independently traced.** No loaned-message zero-copy is claimed, and no CPU/RSS or inter-machine networking was measured.
