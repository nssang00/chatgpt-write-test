# Verified ROS 2 middleware SHM ON/OFF benchmark — 2026-10-25

## Completion and independent evidence

- **Instrument-isolated validation: 162/162 successful measurements**, plus 6 two-node capability probes and 6 sixteen-node transport-mapping probes. GitHub Actions: https://github.com/nssang00/chatgpt-write-test/actions/runs/40192147175
- Original CSV, JSON, ROS logs, graph-time measurements, per-process SHM map snapshots, environment: https://github.com/nssang00/chatgpt-write-test/actions/runs/40192147175/artifacts/12598717359
- **Additional broad steady-rate matrix: 960/960 successful trials**, 4 payload sizes x 4 node counts x 6 configurations x 10 repetitions: https://github.com/nssang00/chatgpt-write-test/actions/runs/40191466145
- **Additional 16-node stress matrix: 120/120 successful trials**, 1/16KiB x 6 configurations x 10 repetitions: https://github.com/nssang00/chatgpt-write-test/actions/runs/40191697257
- The last two independent runs used a different QoS history depth (8 rather than 16) and collected intrusive /proc CPU/memory samples. **Do not numerically pool their latencies with the instrument-isolated run**.

## Protocols and controlled conditions

One common C++17/O3 ROS 2 Jazzy `rclcpp` executable and message type `std_msgs/msg/UInt8MultiArray`; one publisher and N-1 subscriber **processes**. QoS: RELIABLE, VOLATILE, KEEP_LAST(16) for instrument-isolated validation. Ubuntu 24.04 GitHub Actions, 4 vCPUs; one host, Docker SHM mount 2GiB. Transport configurations:

- Cyclone-NET: default CycloneDDS, SHM not enabled.
- Cyclone-SHM: CycloneDDS iceoryx SharedMemory Enabled in `cyclone_shm_on.xml`, live `iox-roudi` daemon.
- FastDDS-UDP: `FASTDDS_BUILTIN_TRANSPORTS=UDPv4`.
- FastDDS-SHM: `FASTDDS_BUILTIN_TRANSPORTS=SHM`.
- Zenoh-NET: `ZENOH_CONFIG_OVERRIDE=transport/shared_memory/enabled=false`.
- Zenoh-SHM: `ZENOH_CONFIG_OVERRIDE=transport/shared_memory/enabled=true`, also inherited by a fresh router per case.

SHM ON is not itself evidence of data transport. The 16-node low-load preflight examined `/proc/<pid>/maps` for vendor-specific SHM segments **while exchanging data** and excluded ROS lttng diagnostic SHM. Observed:
| Stack | Nondiagnostic transport SHM mappings in workers/router |
|---|---:|
| Cyclone-NET | 0 mapped processes |
| Cyclone-SHM | **16** mapped processes, including iceoryx management and data segments |
| FastDDS-UDP | 0 mapped processes |
| FastDDS-SHM | **16** mapped processes, Fast DDS shared segments |
| Zenoh-NET | 0 mapped processes |
| Zenoh-SHM | **17** mapped processes, .zenoh segments including router |

All 12 probes exchanged data successfully; 0 excluded configurations. These mappings **do not prove every message followed SHM** and do not imply loaned-message zero copy.

## Instrument-isolated results (three repeats each)

In timed trials memory-map sampling was turned off to avoid contaminating latency. Each result below is the median of 3 run-level medians of the 15 receivers' individual P99 latencies (2-node jumbo has one receiver). All cases completed with **100% delivery** and achieved approximately their requested send rate.

### 16 nodes, 16KiB, 4,000 msg/s high rate

| Middleware | P99 network/UDP, µs | P99 SHM, µs | Typical sender msg/s |
|---|---:|---:|---:|
| CycloneDDS | 395.5 | **204.3** | ~4,000 |
| FastDDS | 600.8 | **316.8** | ~4,000 |
| Zenoh | 617.5 | 599.6 | ~4,000 |

Per-subscriber delivered application payload ~= 62.5 MiB/s (not NIC throughput). Normal-rate 16KiB at 1,500 msg/s also had full delivery: CycloneDDS network/SHM 675/262 µs; FastDDS 295/272 µs; Zenoh 338/456 µs.

### 16 nodes, 64KiB, 500 msg/s

| Middleware | P99 network/UDP, µs | P99 SHM, µs |
|---|---:|---:|
| CycloneDDS | 1,228.4 | **299.8** |
| FastDDS | 530.7 | **376.6** |
| Zenoh | 543.1 | 457.4 |

### 2 nodes, 1MiB, 50 msg/s

| Middleware | P99 network/UDP, µs | P99 SHM, µs |
|---|---:|---:|
| CycloneDDS | 2,010.3 | **798.8** |
| FastDDS | **597.6** | **11,574.8** |
| Zenoh | 1,858.3 | **1,432.9** |

**FastDDS SHM has a major 1MiB tail-latency regression in this workload**, despite a very low P50 (~181µs). The broad, separate 10-repetition matrix corroborates the phenomenon at 16 nodes (FastDDS UDP 4,993µs P99 versus SHM 21,652µs P99). Cause remains **unproven**; possibilities include SHM buffer pressure, fragmentation/segment allocation, history handling, or thread scheduling. It would be incorrect to assume SHM is always faster.

### Discovery (16-node 16KiB 4,000 msg/s; publisher init to observing all subscribers)

| Middleware | Network/UDP graph-ready ms | SHM graph-ready ms |
|---|---:|---:|
| CycloneDDS | 23.86 | 25.05 |
| FastDDS | 252.25 | 130.95 |
| Zenoh | 15.85 | 20.59 |

This includes RMW init, node creation and graph visibility, **not** pure protocol discovery. Zenoh router and iceoryx RouDi startup are not part of the publisher interval.

## Statistical and methodological cautions

- Only 3 instrument-isolated trials per condition; the separate 10-repetition runs support broader directionality but use KEEP_LAST(8), other runners and a process memory monitor; latency medians are not interchangeable.
- Paths compared are vendor-defined transports; the same ROS application/QoS does not imply identical protocol or zero-copy semantics.
- SHM exists only within a common host. No Ethernet/drone Wi-Fi transport measurements, no packet-level path tracing, no cross-host clock synchronization, no safety guarantees.
- 1MiB FastDDS SHM anomaly demands transport-packet or allocator profiling before attributing it to any specific internal implementation mechanism.
- Aggregate RSS from child processes may count shared memory several times, so CPU/RSS from separately sampled runs must not be treated as exact physical resource footprint.

## Scientific conclusion

CycloneDDS **with configured and detected iceoryx SHM** has the best measured 16KiB high-load and 64KiB fan-out P99 in the independent uncontaminated run. FastDDS SHM improves 16KiB P99 over UDP, but **degrades 1MiB P99 dramatically**. Zenoh SHM availability was confirmed through mappings, yet it did **not consistently improve 16KiB tail latency**. These results overturn the notion that default FastDDS superiority at 16KiB proves it is intrinsically faster than CycloneDDS once both are allowed to use SHM.
