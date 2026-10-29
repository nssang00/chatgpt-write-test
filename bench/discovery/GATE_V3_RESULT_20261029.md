# Gate V3 final outcome: NO-GO for current 300-node data-delivery prototype

Date: 2026-10-29. GitHub Actions run: https://github.com/nssang00/chatgpt-write-test/actions/runs/40844537911

## Strict decision

**NO-GO:** None of eight independent condition/seed executions passed full receiver-visible delivery. Do not select the current Python UDP hybrid as the production default transport. This does NOT falsify the original HyParView, Plumtree, NORM or libp2p Gossipsub algorithms: the implementation is a minimal inspired prototype.

**300 publishers / 300 participants / 2 messages each:** 300 x 299 x 2 = 179,400 required unique remote deliveries PER execution.

| Mode | Netem loss each direction | Seed | Received | Expected | Reception % | Fully complete receivers | Discovery completed |
|---|---:|---:|---:|---:|---:|---:|---|
| multicast | 0% | 1 | 77,603 | 179,400 | 43.26% | 0 | yes |
| multicast | 0% | 2 | 152,152 | 179,400 | 84.81% | 0 | yes |
| multicast | 10% | 1 | 64,400 | 179,400 | 35.90% | 0 | yes |
| multicast | 10% | 2 | 119,282 | 179,400 | 66.49% | 0 | yes |
| hybrid | 0% | 1 | 4,189 | 179,400 | 2.34% | 0 | yes |
| hybrid | 0% | 2 | 11,671 | 179,400 | 6.51% | 0 | yes |
| hybrid | 10% | 1 | 2,124 | 179,400 | 1.18% | 0 | no |
| hybrid | 10% | 2 | 2,838 | 179,400 | 1.58% | 0 | yes |

## Instrumentation

- For every condition, aggregate UDP RcvbufErrors, Udp InErrors, SO_RXQ_OVFL counters and application send errors reported zero. This **does not rule out veth/netem qdisc drops, bridge forwarding drops, CPU starvation or loss from topology forwarding** because these were not measured in V3. Zero SO_RXQ_OVFL should not be interpreted as packet-loss-free network.
- Hybrid 0% seed 1: only 6,225 initial/relayed data datagrams reported from origin/tree combined; this is drastically below the number expected from a healthy 300-member delivery tree (around 179,400 forwarding edges for 600 data messages). Once an upper tree branch is missed, most descendants do not get the payload. A lazy signal and origin NACK fallback did not catch up.
- For example, hybrid 0% seed 1 sent 73,464 NACK messages, but only 4,798 repair payload responses were reported. Request delivery, origin load, timeout behavior, actual response queueing and qdisc packet drops remain to be diagnosed.
- Multicast 0% seed 2 was best observed in these eight tests at 84.81%, but did not pass the correctness criterion.
- Run duration approximately 118 seconds per seed (barrier after process init, 12s membership + 105s post-discovery window), send start spread 30 seconds to reduce simultaneous send spikes, with two random seeds. 0% and 10% loss tests both included 2ms netem delay at each veth side. Socket buffer max was raised to 16MiB.

## Explicit limitations

- All participants use same pre-known number of nodes and publisher IDs for benchmark assertions. This is NOT dynamic Topic discovery, per-subscriber interest routing, late joins, or network-partition tolerance.
- The relay tree is deterministic 3-ary for each message origin. The hybrid uses bounded neighbor IHAVE/IWANT and origin NACK repair; it is not the published Plumtree or HyParView protocol.
- Linux bridge and netem in a single GitHub runner do not model real wireless interference, airtime contention, mobility or multipath.
- No formal proof of reliable delivery, exactly-once semantics or application-level durability is available.
- 2 seeds per condition are insufficient to rank algorithms statistically, but a single failed seed suffices to reject this strict all-receivers gate.

## Next engineering gate

1. Capture qdisc drop/overlimit/backlog with tc -s qdisc; per-veth and bridge drops; /proc/net/snmp in every netns; CPU throttling, run-queue latency, aggregate receive throughput and per-origin payload counters.
2. Sweep 1/5/20/50/100/300 active publishers on the same 300-node topology to find the tipping point. Keep overall expected unique messages explicit.
3. Implement a **bounded reliable repair layer** with per-origin receive bitmap, periodic summary, receiver-specific missing ranges, acknowledgments and randomized suppression; sender data retention and backpressure. Enforce strict 300/300 completion.
4. Compare multicast + truly reliable NACK/FEC with a full Plumtree eager/lazy dissemination implementation, then a maintained Gossipsub reference. Test dynamic membership, publisher/relay failure, late join, partitions and reconnect.
5. Only after repeated complete deliveries with acceptable overhead consider algorithm selection. Zenoh and Cyclone require a separate fair matched-payload baseline; early Python versions were not a fair product ranking.

## Reproduce

Workflow file: .github/workflows/pubsub-300-gate-v3.yml

Python source: bench/discovery/pubsub_node.py and bench/discovery/pubsub_run.py

GitHub Actions artifacts for four matrix jobs contain summary JSON and individual node records, under each seed-specific directory.
