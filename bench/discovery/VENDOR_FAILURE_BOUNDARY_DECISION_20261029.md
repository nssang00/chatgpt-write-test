# Vendor failure-boundary vs custom discovery / PubSub — 2026-10-29

## Provisional architecture decision

**SELECT for the next single-L2 prototype:** multicast bootstrap + membership anti-entropy + selective per-origin NACK recovery. It is the less complex of the two custom candidates; on the tested low-loss LAN conditions its completed-delivery results matched the tree+lazy gossip hybrid with generally lower control/data bytes. Keep the hybrid (source-rooted eager tree + bounded lazy IHAVE/IWANT + origin NACK) as a research variant for cases where multicast delivery is limited, multi-hop relays exist, or explicit traffic distribution is required.

**NOT a production rollout approval.** Neither custom variant passed 40 nodes with 10% netem loss (2/2 failures for each). Zero missing messages is a non-negotiable correctness requirement. Production reliability remains NO-GO in this test.

**Claim supported by tests:** In this specific one-host Linux netns/veth/bridge setup at 40 nodes with a 38s pre-publication warmup and 0% configured loss, both custom candidates attained 3/3 all-to-all reception, while Cyclone DDS and Zenoh Peer attained 0/2 each. This does NOT establish product-wide superiority; configs, language runtimes, security, QoS, network topology, data retention and real RF links vary.

## Environment and measurement

- 1 isolated Linux network namespace per process; each virtual endpoint connected by veth to the same Linux bridge with multicast snooping disabled; tc netem on each end. 0%/10% configured loss on each direction, 2ms baseline delay.
- Zenoh Peer: eclipse-zenoh Python 1.10.1 default peer discovery; Cyclone DDS: cyclonedds Python 11.0.1, Reliable writer/reader and KeepAll history. Both use one app-visible presence stream plus two distinct data samples per node. All other nodes must receive both data samples. Cyclone's reliable QoS does not imply durable replay to readers that were not yet matched.
- Candidates: experimental **nonstandard** Python UDP multicast and deterministic source-rooted tree/lazy peers. All candidates know benchmark total node count and publisher IDs; that knowledge is not a production solution for unknown membership. Presence is learned via multicast HELLO and gossip before the data test.
- Warmup was **fixed**, not a distributed subscriber-ready barrier; 17s and 38s cases deliberately assess whether early publication before endpoint discovery contributed to failures. All runtimes publish after warmup + [0,4]s randomized jitter. Results below do not prove that middleware-native discovery or endpoint matching alone caused failures.
- Strict PASS = all n nodes have discovered n IDs AND all n(n-1)*2 remote receive assertions are satisfied within time limit; no unmatched process errors. Each experiment ran in its own fresh GitHub runner, so no residual namespace names caused comparisons to fail.
- For candidates the summary field pubsub_all_complete_after_pub_s is relative to the configured warmup, while vendor field data_all_s is relative to t=0. Normalize times before comparing. Bridge byte counters include HELLO, middleware control, payload and repairs, not solely discovery.
- A strict failure is meaningful for the tested SLA, not a mathematically proven scaling limit. The tests were one to three runs per case, not statistically powered trials.

## 17-second publish phase: baseline failure boundary

At 0% configured loss, all four stacks PASS at 30 nodes (1,740/1,740 remote receptions), while all FAIL at 50 nodes (4,900 expected).
At 40 nodes (3,120 expected), all four fail the strict 48-second SLA:

| Mode | All IDs observed by nodes | Remote receptions / expected |
|---|---:|---:|
| Cyclone DDS | 1/40 | 400/3,120 |
| Zenoh Peer | 0/40 | 2,040/3,120 |
| Multicast + selective repair | 40/40 | 3,086/3,120 |
| Tree + lazy hybrid | 40/40 | 3,116/3,120 |

At 30 nodes with 10% netem loss and 17s fixed warmup (3 seeds):

| Mode | Strict PASS seeds | Detail |
|---|---:|---|
| Cyclone DDS | 1/3 | 1,736; 1,738; 1,740 out of 1,740 |
| Zenoh Peer | 0/3 | 1,688; 1,688; 1,738 out of 1,740 |
| Multicast + selective repair | 3/3 | 1,740/1,740 each |
| Tree + lazy hybrid | 3/3 | 1,740/1,740 each |

