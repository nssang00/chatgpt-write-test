# Cyclone DDS 30–40 Node SPDP/SEDP-Only Investigation (2026-10-29)

## Executive finding

**This GitHub-hosted Ubuntu Linux netns/veth/Linux Bridge setup exhibits an abrupt reproducible failure between 32 and 33 independently hosted Cyclone DDS 11.0.1 participants. This is NOT proof of a universal Cyclone DDS 32-peer limit.**

The native DDS participants, one idle DataWriter and one idle DataReader per namespace, were created after a shared barrier. There were **zero application user-data writes**. Completion required (a) each node's built-in participant reader to observe N unique GUIDs, (b) each DataReader to have N matched writers, and (c) each DataWriter to have N matched readers. One participant in each network namespace and identical Topic/domain were used.

0% configured packet loss, **no tc netem qdisc and no artificial delay**, 25-27-second deadlines per trial.

| N | Independently executed successes | Slowest complete matching (successful trials) |
|---:|---:|---|
| 30 | 5/5 | 0.4935–0.7066 s |
| 31 | 2/2 | 0.5361–0.7545 s |
| 32 | 2/2 | 0.7765–0.7933 s |
| 33 | 0/2 | no total completion |
| 34 | 0/2 | no total completion |
| 35 | 0/5 | no total completion |
| 40 | 0/5 | no total completion |

The first draft test had a separate **Python binding race**: get_matched_publications() sometimes raised IndexError ("invalid index") because the matched set changed between two ctypes calls. The orchestrator stopped all peers when a process exited, making early failures uninterpretable. We corrected it by isolating transient errors and continuing/retrying. The table above uses the corrected 15-run suite and the subsequently corrected 31–34 suite. A small number of transient Python API errors remained visible in successful 30-node runs, but do not change the eventual matching result.

Across unsuccessful N=35 and N=40 runs, the union of built-in participant GUIDs reported by all processes included all expected N. Individual participants nevertheless missed other peers (or did not keep them), while endpoint matches were incomplete. Thus not every peer disappeared entirely from the network.

### Instrumentation

- Aggregate UDP /proc/net/snmp RcvbufErrors and InErrors = 0 in the corrected base experiments.
- tc qdisc dropped packets = 0 and host veth link drop counters = 0 according to the measured counters. These do not rule out all dropped packets elsewhere in networking or DDS processing.
- DDS traces for N=40 showed some discovered participants' default 10-second lease expiring and later SPDP rediscovery; this is direct evidence of discovery churn but **not proof** of its underlying cause.
- The N=40 trace reports Cyclone **Internal/MaxParticipants=0** (unlimited) and Discovery/MaxAutoParticipantIndex=99. The exact observed 32/33 boundary is therefore not explained by a documented Cyclone MaxParticipants=32 setting. A ROS2-specific rmw_cyclonedds MaxAutoParticipantIndex=32 issue should not be conflated with this direct Python experiment.
- CPU/RAM was tracked per namespace, and a representative 40-node run contains two bridge-port PCAPs and Cyclone DDS fine-level per-node discovery traces.

### Controlled diagnostics, no application data

- 35 nodes with DDS participant creation staggered across 500ms and 2s: neither passed. 40 nodes staggered 2s also did not pass.
- Interface fixed to eth0 at 40 nodes: failed.
- Netem 2ms delay at each end at 35/40: failed. (Base experiment has zero artificial delay.)
- LeaseDuration=60s, SPDPInterval=1s, and both simultaneously at N=35/40: no strict full convergence; longer lease alone cannot be asserted to solve the issue.
- AllowMulticast=spdp (unicast SEDP) at N=33: partial improvement, up to 25/33 participants completely matching in one configuration but still a strict failure. At N=35/40 it also failed, with and without raised UDP buffer defaults.
- SPDPResponseMaxDelay=500ms at N=35/40: failed. A 1s response delay also failed. 2s was rejected by the config parser with "value out of range" and is **excluded as an invalid config**, not counted as a product performance test.
- Increasing host UDP socket default/max receive buffer did not restore full convergence on its own.

**NO GO for declaring product superiority.** The Cyclone DDS failure is real in this particular benchmark, but the causal mechanism at 33+ participants is not yet proven. Likewise, no comparable pure participant-and-endpoint discovery test of Zenoh/custom discovery was part of this execution, so no algorithm should be selected on these new runs.

## Next debugging gate

1. Test Cyclone DDS native C++/C implementation with the same topology, domain and Topic without Python bindings to distinguish underlying native DDS behavior from Python/runtime overhead.
2. Capture RTPS discovery packets on sender and receiver for representative N=32 vs N=33 nodes (not only two bridge ports), correlate SPDP GUIDs and SEDP endpoint data, and compare with DDS fine/finest traces. Parse the per-peer lease expiry/renewal pattern and check whether the same GUID fails on all peers or only a subset.
3. Inspect Linux kernel ingress/egress/bridge drops and CPU scheduling at peaks; pcaps can expose packet loss not visible in the current UDP socket/qdisc summaries.
4. Benchmark a source-built native Cyclone DDS with documented network interface, multicast and socket configurations; then build a **fair matched workload** for Zenoh and the proposed middleware.
5. If the failure disappears under native C/C++ or improved network configuration, revise the claimed failure boundary before selecting a custom discovery algorithm.

## Reproduction

Branch: diagnostic/cyclone-30-40-spdp-only-20261029

- bench/discovery/discovery_only_node.py
- bench/discovery/discovery_only_run.py
- .github/workflows/cyclone-discovery-only-corrected.yml
- .github/workflows/cyclone-spdp-boundary-stagger.yml
- .github/workflows/cyclone-40-config-isolation.yml
- .github/workflows/cyclone-spdp-lease-ab.yml
- .github/workflows/cyclone-sedp-unicast-recovery.yml
- .github/workflows/cyclone-spdp-response-delay.yml

Primary 15-run corrected experiment:
https://github.com/nssang00/chatgpt-write-test/actions/runs/40869220054

Exact 31–34 boundary and boot-stagger:
https://github.com/nssang00/chatgpt-write-test/actions/runs/40869684587

Interface and 2ms delay control:
https://github.com/nssang00/chatgpt-write-test/actions/runs/40869036575

Lease/periodic SPDP reannouncement:
https://github.com/nssang00/chatgpt-write-test/actions/runs/40869977221

Unicast SEDP / receive buffer tests:
https://github.com/nssang00/chatgpt-write-test/actions/runs/40870211094

SPDP response delay:
https://github.com/nssang00/chatgpt-write-test/actions/runs/40870560820

All workflows archive per-node timelines, GUIDs, aggregate counters and diagnostic data; representative N=40 includes SPDP/SEDP internal traces and two veth port PCAPs.
