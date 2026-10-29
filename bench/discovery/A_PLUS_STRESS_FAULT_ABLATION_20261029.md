# A+ protocol stress, temporary-loss, publisher-crash and ablation gates — 2026-10-29

## Executive verdict

**A+ is NOT yet a generally reliable production Pub/Sub protocol.** It passed the lower-load all-receiver tests but failed decisively under (a) 200 nodes × 100 messages per sender × 10% independent netem loss per veth direction and (b) publisher crash immediately after the initial data was sent. These failures survived independent seeds and must be treated as architectural / recovery concerns. This report documents actual GitHub-hosted Ubuntu 24.04 runner executions, not an analytical projection.

**All 42 primary matrix cases and 4 smoke cases finished with recorded outcomes.** Note a GitHub Actions job marked success can contain a Pub/Sub `status=FAIL`; CI checks assertion of measurement completion, NOT strict message-reliability success. Interpret the JSON `status`.

Evidence / workflow logs and per-node JSON:
- [Load 12 cases](https://github.com/nssang00/chatgpt-write-test/actions/runs/40894987327)
- [Fault injection 10 cases](https://github.com/nssang00/chatgpt-write-test/actions/runs/40895075683)
- [Ablation 10 cases](https://github.com/nssang00/chatgpt-write-test/actions/runs/40895113182)
- [High-loss and independent-seed reproduction 10 cases](https://github.com/nssang00/chatgpt-write-test/actions/runs/40896575048)
- [Smoke 4 cases](https://github.com/nssang00/chatgpt-write-test/actions/runs/40894879123)

## Experimental design and limits

- One separate Linux network namespace + veth + shared Linux bridge per node; bridge multicast snooping disabled.
- Common netem **2ms delay at both veth egresses**; **0%, 10%, 20%, 30% loss separately applied at both sides**, not the same rate end-to-end. A configured 10% on each independently traversed link is more aggressive than 10% total path loss.
- Data plane uses a single benchmark Topic, 1–200 publishers, all other nodes subscribers. Small JSON UDP payloads of 128 or 256 application bytes (not exactly equal to wire message sizes).
- Load tests: 50/100/200 nodes, 20 or 100 messages *per node*, zero and 10% loss, publishing every ~0.06–0.08s per node with per-node initial publication jitter. 12 independent matrix cases, seed 1 each.
- Fault tests: 50/100/200 nodes, 20 messages per publisher. `burst` blackholes both veth directions for **5% of selected peers** for ~3s and then restores baseline loss (0 or 10%). `crash` kills publisher 0 **as soon as it publishes its last initial sample**, before peer repair is guaranteed; all other nodes must receive the full original Publisher 0 data. Expected-reception totals exclude the killed subscriber but retain its previously emitted data.
- Ablation: 100 nodes, 20 messages per publisher, 0/10% loss: remove HELLO, remove anti-entropy gossip, disable duplicate-NACK suppression, replace multicast repair with unicast repair without adjusting suppression policy (the last is a *deliberately incompatible negative control*, not a fair reliable-unicast comparator).
- Extended: 100/200 nodes with 20 messages at 20/30% per-leg loss; 200×100 with 10% loss at seeds 2 and 3; and 20%-loss ablation at 100/200.
- `full` A+ is a custom experimental integration of periodic Multicast HELLO, membership anti-entropy, origin-sequenced IP multicast, a suppressible multicast NACK and multicast source repair (max 32 repairs per source-sequence). It is **not NORM, PGM, DDS, or a proof of wireless RF characteristics**.
- Application success = EVERY surviving subscriber has every expected publisher/sequence tuple and all of those subscribers have learned every node ID. The publisher itself does **not** receive an explicit authenticated end-to-end ACK from each subscriber. The benchmark knows the configured node count, publisher count and messages per publisher in advance.

## 1. Message load correctness

| N | Messages per publisher | Unique expected remote deliveries | Loss 0% | Loss 10% seed 1 |
|---:|---:|---:|---|---|
| 50 | 20 | 49,000 | PASS | PASS |
| 50 | 100 | 245,000 | PASS | PASS |
| 100 | 20 | 198,000 | PASS | PASS |
| 100 | 100 | 990,000 | PASS | PASS |
| 200 | 20 | 796,000 | PASS | PASS |
| **200** | **100** | **3,980,000** | **PASS** | **FAIL (3,965,992/3,980,000)** |

At N200, 100 messages per publisher, the zero-loss seed1 case reached all **3,980,000 / 3,980,000** unique remote receives, with ~1.10 GB observed bridge TX bytes. The corresponding lossy run delivered 3,965,992, missing 14,008, with ~2.77 GB bridge TX bytes, ~125,589 NACK requests and ~125,427 origin multicast repairs.

**Independent seed reproduction for that same 200×100 / 10% per-direction loss condition:**

| Seed | Delivered | Required | Missing | Fully compliant |
|---:|---:|---:|---:|---|
| 1 | 3,965,992 | 3,980,000 | 14,008 | NO |
| 2 | 3,934,815 | 3,980,000 | 45,185 | NO |
| 3 | 3,967,996 | 3,980,000 | 12,004 | NO |

The additional instrumentation on seeds 2 and 3 reported 6 source-sequences at the 32-repair cap in seed 2 and **zero** capped source-sequences in seed 3. The bounded-retransmission cap is a plausible contributor in some runs, but cannot alone explain the observed failure.

**Other loss levels, smaller message count:** 100×20 and 200×20 both achieved strict full delivery at **20% and 30% configured loss per veth direction** in a single seed. These results do NOT establish a guarantee under high loss: the outcome depends strongly on total send load, window, network scheduling and repair dynamics.

## 2. Targeted outages and publisher lifetime

**3-second 100%-loss blackout on 5% of nodes:** 50 nodes (0%,10% baseline), 100 nodes (10% baseline, seeds 1 and 2), 200 nodes (10% baseline) were all **PASS** after restoring the selected nodes' links. All expected unique deliveries completed: 49,000 / 198,000 / 796,000 respectively.

**Publisher 0 SIGKILL immediately after sending all original sequence numbers:** all tested cases were **FAIL**, even when background configured loss was zero. All remaining nodes retain publisher 0 in their expected origin set.

| N | Base loss | Seed | Remote unique delivered / expected among surviving subscribers | Missing |
|---:|---:|---:|---:|---:|
| 50 | 0% | 1 | 47,040 / 48,020 | 980 |
| 50 | 10% | 1 | 47,355 / 48,020 | 665 |
| 100 | 10% | 1 | 194,836 / 196,020 | 1,184 |
| 100 | 10% | 2 | 195,549 / 196,020 | 471 |
| 200 | 10% | 1 | 790,549 / 792,020 | 1,471 |

These prove the current source-only repair/retention path cannot recover all user data when the original source becomes permanently unavailable. Implement **peer-assisted repair with bounded copies**, receipt acknowledgments and source failover; retries alone cannot repair information that no remaining peer stores. Note the result cannot prove whether each missing tuple belongs to the killed publisher; fault runs did not yet include per-origin loss maps. A separately logged `unexpected_process_exit` close to the regular timeout in the first run is the original harness's interpretation of normal child deadline expiry, and was corrected in a later diagnostic patch.

## 3. Ablation

100 nodes × 20 messages each, strict receipt expected 198,000:

| Ablation | Loss 0% | Loss 10% | Interpret carefully |
|---|---|---|---|
| Full A+ | PASS | PASS | Reference implementation |
| **Remove Anti-Entropy membership exchange** | **PASS** | **PASS** | Periodic HELLO alone converged for this static shared-L2 network |
| Remove HELLO | FAIL | FAIL | With no bootstrap peer addresses, the remaining gossip cannot start; at 0% loss the raw multicast data still happened to arrive but Discovery FAILED |
| Disable NACK suppression | PASS | PASS | No reliability benefit attributable to suppression on this workload alone |
| Replace group Repair with simple Unicast Repair | FAIL | FAIL | Incompatible with group request suppression: an intentionally incomplete implementation, not a controlled comparison against a correctly designed unicast-repair protocol |

At N100×20, 10% loss, membership/control packet count (excluding NACKs) for full A+ vs no Anti-Entropy was **22,980 vs 2,609**; full NACK count 4,768 vs suppression-disabled NACK count 5,061 in independent runner jobs.

At N100×20, 20% loss, full and no Anti-Entropy still both PASS; full control 27,367 vs no Anti-Entropy 3,278. Crucial counterexample at **N200×20, 20% loss**: both full and no Anti-Entropy PASS, but the **no Anti-Entropy run transmitted ~1.79 GB bridge bytes** vs **~1.00 GB** for full A+. It is NOT safe to claim 'remove Gossip always makes traffic lower': less membership traffic can indirectly change repair behavior, runtime, contention, and network cost.

At N200×20, 20% loss, full A+ NACKs 51,825 and suppression-disabled NACKs 41,578, both PASS. Single trial counts are not monotonic or statistically convincing. Repeated identical seeds on comparable controlled hosts are required to claim a specific NACK suppression gain.

## 4. Real technical contribution and priorities

**Highest priority — correctness under faults:** source-independent recovery. Cache limited repair data at multiple peers or designated replicas; define membership epochs and receiver completion ACKs; add retention duration, replay-window policy, retention expiry and transfer of responsibility on source shutdown. Test an entire original publisher disappearing before subscribers have received its data.

**Second — avoid costly batch-end repair:** currently test-specific `m`, `N` and `publisher_count` are globally known, and NACK/recovery starts after a configured final-publish window. This is **not yet an open-ended, dynamic Topic Pub/Sub implementation**. Add sequence-window-based incremental gap detection and periodic progress advertisements without relying on a known final message count.

**Third — adapt membership Gossip/HELLO:** HELLO alone converged in a static multicast LAN; Anti-Entropy adds nontrivial overhead but its removal can exacerbate data-plane recovery costs at scale. Consider on-demand anti-entropy and adaptive HELLO suppression, but first benchmark late joins, partitions and different multicast-lost distributions.

**Fourth — collision/airtime and ablation rigor:** actual Wi-Fi multicast semantics and available airtime are NOT accurately modeled by a Linux bridge; run ns-3 Wi-Fi or physical radios. Keep full subscriber ID and Topic interest matching rather than global full membership as the sole pass criterion. Compare A+ against faithful NORM/PGM and real Gossipsub with the **same end-to-end durability contract**.

This report intentionally does not claim a novel algorithm or a universal reliable-delivery guarantee. All changes are on the experiment branch; `main` has not been modified.
