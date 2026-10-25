# ROS 2 Jazzy: CycloneDDS / FastDDS / Zenoh SHM ON/OFF benchmark

**Date:** 2026-10-25. **Evidence:** real GitHub Actions Linux runs; not simulated numbers.

## Reproducible, objectively checked runs

- [Baseline, four independent payload-size jobs, all successful](https://github.com/nssang00/chatgpt-write-test/actions/runs/40191466145): 6 variants × 4 node counts × 4 payload sizes × 10 repetitions = **960 successful performance cases**. Each job also ran 6 capability probes.
- [High-load fan-out run, both jobs successful](https://github.com/nssang00/chatgpt-write-test/actions/runs/40191697257): 6 variants × 2 payload sizes × 10 repetitions at 16 nodes = **120 successful stress cases**. Both jobs also ran 6 capability probes.
- [Initial successful capability validation of all 6 modes](https://github.com/nssang00/chatgpt-write-test/actions/runs/40191300705): 16KiB, 2 nodes, successful sending/receiving and OS memory-mapping evidence.
- [Earlier failed capability probe](https://github.com/nssang00/chatgpt-write-test/actions/runs/40190905259) lacked RouDi; initial CycloneDDS ON emitted \`RouDi not found - waiting\`. An intermediate run failed because no RouDi executable was installed. Installing Ubuntu \`iceoryx\`, starting RouDi per case, allocating a 2GiB container \`/dev/shm\`, and configuring iceoryx mempools fixed these problems.
- The source is in \`bench/rmw_cpp/node.cpp\`, \`bench/rmw_cpp/shm_matrix.py\`, \`bench/rmw_cpp/roudi_mempool.toml\`, \`bench/rmw_cpp/cyclonedds-shm.xml\`; CI in \`.github/workflows/rmw-shm-onoff.yml\`.
- Independent high-load workflow and rate overrides in the companion branch \`bench/shm-stress-threeway-20261025\`.

GitHub Actions raw ZIPs:

| Payload | Downloadable evidence |
|---|---|
| Baseline 1KiB | https://github.com/nssang00/chatgpt-write-test/actions/runs/40191466145/artifacts/12598447344 |
| Baseline 16KiB | https://github.com/nssang00/chatgpt-write-test/actions/runs/40191466145/artifacts/12598402398 |
| Baseline 64KiB | https://github.com/nssang00/chatgpt-write-test/actions/runs/40191466145/artifacts/12598736831 |
| Baseline 1MiB | https://github.com/nssang00/chatgpt-write-test/actions/runs/40191466145/artifacts/12597934538 |
| Stress 1KiB | https://github.com/nssang00/chatgpt-write-test/actions/runs/40191697257/artifacts/12598416652 |
| Stress 16KiB | https://github.com/nssang00/chatgpt-write-test/actions/runs/40191697257/artifacts/12598218169 |

## Apples-to-apples application setup

- Exactly one **identical C++17/O3 ROS 2 Jazzy rclcpp** application binary used for all three RMWs.
- One publisher and N−1 independent subscriber processes, where N is 2/4/8/16. Same-host only.
- \`std_msgs/msg/UInt8MultiArray\`, 1024, 16384, 65536 or 1048576 application data bytes. Non-fixed-size type, normal \`publish()\`; no loaned message and **NO zero-copy proof**.
- QoS for every case: **RELIABLE / KEEP_LAST(8) / VOLATILE**. Depth 8 is needed to satisfy published iceoryx history restrictions (depth above 16 can trigger network fallback).
- Each case runs 2 seconds. 10 repeats per exact condition, backends rotated between repetitions.
- Baseline requested rates: 8,000 msgs/s (1KiB), 2,500 msgs/s (16KiB), 400 msgs/s (64KiB), and 25 msgs/s (1MiB).
- Separate 16-node stress rates: 16,000 msgs/s (1KiB) and 4,000 msgs/s (16KiB).
- CycloneDDS-OFF: shipped default SHM-disabled configuration. CycloneDDS-ON: iceoryx XML + **RouDi started per case**, with 2GiB container shared memory and custom pools.
- FastDDS-OFF: \`FASTDDS_BUILTIN_TRANSPORTS=UDPv4\`; FastDDS-ON: \`FASTDDS_BUILTIN_TRANSPORTS=SHM\`.
- Zenoh-OFF: shipped SHM-disabled default; Zenoh-ON: \`ZENOH_CONFIG_OVERRIDE=transport/shared_memory/enabled=true\` inherited by all nodes + **fresh router per case**.
- Pub-sub measured *after* subscribers were ready, with graph convergence blocking publisher until all endpoints were seen. Graph time includes publisher RMW init/node and endpoint visibility, **excludes** routers/RouDi boot and receiver process creation. This is *not* pure DDS SPDP/SEDP discovery.
- OS evidence collection samples process \`/proc/<pid>/maps\` plus RSS and CPU child rusage; mapping alone does **not** prove every user sample was transmitted via SHM.

### Transport activation sanity check

For each *stress* payload, **all 10 CycloneDDS-ON cases** mapped \`/dev/shm/iceoryx_mgmt\` and \`/dev/shm/root\`; FastDDS-ON mapped \`/dev/shm/fastrtps_*\`; Zenoh-ON mapped \`/dev/shm/*.zenoh\`. The corresponding OFF modes showed **0/10** matching middleware-specific mappings. RouDi logs report successful shared-memory reservation and readiness.

## Baseline 16-node performance, 10-run median

P99 is the median of subscribers' per-run P99 (measured sender steady-clock timestamp to receiver callback) followed by a median across 10 runs. All six modes met the exact requested rate and all had 100% receiver delivery at 16KiB, 64KiB and 1MiB; at 1KiB rates and delivery differ for some implementations.

| Payload | CycloneDDS OFF / ON P99 ms | FastDDS OFF / ON P99 ms | Zenoh OFF / ON P99 ms |
|---|---:|---:|---:|
| 1KiB @ 8,000/s | 0.349 / 0.348 | 1.027 / **0.561** | 0.946 / 0.939 |
| 16KiB @ 2,500/s | 0.430 / **0.318** | 0.778 / 0.504 | 0.958 / 0.970 |
| 64KiB @ 400/s | 0.795 / **0.275** | 0.681 / 0.458 | 0.612 / 0.676 |
| 1MiB @ 25/s | 9.006 / **4.495** | **4.993 / 21.652** | 6.099 / 6.332 |

**Surprise worth reproducing:** At 1MiB, 16-node FastDDS SHM-only P99 is consistently ~21ms, compared with ~5ms in UDPv4-only mode at the **same actual ~25.5 msg/s and 100% delivery**. The FastDDS SHM-on run also showed higher P50, not just a rare outlier. At this low rate, only ~50 messages per receiver were sent per trial, so per-trial P99 has limited precision; do not infer the underlying cause without further instrumentation.

### 16KiB graph-ready time scaling (milliseconds, 10-run median)

| Backend | N=2 | N=4 | N=8 | N=16 |
|---|---:|---:|---:|---:|
| CycloneDDS-OFF | 6.1 | 16.6 | 15.6 | 23.0 |
| CycloneDDS-ON | 10.5 | 16.2 | 18.9 | 26.4 |
| FastDDS-OFF | 116.7 | 115.7 | 252.1 | 259.4 |
| FastDDS-ON | 119.9 | 120.4 | 122.0 | 135.3 |
| Zenoh-OFF | 9.2 | 10.5 | 15.6 | 22.5 |
| Zenoh-ON | 9.0 | 10.2 | 13.8 | 23.1 |

Do not interpret these as pure DDS discovery or include the daemon start-up costs that were explicitly outside the measured interval.

## 16-node stress, 10-run median

| Payload / requested rate | Mode | Publisher achieved msgs/s | Mean receiver goodput MiB/s | Delivery % | Receiver P99 ms |
|---|---|---:|---:|---:|---:|
| 1KiB / 16,000 | CycloneDDS-OFF | 15,993 | 9.48 | 60.70 | 1.072 |
| | CycloneDDS-ON | 15,997 | 10.45 | 66.91 | 0.677 |
| | FastDDS-OFF | 4,609 | 4.35 | 96.63 | 1.349 |
| | FastDDS-ON | 15,993 | 8.70 | 55.71 | 1.034 |
| | Zenoh-OFF | 15,999 | 10.88 | 69.66 | 1.150 |
| | Zenoh-ON | 15,999 | 10.74 | 68.76 | 1.178 |
| 16KiB / 4,000 | CycloneDDS-OFF | 3,998 | 59.53 | 95.33 | 2.168 |
| | CycloneDDS-ON | 4,000 | 62.39 | 99.82 | 0.656 |
| | FastDDS-OFF | 2,927 | 45.09 | 98.54 | 1.971 |
| | FastDDS-ON | 4,000 | 62.25 | 99.64 | 1.148 |
| | Zenoh-OFF | 3,996 | 62.16 | 99.58 | 2.079 |
| | Zenoh-ON | 3,999 | 62.18 | 99.50 | 2.078 |

At 1KiB stress, most implementations saturated the 4-vCPU node and many samples were missed. A low P99 **among delivered messages** is not sufficient evidence of suitability for real-time control; the high loss has to be accounted for.

## Version & environment limitations

- Docker Ubuntu 24.04 + ROS 2 Jazzy binary packages: rmw_cyclonedds_cpp 2.2.4, rmw_fastrtps_cpp 8.4.4, rmw_zenoh_cpp 0.2.11; CycloneDDS 0.10.5.
- Baseline job CPU per size was allocated by GitHub independently: 1KiB/64KiB/1MiB = AMD EPYC 9V45; 16KiB = Intel Xeon Platinum 8573C. Stress 1KiB/16KiB jobs = AMD EPYC 9V74. Cross-payload and baseline-vs-stress absolute comparisons are therefore **not CPU-matched**, but ON/OFF for the same payload were within one runner job.
- The Ubuntu RouDi package is a different patch build from ROS's iceoryx library; the job uses explicit \`iox-roudi --compatibility minor\`, which is a potential confound. Memory pools are customized, and RouDi's monitoring mode is disabled.
- CPU time includes child-process workloads and daemon process exit/reaping. Sampled \`peak_children_rss_mib\` double-counts mapped pages and does not include RouDi daemon RSS; **do not use it to rank total physical memory footprints**.
- Across six modes the same *application* API/QoS/message is fixed, but non-SHM transports differ (UDP for FastDDS/Cyclone DDS vs Zenoh's transport/router); ON configurations also implement SHM very differently. This is **not** a homogeneous network-stack or native zero-copy benchmark.
- No NIC or wireless link, per-sample transport-level packet trace, tail-latency confidence interval, DDS QoS variations, fixed-size loanable messages, CPU affinity tuning, or cross-host clock synchronization. Results do not directly rank drone air-to-ground radio performance.

## Primary sources

- ROS \`rmw_zenoh\` shared memory settings: https://github.com/ros2/rmw_zenoh/blob/rolling/README.md
- ROS CycloneDDS + iceoryx restrictions and RouDi configuration: https://github.com/ros2/rmw_cyclonedds/blob/rolling/shared_memory_support.md
- Fast DDS builtin transport environment settings: https://fast-dds.docs.eprosima.com/en/stable/fastdds/env_vars/env_vars.html
