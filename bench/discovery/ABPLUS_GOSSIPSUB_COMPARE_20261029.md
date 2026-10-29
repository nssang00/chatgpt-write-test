# A+ vs B+ vs canonical go-libp2p Gossipsub — Actions observations, 2026-10-29

## Current decision scope

**Provisional winner for one shared L2/multicast-capable broadcast domain: A+ (multicast dissemination with receiver feedback suppression and bounded origin multicast repairs).** Its observed complete subscriber delivery is stronger and its network traffic/control overhead lower than the current B+ implementation.

**No production deployment approval.** The tests use only two 32-byte application messages per publisher and do not test multi-topic routing, mobile radios, process churn, restarts, partitions, subscriber joins/leaves, or persistent recovery until explicit subscriber acknowledgments. No run can prove a general guarantee under permanent partitions.

**Actual native Gossipsub reference is present** using Go modules github.com/libp2p/go-libp2p v0.50.0 and github.com/libp2p/go-libp2p-pubsub v0.19.0. This is not our simplified Python mesh. Its performance must be interpreted with its underlying encrypted TCP transport and independent six-neighbor bootstrap; comparing link-byte counters to raw UDP multicast is informative but NOT apples-to-apples radio transmission efficiency.

## A+/B+ controlled comparison (50 / 100 / 200 nodes)

Each node publishes 2 messages and all other nodes subscribe, so expected unique remote receptions are 4,900 / 19,800 / 79,600 respectively. Each virtual node uses its own Linux namespace and veth endpoint, connected to one Linux bridge. Both 0% and 10% netem configurations apply 2ms latency at both veth ends; the 10% case also applies 10% loss **at each end** (not 10% end-to-end). All modes use the same multicast HELLO + anti-entropy membership. A+/B+ share **a new experimental common application repair layer**: multicast feedback of requested publisher/sequence ranges, suppressible duplicate requests, pace-limited multicast source repairs, and bounded per-source retained sequences.

A+ sends original payloads by IP multicast. B+ initially floods a static 4-neighbor ring/long-link mesh plus sends selective lazy ID advertisements to more peers. **B+ does not yet implement true HyParView active/passive membership and relies on the same multicast repair service as A+**, so it is not yet a valid non-multicast multi-hop proof.

| N | loss (each veth direction) | A+ strict PASS (seed 1) | B+ strict PASS (seed 1) | A+ bridge TX | B+ bridge TX |
|---:|---:|:---:|:---:|---:|---:|
| 50 | 0% | YES | YES | 5,765,753 | 8,755,598 |
| 50 | 10% | YES | YES | 7,108,840 | 9,467,551 |
| 100 | 0% | YES | YES | 23,561,554 | 35,933,275 |
| 100 | 10% | YES | YES | 31,379,639 | 34,347,332 |
| 200 | 0% | YES | YES | 117,664,462 | 163,657,417 |
| 200 | 10% | YES | **NO** | 152,256,512 | 168,100,000 (approx; see artifact) |

In every A+ PASS, **all** receiver/publisher/sequence assertions were satisfied, not merely 99.x%. B+ at 200/10% received 79,435/79,600 (seed1), 79,598/79,600 (seed2), 78,515/79,600 (seed3).

### Independent repeat runs

- A+ at 100 nodes and 10% loss: **3/3 PASS**, 19,800/19,800 each.
- A+ at 200 nodes and 10% loss: **3/3 PASS**, 79,600/79,600 each. Seed1 bridge TX 152.3MB, seed2 147.8MB, seed3 146.9MB. NACK requests 1,770, 1,972, 1,765.
- A+ at 200 nodes and 0% loss: **2/2 PASS**.
- B+ at 100 nodes and 10% loss: **3/3 PASS**.
- B+ at 200 nodes and 10% loss: **0/3 PASS**.
- B+ at 200 nodes and 0% loss: **2/2 PASS**.

N=200, 10% loss A+ recorded 1,770 feedback requests and 1,086 source multicast repair sends, whereas B+ recorded 51,968 feedback requests and 9,755 source repairs in seed1. Overhead from full mesh flooding and lazy messages remained high.

## Real libp2p Gossipsub baseline and bootstrap confounds

Go source: bench/gossipsub/main.go, built with actual libraries. One actual libp2p host and Gossipsub Topic/Subscription per node; a static set of ring/long-range bootstrap edges, with valid libp2p identity and encrypted TCP streams. No A+/B+ multicast repair code is used for Gossipsub.

**Initial run with simultaneous symmetric peer dialing was invalid as an algorithmic scaling comparison**: libp2p TLS handshakes sometimes failed with an unexpected ClientHello, causing dial-backoff and disconnected peers. The separate eight-peer diagnosis showed this error explicitly. The harness was corrected so only the lower node ID initiates each undirected connection.

After this fix:
- Eight-peer smoke test: 112/112 remote receipts, no bootstrap connection errors.
- 50 nodes, loss 0% and 10%: **PASS** 4,900/4,900 each (no bootstrap connection errors).
- 100 nodes, loss 0% and 10%: **PASS** 19,800/19,800 each (no bootstrap connection errors).
- 200 nodes, loss 0% and 10%, one seed: **FAIL** 77,224/79,600 and 78,977/79,600 respectively; some peers were disconnected by the end although the initial connection pass reported no errors.

An additional run maintains and re-establishes peers throughout the experiment; this is necessary because Gossipsub depends on a separate peer discovery and connection manager. Check the updated retry workflow for the most recent outcome. **Do not interpret incomplete Gossipsub delivery as a defect of the published algorithm while the harness has disconnected nodes.**

## Links

- A+ and B+ initial 12-case gate: https://github.com/nssang00/chatgpt-write-test/actions/runs/40887235553
- A+ and B+ independent repeat seeds: https://github.com/nssang00/chatgpt-write-test/actions/runs/40888914378
- Initial real Gossipsub with bootstrap defects: https://github.com/nssang00/chatgpt-write-test/actions/runs/40887661603
- Real Gossipsub corrected asymmetric-dial run: https://github.com/nssang00/chatgpt-write-test/actions/runs/40889388719
- Real Gossipsub peer-reconnection follow-up: https://github.com/nssang00/chatgpt-write-test/actions/runs/40890414515

## Technical limits and next gates

1. **A+ reliability**: add sender-per-subscriber explicit ACKs / epoch completion, bounded retention, subscriber membership changes, and a concrete final-delivery SLA; repeat with 20–100 messages per sender, payload 128–1024 bytes, paced + bursty loads.
2. **Actual radio-like effects**: use contention-limited medium / ns-3 / real 802.11 radios and asymmetric link loss. Linux Bridge's replicated multicast packets do not consume physical shared airtime like WLAN.
3. **B+ and Gossipsub**: compare their behavior when IP multicast is blocked and when disconnected groups / 1–3 hops must forward data. B+ cannot reuse the multicast-only repair path in this comparison; reimplement bounded unicast feedback over dynamic actual active views or a faithful HyParView protocol.
4. **True Gossipsub**: maintain authenticated peers, comparable Topic readiness and application-level ACK/retention if the strict guarantee is required. Default Gossipsub gossip semantics alone are not end-to-end guaranteed delivery.
5. **Statistical power**: three same-host cloud runs are encouraging but insufficient for a product-level guarantee. Repeat with multiple underlying runner instances, fixed CPU and memory budgets and rigorous drop/latency distributions.

Default branch untouched. Benchmark branch: benchmark/pubsub-a-plus-b-plus-real-gossipsub-20261029
