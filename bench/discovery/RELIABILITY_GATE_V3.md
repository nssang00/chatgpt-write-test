# Reliability Gate V3 — 300 concurrently publishing nodes

## Decision rule (set before reading results)

**Primary correctness gate:** Every 300-node execution must report discovery_success=true, pubsub_success=true, reported=300, total_delivered_remote=179400 out of 179400, with zero unexplained send_errors. A single failed seed fails this gate. This is not proof of unconditional exactly-once delivery.

**Secondary resource measurements:** udp_rcvbuf_errors, udp_in_errors, socket_rx_overflow, bridge RX/TX bytes, NACK/repairs, CPU and memory. Any nonzero kernel receive drops are relevant. We cannot claim RF network properties from an on-host bridge.

**Adoption criterion:** Two successful seeds for every condition justify continuing only as a research candidate. Production admission requires at least five independent seeds, 1/5/20/100/300 publishers, payload/rate sweeps, relay failures, late joins, network partitions and rejoin, dynamic subscriptions, QoS and direct Zenoh/Cyclone baselines with matched workload. The prototype does not implement HyParView/Plumtree/Scribe/Gossipsub/NORM fully.

## Workload and environment

- 300 Linux namespaces (one Python process per node) attached by veth to a Linux bridge, multicast snooping disabled.
- Each node publishes 2 distinct records; all other 299 nodes subscribe. Exactly 300 x 299 x 2 = 179,400 unique receiver-message assertions.
- Modes: multicast group delivery plus direct selective recovery, and hybrid source-rooted 3-ary eager tree plus bounded peer lazy IHAVE/IWANT plus direct-origin recovery.
- Two seeds (1,2) per mode and per 0/10% netem random loss condition. Both loss conditions include a constant 2ms delay on each veth direction. Effective loss on a traversal can exceed 10%.
- All nodes already bound sockets before the common barrier. Does not measure cold process startup, real Wi-Fi contention, encryption or subscription handshake.
- 12s membership phase, publication start randomly spread over 30s (this reduces exact same-millisecond publish collision but every node publishes in the test).
- Max four missing origins per 1.2-second node repair round; seed-rotated origin selection; selective sequence batch request.
- Kernel UDP buffer ceiling 16MiB. 117s maximum test interval per seed including 12s discovery.
- A single missing receiver-message pair is a failed run even if aggregate ratio rounds to 100.0%.

## Source

Workflow: https://github.com/nssang00/chatgpt-write-test/actions/workflows/pubsub-300-gate-v3.yml

Implementation: bench/discovery/pubsub_node.py and bench/discovery/pubsub_run.py. GitHub Actions logs have one RESULT JSON per seed with per-node JSON archives.
