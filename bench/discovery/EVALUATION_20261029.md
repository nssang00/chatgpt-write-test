# Discovery / PubSub Algorithm Evaluation — 2026-10-29

## Decision

**NO-GO for production selection.** None of the prototype variants met 100% all-to-all Topic delivery when 100 or 300 nodes concurrently published two messages. The most promising **research candidate**, not a validated winner, is **eager dissemination tree + bounded lazy peer IHAVE/IWANT + batched, rate-limited origin NACK repair**. Keep UDP multicast + selective recovery as the mandatory baseline; evaluate actual NORM for reliable multicast and actual libp2p Gossipsub in a later phase.

The tested Python UDP algorithms are **NOT** reference implementations of HyParView, Plumtree, libp2p Gossipsub, NORM, or Scribe. They approximate a subset of their topology/delivery ideas. The benchmark uses known node count and writer IDs as test scaffolding. No proof of reliable delivery, resilience under process crashes, unknown membership, or real RF behavior is implied.

## Test environment and metrics

- GitHub-hosted Ubuntu 24.04 Linux runner, 1 Python process per Linux netns, 1 veth pair per node, Linux bridge with snooping disabled, and tc netem on both ends.
- Time barrier begins after node import/start; this is network cold-start, not process startup.
- A Pub/Sub test passes only if every active subscriber receives every unique (publisher_id, sequence_id) from every other publisher, and all nodes discover all node IDs.
- Basic runs used 2 messages per publisher, with 30, 100 or 300 active peers. 10% netem per direction can imply ~19% end-to-end path loss over two independent directions.
- Delivery ratio excludes own locally published samples; no higher-level ACK guarantee is inferred from this small bounded test.
- Network counters include discovery, data and repair traffic, so cannot be represented as "discovery-only bytes".
- **Critical:** single trial per combination and a shared runner CPU. Failure to converge within timeout is recorded as failure, not a middleware intrinsic capability limit.

## Results: all nodes simultaneously publishers + subscribers

| test | loss | multicast | tree | sparse mesh | eager-tree + lazy hybrid |
|---|---:|---|---|---|---|
| 30 nodes / 1,740 remote receptions | 0% | PASS 1,740/1,740 | PASS 1,740/1,740 | PASS 1,740/1,740 | not tested |
| 30 nodes / 1,740 remote receptions | 10% | PASS 1,740/1,740 | PASS 1,740/1,740 | PASS 1,740/1,740 | not tested |
| 100 nodes / 19,800 remote receptions (V2) | 0% | FAIL 13,253 | FAIL 3,239 | FAIL 19,181 | FAIL 19,259 |
| 100 nodes / 19,800 remote receptions (V2) | 10% | FAIL 15,483 | FAIL 2,671 | FAIL 17,935 | FAIL 19,463 |
| 300 nodes / 179,400 remote receptions (V2) | 0% | FAIL 42,553 | not tested | not tested | FAIL 29,565 |
| 300 nodes / 179,400 remote receptions (V2) | 10% | FAIL 122,943 | not tested | not tested | FAIL 16,051 |

100-node V2 introduced batched, rate-limited NACK and 3-second publisher spread; 300-node V2 used 8 seconds publisher spread. Both 0% and lossy V2 cases used the same 2ms netem delay baseline. They still did not pass in all-publishers cases.

## Results: diagnostic, ONE publisher, all other nodes subscribe

| case | loss | multicast | tree | sparse mesh | eager-tree + lazy hybrid |
|---|---:|---|---|---|---|
| 100 nodes / 198 remote receptions | 0% | PASS, 24.489s | PASS, 4.190s | PASS, 8.702s | PASS, 4.939s |
| 100 nodes / 198 remote receptions | 10% | PASS, 12.230s | PASS, 8.683s | PASS, 11.693s | PASS, 10.001s |
| 300 nodes / 598 remote receptions | 0% | FAIL, 488/598 | not tested | not tested | PASS, 39.016s |
| 300 nodes / 598 remote receptions | 10% | PASS, 15.155s | not tested | not tested | PASS, 44.258s |

