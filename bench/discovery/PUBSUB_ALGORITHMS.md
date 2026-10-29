# Experimental sparse Pub/Sub algorithm selection

## Design and scope

This is a **real UDP over Linux netns/veth/bridge/tc netem** prototype, *not* the reference implementation of HyParView, Plumtree, libp2p Gossipsub, NORM or Scribe. Do not label these variants as implementations of those standards/papers.

Common bootstrap across every variant:
- Linux Bridge with multicast snooping disabled; per-node UDP multicast HELLO with randomized timing and periodic retry.
- Lightweight membership digest plus delta request/response to up to 4 randomly chosen peers per round.
- Every process must observe all n node IDs; this tests complete application-visible membership convergence.
- For the benchmark only, n, publisher IDs and messages-per-publisher are known from CLI. The production algorithm must support unknown dynamic membership and subscription changes.

Pub/Sub variants (all nodes publish 2 samples to bench/all; every other node subscribes):
- multicast: data multicast to all receivers, with publisher-specific NACK repair.
- tree: source-rooted deterministic 3-ary dissemination tree over discovered node IDs, plus NACK repair. This is only Plumtree-*inspired* (no eager/lazy tree adaptation).
- mesh: deterministic degree-4 sparse ring/shortcut unicast forwarding with duplicate suppression, plus NACK repair. This is only Gossipsub-*inspired* (no GRAFT/PRUNE, IHAVE/IWANT, peer scoring or topic mesh maintenance).

**Critical fairness caveats:** The topology recipes use an omniscient n for stable node-number mapping, although each process learns network addresses dynamically. This is not production-grade overlay discovery and favors the tree/mesh variants over fully decentralized overlay construction. All modes use identical simplistic membership dissemination and direct-origin NACK (not every mode's native repair protocol). The multicast traffic in a bridge is replicated to all veth ports; its Linux traffic volume and CPU behavior may not match hardware Wi-Fi or Ethernet switch IGMP snooping. Data transfer and discovery traffic are combined in bridge counters. Under 10% netem applied to BOTH veth ends, effective path loss may be closer to 19% for independent directions.

## Acceptance

A run is PASS only when:
1. All n nodes have a record of all n members.
2. Every subscriber has received each of the m samples from every other publisher (n*(n-1)*m unique receiver-sample pairs).
3. All n process reports are present.

A failed run remains failed even if its aggregate delivery rate rounds to 1.0. Outputs include missing receivers, total NACK, data retransmissions, duplicate packets, aggregate CPU and bridge byte counters.

Timing: process imports and binds complete before a barrier; at t=0 traffic begins; publishing occurs after a fixed common discovery interval. This is NOT cold process launch timing. First data arrival is per-node; completed message delivery includes repair. Individual run results are single samples: independent repeated trials and confidence intervals are required before choosing a production algorithm.

## Run

As root on Linux with iproute2:

    sudo python3 bench/discovery/pubsub_run.py --sizes 30,100 \
      --modes multicast,tree,mesh --losses 0,10 \
      --discovery 9 --timeout 24 --messages 2

Review artifacts in pubsub-results/results.csv and detailed per-node JSON.

## What remains

- Real HyParView active/passive views, shuffle, join, failure detection.
- Real Plumtree eager/lazy trees, graft/prune and healing.
- Native libp2p Gossipsub reference as a baseline.
- Unknown and dynamic subscriber set; retained messages, joins after publish, network partitions.
- No-loss proof under specified fair-loss models; receiver ACK/transactional delivery if stricter guarantees are needed.
- 5+ trials per point, larger payload rates, and synchronized cross-host latency.
