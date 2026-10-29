# Cyclone DDS 10-node 16-second outlier: diagnostic findings
Date: 2026-10-29

## Conclusion

The previously reported **16.635 seconds is not SPDP/SEDP participant and endpoint discovery time**. It is the slowest **application-level completion time** (each of 10 DataReaders has seen at least one user-data sample from all 10 DataWriters). The original benchmark conflated DDS discovery completion with a repeating, lossy/timed, application-data presence stream.

With Cyclone DDS Python 11.0.1, on the identical one-runner netns/veth/Linux Bridge topology, instrumentation of built-in Participant topic and matched DataWriter/DataReader handles yields **all 10 participants known in 0.1–0.2 seconds and all 10 writer/reader endpoints matched in approximately 0.2–0.3 seconds** in repeat experiments.

**Therefore: retract any prior conclusion that Cyclone DDS requires 16 seconds to discover 10 nodes.** Also do not use the earlier results to claim a generically faster custom DDS-discovery alternative.

## Raw original experiment

Source: bench/discovery/node.py (benchmark/discovery-netns-20261029 branch)
Original job: https://github.com/nssang00/chatgpt-write-test/actions/runs/40836976565
Original 10-node default Cyclone DDS:
- Slowest per-node app-visible completion: 16.635326713 sec.
- Median node completion: approximately 11.626 sec.
- 8/10 finished between 10.267 and 11.629 sec; last 2 around 16.633–16.635 sec.
- Sends repeated Alive samples roughly every 0.7 sec, until all N unique node IDs have been received as DataReader samples.
- NO direct measurement of built-in participant discovery nor SEDP endpoints.
- reader.take() was invoked without N. Python binding default is N=1.

## New independent A/B diagnosis

Diagnostic Python sources:
- bench/discovery/cyclone_diag_node.py
- bench/discovery/cyclone_diag_run.py

Run 1: https://github.com/nssang00/chatgpt-write-test/actions/runs/40852069909
Run 2 configuration isolation: https://github.com/nssang00/chatgpt-write-test/actions/runs/40852673351

All new benchmarks were performed on separate fresh GitHub-hosted Ubuntu 24.04 runners; all writers and readers were initialized after a common barrier. DataWriter emits presence every 0.7 sec. Sample reader takes either 1 or up to 256 records per call. BuiltinTopicDcpsParticipant and matched handles measured approximately every 125ms.

### 10 nodes, Cyclone default network config, take N=1

| Seed | All participant discovered | All writer-reader matched | Application all unique origins |
|---|---:|---:|---:|
| 1 | 0.178s | 0.314s | 8.755s |
| 2 | 0.155s | 0.290s | 16.610s |
| 3 | 0.178s | 0.311s | not all within 27s |

### 10 nodes, Cyclone default network config, take N=256

| Seed | All participant discovered | All writer-reader matched | Application all unique origins |
|---|---:|---:|---:|
| 1 | 0.105s | 0.238s | 7.426s |
| 2 | 0.165s | 0.287s | 7.320s |
| 3 | 0.154s | 0.281s | 25.648s |

**Result:** one-sample-at-a-time reading contributes avoidable app-side backlog (especially as N grows), but it is NOT sufficient to explain the 10-node tail. Increasing N to 256 does not consistently eliminate missing/later first data samples.

### Isolating network and participant periodic-announce configuration

- eth0 + multicast restricted to SPDP only, original SPDP default interval, N=256: seed 1 12.365s; seed 2 12.967s; seed 3 did not complete within 27s.
- eth0 + multicast restricted to SPDP + SPDPInterval=1s, N=256: seed 1 6.036s; seed 2 did not complete within 27s; seed 3 6.024s.
- Auto interface + SPDPInterval=1s, N=256: seed 1 26.393s; seed 2 did not finish in 27s; seed 3 18.061s.
- eth0 + allow multicast for data, N=256: seed 1 4.619s, seed 2 did not finish in 27s.
- eth0 + SPDPInterval=250ms, N=256: did not finish in 27s, single run.

**No configuration showed reliable complete data presence across every seed.** Tuning SPDPInterval and eth0 can change application tail but cannot be claimed to fix the underlying issue; it is not proof of an SPDP bug.

### Additional 20-/40-node findings

- 20 nodes, default configuration: full participant detection around 0.38–0.39s and reader/writer matching around 0.5s even when not all application-origin samples arrived in 27s.
- 40 nodes, default configuration: many peers were missing even at participant or endpoint-match stages within 27s on the shared bridge runner. With eth0/1s settings, more participants and user data were observed, but still no complete 40-node application data convergence in this isolated diagnostic.
- Consequently, the 10-node sample tail and 40-node scaling failure may be **different or compound mechanisms**; do not extrapolate a 10-node diagnosis to the 40-node vendor boundary.

## Per-origin evidence

Detailed JSON files contain app_first_timestamps and a per-125ms timeline for each node. Example 10-node default, take256, seed2:
- Every node completed matched Reader/Writer endpoint lists within about 0.3s.
- Data from writer ID 4 was first reported around 5.84–5.85s by most readers, despite being matched far earlier.
- In a separate seed and take1, writer ID 0 was first reported after up to 16.51s at another receiver.
- This is consistent with delayed publisher/data-path delivery, rather than uniformly slow discovery, but the test did NOT capture a packet-level sender trace sufficient to identify a definitive transport failure.

## Recommended instrumentation for exact root cause

1. Record the per-publisher actual writer.write start/end and maximum blocking time; use a shared monotonic clock (single runner) to align publishing with remote first observations.
2. Capture tcpdump on bridge per run, inspect RTPS SPDP/SEDP vs user-data flows, multicast group joins, unicast destination locators, and IGMP. Pair packet captures with per-node SO_RXQ_OVFL and tc -s qdisc drop counts.
3. Log Cyclone effective configuration, chosen network interface, multicast settings, QoS and RTPS trace at config/finer verbosity.
4. Separate "full matched publications" and "app has received a sample from every ID" in all product comparisons.
5. Match publisher QoS, retained history, bandwidth, reporting interval and reader.batch size between vendor experiments; measure repeated trials with seed and confidence intervals.

This changes the algorithm-selection interpretation: custom UDP multicast/gossip may meet application data objectives in some tests, but it has **NOT** been proven to discover 10 DDS-like peers faster than Cyclone's SPDP/SEDP, which in these diagnostics took roughly 0.1–0.3s for all 10 endpoints.

## Official references

- https://cyclonedds.io/docs/cyclonedds-python/latest/cyclonedds.builtin.html
- https://cyclonedds.io/docs/cyclonedds-python/latest/cyclonedds.sub.html
- https://cyclonedds.io/docs/cyclonedds/latest/config/multicasting.html
- https://cyclonedds.io/docs/cyclonedds/latest/config/config_file_reference.html