Times measured from a common nominal publisher phase, including stagger and retries. It is NOT latency per message. 0% sometimes performed worse than 10% even with matched base delay, showing high run-to-run/system scheduling sensitivity. No statistical latency ranking is warranted.

## Interpretation

1. Our code confirms that 300 isolated subscribers can all obtain data from one publisher under the hybrid prototype in both conditions measured.
2. The same hybrid did NOT provide complete all-to-all delivery when everyone published at once; the missing data must be treated as a correctness failure.
3. Bounded tree forwarding reduces payload duplication; lazy IHAVE/WANT adds recovery paths but can create substantial control traffic. Sparse eager mesh generates many duplicate payloads, even at 30 nodes.
4. In this shared-Linux-host netns benchmark, kernel queueing, Python scheduling, CPU contention, multicast bridge replication and simultaneous initial publication are likely confounders. We did not collect UDP socket drop and tc qdisc overflow counters, therefore these mechanisms are hypotheses, not proven root causes.
5. The current membership mechanism itself uses multicast HELLO + gossip and stores all node IDs. This is not HyParView active/passive views. Real topic subscription discovery, unknown changing publisher sets, and late join are not yet supported.
6. A guaranteed "every subscriber gets every message" requirement must specify publisher retention, bounded crash assumptions, late join, end-to-end acknowledgement, persistence and timeouts. No fully reliable delivery in arbitrary permanent network partitions is possible.

## Next gates before architecture lock

- **A. Data overload isolation**: repeat node counts 30, 100, 300 with 1, 5, 20, 100, 300 publishers (up to n), publish rates and payload sizes; capture number of simultaneous tx.
- **B. Observe kernel drops**: SO_RXQ_OVFL / sock_diag, netstat UDP InErrors/RcvbufErrors, tc -s qdisc, interface dropped counters, CPU throttling, receive queue depth. Control and data bytes separately.
- **C. Correct bounded reliability**: per-publisher sequence ranges, bitmap ACK/NACK batching, randomized suppression, retransmission retention, backpressure, pacing, end-to-end completion receipts. Preserve conservative timing bounds.
- **D. Real algorithms**: compare maintained libp2p Gossipsub, actual HyParView+Plumtree active/passive views/tree healing, and NORM library if stable multicast is a target. Do not compare paper names to simplified sketches as though they were identical.
- **E. Robustness**: >=5 independent runs per point (different seeds), node restart and disappearance, network partitions/rejoin, topic churn, late subscribers, relay failure, 10/30% independent packet loss, variable link topology and PHY-like bandwidth contention.
- **F. Independent transport environment**: at least two physical hosts; netns bridge on one runner is not a real wireless mesh. Do not infer an absolute vendor ranking against Zenoh or Cyclone DDS from these experiments.

## Source and raw logs

- [Initial prototype + Zenoh/Cyclone comparison](https://github.com/nssang00/chatgpt-write-test/actions/runs/40836976565)
- [200/300 discovery-only followup](https://github.com/nssang00/chatgpt-write-test/actions/runs/40837811961)
- [30-node PubSub patterns](https://github.com/nssang00/chatgpt-write-test/actions/runs/40839563769)
- [100-node all-publishers V2](https://github.com/nssang00/chatgpt-write-test/actions/runs/40840692522)
- [300-node all-publishers V2](https://github.com/nssang00/chatgpt-write-test/actions/runs/40840924531)
- [100-node one-publisher diagnostic](https://github.com/nssang00/chatgpt-write-test/actions/runs/40841798746)
- [300-node one-publisher diagnostic](https://github.com/nssang00/chatgpt-write-test/actions/runs/40841814929)

Each workflow archives per-node JSON and logs as downloadable GitHub Actions artifacts.
