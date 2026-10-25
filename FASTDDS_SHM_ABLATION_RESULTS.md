# Why FastDDS had unusually low 16KiB P99 latency: transport ablation

Measured 2026-10-25, Ubuntu 24.04 GitHub Actions runner, AMD EPYC 7763 / 4 vCPUs, ROS 2 Jazzy.

## Reproducible evidence

- Run A (20 measurement cases all completed; **CI marked failure because the tee output directory was not created**): https://github.com/nssang00/chatgpt-write-test/actions/runs/40189512784
- Run A artifact: https://github.com/nssang00/chatgpt-write-test/actions/runs/40189512784/artifacts/12597453849
- Run B (**20/20 cases and full CI success**, log directory corrected): https://github.com/nssang00/chatgpt-write-test/actions/runs/40189742550
- Run B artifact: https://github.com/nssang00/chatgpt-write-test/actions/runs/40189742550/artifacts/12597795039
- Code: `bench/rmw_cpp/node.cpp`, `bench/rmw_cpp/run_suite.py`, `bench/rmw_cpp/transport_ablation.py`; workflow `.github/workflows/fastdds-shm-ablation.yml`.

Both runs used the same runner CPU model and 4 logical CPUs; they are still separate, non-identical runner instances.

## Controlled experiment

- Exactly the same C++ rclcpp binary for each case, one publisher process and 15 independent subscribers.
- Message: `std_msgs/msg/UInt8MultiArray` with 16,384-byte payload; reliable, KEEP_LAST 128, volatile QoS.
- Requested 4,000 msg/s for 2.5 seconds, 5 randomized/rotated-order repetitions per stack per run, 10 total samples for each transport selection.
- **Only for FastDDS** the environment variable `FASTDDS_BUILTIN_TRANSPORTS` is set to `DEFAULT`, `SHM` or `UDPv4` and inherited by publisher + all subscribers. `DEFAULT` initializes SHM + UDPv4 with SHM preferred for colocalized participants (documented by Fast DDS). `CycloneDDS` is a separate control; it does not use the FastDDS variable.
- The table reports *median across 10 cases*. Each case's P99 is itself the median across 15 subscribers' individual P99 latencies; reported receive rate is mean receiver goodput.

| Stack/transport | P50 us | P99 us | Actual publisher msg/s | Receiver goodput MiB/s | Delivery % |
|---|---:|---:|---:|---:|---:|
| FastDDS DEFAULT (SHM + UDP) | 331.5 | **753.5** | 3,999.4 | 62.492 | 100.00 |
| FastDDS SHM only | 318.7 | **759.2** | 3,999.6 | 62.495 | 100.00 |
| FastDDS UDPv4 only | 431.5 | **2,241.6** | 2,730.8 | 42.668 | 100.00 |
| CycloneDDS default | 582.6 | 4,159.9 | 3,968.8 | 61.775 | 99.81 |

P99 median measured *separately* in the two runs:
- FastDDS DEFAULT: 776.1 / 733.0 us
- FastDDS SHM: 753.4 / 765.0 us
- FastDDS UDPv4: 2,277.2 / 2,199.5 us
- CycloneDDS: 9,036.1 / 3,627.1 us; very unstable tail (individual cases up to 28,094 us)

## What the results support

1. The SHM-enabled FastDDS paths maintained 4,000 msg/s and ~62.5 MiB/s per subscriber with P99 ~0.75ms.
2. Forcing UDPv4 reduced achievable publisher speed to ~2,731 msg/s and increased P99 to ~2.24ms. Both are consistent with additional kernel/network transport, packet segmentation, fragmentation/reassembly, queue pressure and copy costs in a 16KiB 15-receiver fan-out workload.
3. FastDDS DEFAULT and SHM-only were essentially equal in this workload. This is experimental support for the FastDDS same-host SHM transport path being an important factor.
4. It **does not prove** that the shared-memory transport alone explains all differences versus CycloneDDS or Zenoh: different middleware algorithms, transport/fragmentation, reader history behavior, and CPU scheduling still differ.
5. The fast FastDDS result **is not zero-copy proof**. `UInt8MultiArray` is variable-length and the regular `publish()` API was used; no loaned-message and Data-Sharing pipeline was configured.
6. Even the 2.24ms UDP P99 is measured at lower achieved msg/s than the ~0.75ms SHM P99. To isolate the intrinsic latency at **the same achieved send rate**, repeat at lower fixed rates where UDP can sustain the target.
7. All workloads use a single machine, not drone radio, cross-host Ethernet or packet loss injection. No transport packet capture or perf CPU profiling was taken.

## Authoritative FastDDS transport documentation

- eProsima's official environment variable reference: https://fast-dds.docs.eprosima.com/en/stable/fastdds/env_vars/env_vars.html
- ROS rmw_fastrtps official shared memory defaults and Data-Sharing restrictions: https://github.com/ros2/rmw_fastrtps/blob/rolling/README.md
- Cyclone DDS shared memory documentation (disabled by default in documented builds): https://github.com/ros2/rmw_cyclonedds/blob/rolling/shared_memory_support.md