**Important timing confound:** Cyclone DDS 30 nodes / 10% loss took approximately 29.94s for all nodes to observe all peers in one short-warmup run; data started at 17s. Retesting with a 38s warmup resulted in Cyclone PASS. It would be misleading to present the 17s loss failures as native reliability bugs.

## 38-second late-publish fairness control: 40 nodes, 0% loss

| Mode | Strict pass seeds | Note |
|---|---:|---|
| Cyclone DDS | 0/2 | still not fully discovered by test deadline |
| Zenoh Peer | 0/2 | still not fully discovered by test deadline |
| Multicast + selective repair | 3/3 | all 3,120 unique remote receptions |
| Tree + lazy hybrid | 3/3 | all 3,120 unique remote receptions |

Candidate per-seed total completion times *after configured 38s warmup*:

- Multicast: 29.302s, 8.538s, 26.999s. Bridge TX bytes: 8,138,404; 6,211,234; 7,743,925.
- Hybrid: 21.000s, 31.743s, 17.383s. Bridge TX bytes: 7,812,736; 8,783,222; 7,135,104.

Both pass this gate, hybrid median completion is lower but with only 3 seeds and fluctuating measurements it is not established faster. Multicast has generally less code and traffic (mean about 7.36MB vs 7.91MB in these three trials).

## 40 nodes, 10% loss, 38s warmup: NO-GO for production reliability

| Mode | Strict pass seeds | Remote receptions |
|---|---:|---|
| Cyclone DDS | 0/1 | 1,538/3,120 |
| Zenoh Peer | 0/1 | 2,024/3,120 |
| Multicast + selective repair | 0/2 | 3,098 and 3,082 /3,120 |
| Tree + lazy hybrid | 0/2 | 3,119 and 3,098 /3,120 |

Even **one** missing (publisher ID, sequence, receiver ID) is a failure. Hybrid improved some partial reception cases but did not meet the non-negotiable complete-delivery objective.

At 30 nodes, 10% loss and late 38s warmup, Cyclone DDS, multicast and hybrid all completed 1,740/1,740 in one run. Zenoh completed 1,737/1,740. The earlier Cyclone 1/3 result is not a fair claim of intrinsic protocol failure without this warmup clarification.

## Other limits / next actions

1. Bounded **end-to-end reliability**: per-publisher sequence bitmap, ACK aggregation / suppressible NACK, replay buffers, adaptive repair rate and deadlines, reason-coded failure telemetry. Need strict zero-miss at 40 nodes / 10% loss in >= 5 independent seeds.
2. Record UDP socket queue drops, veth tc qdisc drops and CPU scheduling; reduce real-time Python bottlenecks. Existing bridge netem loss applies per veth direction, so receiver effective loss can be higher than configured 10%.
3. Align user-data payload length, batching, transport default reliability and discovery-API reporting even more closely. Current vendor probe payload format and custom UDP JSON frame size differ; absolute vendor performance or packet counts are NOT universally comparable.
4. Replace fixed timeout/warmup with a phase barrier based on end-to-end subscriber readiness, then explicitly separate readiness latency vs delivery latency. Test actual late join, dynamic Topic subscription, endpoint churn and node restart.
5. Test controlled subscription subsets, multi-topic loads and non-multicast/multi-hop topologies before proposing hybrid topology as primary. The current prototype is **not** HyParView or Plumtree reference code.
6. Keep original vendor/native baseline alongside proposed middleware as an ongoing regression check on the exact same physical and virtual host constraints.

## GitHub Actions evidence

- Vendor first boundary: https://github.com/nssang00/chatgpt-write-test/actions/runs/40849564087
- Candidate first boundary: https://github.com/nssang00/chatgpt-write-test/actions/runs/40849694380
- 40-node refinement + 30-node 10% loss repeats: https://github.com/nssang00/chatgpt-write-test/actions/runs/40850090668
- 38s publish fairness control: https://github.com/nssang00/chatgpt-write-test/actions/runs/40850290174
- 40-node repeatability and 10% loss gate: https://github.com/nssang00/chatgpt-write-test/actions/runs/40850623410

All workflow runs attach detailed per-node JSONs, aggregate CSV/JSON, and logs as downloadable artifacts. New benchmark source is under bench/discovery/vendor_probe_node.py and bench/discovery/vendor_threshold_run.py. No changes were made to the repository default branch.
