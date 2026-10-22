# Cito UDP Discovery — Linux network namespace + tc netem results

Tested on GitHub Actions Ubuntu 24.04, 2026-10-22 UTC. Sources:
- [Unshaped 3–400 node run #39802616753](https://github.com/nssang00/chatgpt-write-test/actions/runs/39802616753), conclusion: success
- [Network-impairment matrix run #39802876082](https://github.com/nssang00/chatgpt-write-test/actions/runs/39802876082), conclusion: failure because several intentionally adverse profiles did not meet the full-path criterion. Build and offline test preparation succeeded.

## Summary (1 publisher, N-2 matching subscribers, 1 unrelated subscriber)

| Per-node synthetic profile | Largest fully passing N (2 consecutive runs) | First failing N | Observation |
| --- | ---: | ---: | --- |
| No shaping (unshaped run) | 400 | none tested | 398/398 received on both runs |
| No shaping (matrix run) | 200 | none tested | 198/198 received on both runs |
| 1 Mbps, no delay/loss | 100 | none tested | 98/98 received on both runs |
| 100 ms one-way delay, no loss/rate cap | 100 | none tested | 98/98 received on both runs |
| 1% random loss only | 3 | 10 | N=10: 8/8 routes on both runs; payload 8/8 then 7/8 |
| 1 Mbps + 50 ms + 1% loss | 3 | 10 | N=10: full-path 8/8 then route peak 7/8 and payload 0/8 |
| 256 kbps + 150 ms + 3% loss | 3 | 10 | N=10: route peak 7/8; no publish, 0/8 payload |
| 64 kbps + 300 ms + 5% loss | 3 | 10 | N=10: route peak 7/8; no publish, 0/8 payload |

Full-path PASS requires all matching routes, all delivered payloads, no data/route for unrelated subscriber, and zero exit statuses. It does not mean proof of a true node ceiling: each profile stops at first failure and only tested node counts are represented.

### Sample measured discovery/publish elapsed time
- Unshaped 400 nodes: publisher elapsed 4,570 and 4,825 ms.
- 1 Mbps only, 100 nodes: 781 and 829 ms.
- 100 ms one-way delay only, 100 nodes: 1,471 and 1,474 ms.
- 256 kbps + 150 ms + 3% loss, 10 nodes: no publish by 45-second publisher timeout, peak 7 of 8 matching routes.

### Interpretation and limitations
- The former 700-process loopback tests did not isolate network namespaces. The unshaped 400-node CI result **does** use separate namespaces and veth pairs.
- Cito currently sends announce approximately every 150 ms with a 600 ms lease. Loss of a snapshot/route control packet can leave an incomplete route state despite continued announcements; this is a code-level hypothesis requiring controlled retransmission validation.
- One-shot UDP DATA is not acknowledged, so payload loss does **not** prove Discovery failure. Example: loss-only 10-node run successfully discovered 8/8 routes, but one payload was lost.
- tc netem is attached to each namespace eth0 and host veth egress; rates constrain individual nodes and aggregated node ingress, **not** a single shared Wi-Fi/RF channel. Nominal delay and loss are synthetic; Linux timers/queues and bridge broadcast replication affect realized conditions.
- Each CI job attaches and verifies netem qdiscs before running, and uploads profile.json, per-node logs, result JSON/CSV, and tc -s qdisc stats (download from the linked Actions run's Artifacts section).
- No observations above the tested N can be inferred from this document. Exact maximum capacity and field-radio reliability remain unknown.

## Follow-up
An isolated [retry experiment branch](https://github.com/nssang00/chatgpt-write-test/tree/cito-discovery-retry) tests bounded retransmission for missing control responses. It must be evaluated separately: a prototype run contained an overly strict exact route-request count that rejected legitimate retransmits; the corrected run has a separate commit and Actions execution.
