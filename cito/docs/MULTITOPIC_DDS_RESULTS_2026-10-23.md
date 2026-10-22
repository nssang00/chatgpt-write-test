# Cito vs Cyclone DDS — verified multi-topic A/B measurements

**Measurement date:** 2026-10-22 UTC / 2026-10-23 KST.
**Evidence:** [event-driven matrix Actions #39854435409](https://github.com/nssang00/chatgpt-write-test/actions/runs/39854435409) and [focused follow-up Actions #39855017123](https://github.com/nssang00/chatgpt-write-test/actions/runs/39855017123).
Recorded directly from 32 per-case JSON stdout rows across completed GitHub Actions jobs; every case contains two repetitions for each engine.

**Configuration:** Ubuntu 24.04 GitHub-hosted runner; separate Linux network namespace+veth for publisher, intended subscriber, and unrelated subscriber. Per-run fresh bridge. Cyclone DDS Ubuntu `cyclonedds-dev` 0.10.4-series, C API, BEST_EFFORT, DDS WaitSet/ReadCondition receive loop, SPDP multicast and unicast data. Cito experimental `UdpRuntimeAdapter` + Discovery retransmit branch, UDP broadcast and unicast. Both use same 500ms post-discovery warmup, sample count, topic count, nominal app payload, and rate; order alternates.

| Network | Topics | Nominal app bytes | Hz/topic | Nominal app Mbit/s | Cito received / expected | Cyclone received / expected | Cito p95 μs (range) | DDS p95 μs (range) | Full delivery: Cito / DDS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 1 | 16 | 20 | 0.003 | 40/40 | 40/40 | 115–127 | 192–193 | 2/2 / 2/2 |
| baseline | 8 | 256 | 20 | 0.328 | 320/320 | 320/320 | 67–91 | 101–103 | 2/2 / 2/2 |
| baseline | 33 | 1200 | 20 | 6.336 | 1320/1320 | 1320/1320 | 64–75 | 65–66 | 2/2 / 2/2 |
| baseline | 65 | 4096 | 20 | 42.598 | 2600/2600 | 2600/2600 | 42–51 | 80–80 | 2/2 / 2/2 |
| limited | 1 | 16 | 20 | 0.003 | 40/40 | 39/40 | 51613–51635 | 52305–52314 | 2/2 / 1/2 |
| limited | 8 | 256 | 20 | 0.328 | 318/320 | 319/320 | 58005–58014 | 56144–56149 | 0/2 / 1/2 |
| limited | 8 | 4096 | 2 | 0.524 | 312/320 | 310/320 | 96764–96765 | 96523–96595 | 0/2 / 0/2 |
| limited | 33 | 1200 | 2 | 0.634 | 1311/1320 | 1306/1320 | 72559–72564 | 71104–71105 | 0/2 / 0/2 |

## Interpretation

- **Baseline:** 1, 8, 33, and 65 topic configurations all passed both repeated full-delivery checks for *both* engines. This also exercises the Cito 32-key snapshot and 64-endpoint boundary.
- **Lossy limited link:** Synthetic per-node 1 Mbps, 50 ms one-way delay and 1% independent loss. BEST_EFFORT messages are intentionally not retransmitted; a non-100% delivery fraction can be expected. No claim of DDS/Cito delivery guarantees is justified.
- Both receiver implementations are **event-driven** in this final set (Cito socket poll, DDS ReadCondition/WaitSet); the earlier C API 200μs polling experiments are **not** the latency comparison used here.
- Even here, the payload is only nominally matched: Cito includes a binary 12B benchmark preamble within the app payload whereas DDS IDL uses integer fields plus a string. On-wire bytes, CDR/RTPS encapsulation, sampling overhead, operating-system scheduling and buffering differ.
- The benchmark only uses one matched subscriber and one unrelated subscriber, a single publisher, and two repeats; it is not a production v25 API benchmark, real-radio field test, statistical ranking, or high-confidence capacity limit.
- `full delivery` requires all expected sequences and clean process statuses. Cito and Cyclone both use a gating condition that publishers wait until all matching interests/endpoints are ready before sending; the benchmark does **not** directly report time-to-discovery.

## Reproduction and raw logs

- Source and protocol: [cito/tests/bench](https://github.com/nssang00/chatgpt-write-test/tree/cito-multitopic-dds-benchmark/cito/tests/bench), [Python orchestrator](https://github.com/nssang00/chatgpt-write-test/blob/cito-multitopic-dds-benchmark/cito/tools/multi_topic_compare.py), [benchmark protocol](https://github.com/nssang00/chatgpt-write-test/blob/cito-multitopic-dds-benchmark/cito/docs/MULTITOPIC_DDS_BENCHMARK.md).
- Open both linked Actions runs above and download each case's artifact. Artifacts preserve case `summary.csv`, `results.json`, per-node stdout and `tc -s qdisc` results for limited network cases.
- The focused follow-up job is marked successful when all scheduled cases **execute**, but `results.json` contains independent per-case `pass` booleans. Do not interpret its green overall status as 100% delivery in lossy conditions.
