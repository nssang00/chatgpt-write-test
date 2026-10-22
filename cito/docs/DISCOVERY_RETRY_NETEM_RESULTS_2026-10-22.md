# Cito UDP Discovery: impaired-network namespace test and bounded control retry

Date: 2026-10-22 UTC.
Linux: GitHub Actions Ubuntu 24.04, one host, separate Linux network namespace and veth pair per Cito process. Synthetic per-node shaping with tc netem on *both* egress directions, bridge, broadcast.

Source runs:
- [Unshaped namespace 400 nodes run 39802616753](https://github.com/nssang00/chatgpt-write-test/actions/runs/39802616753)
- [Original control implementation; 7 network profiles run 39802876082](https://github.com/nssang00/chatgpt-write-test/actions/runs/39802876082), source commit fce4c89390111703cbb3daf3cd8881e651080523
- [Bounded control retry, corrected request accounting, 6 profiles run 39804789819](https://github.com/nssang00/chatgpt-write-test/actions/runs/39804789819), source commit 992add42b50d097eccb06125fd5dba871fd23155

## Definition of PASS

Every run has 1 publisher, N-2 matching subscribers, 1 unrelated subscriber. PASS requires all N-2 remote routes be discovered, all N-2 one-shot DATA payloads be delivered, unrelated subscriber not route/receive data, and all processes exit successfully. Tested counts progress 3, 10, 30, ... and stop at first failed trial per profile. Each passing node count must pass twice consecutively. "Largest fully passing N" is a *tested lower bound*, not a true physical maximum.

## Measured results from GitHub job stdout

| Synthetic per-node profile | Original largest 2x PASS / first failure | Retry largest 2x PASS / first failure | Distinguishing observation |
|---|---|---|---|
| Unshaped baseline | 200 / none at 200 (separate unshaped 400 / none at 400) | 30 / none at 30 | Different upper bounds; no evidence of worse baseline scalability |
| 1 Mbps only | 100 / none at 100 | 30 / none at 30 | Both passed their entire tested sweep |
| 100ms one-way latency only | 100 / none at 100 | not retested | Isolate latency effect |
| 1% random loss only | 3 / 10 | 10 / 30 | At N=30 corrected retry found 28/28 routes, 27/28 data delivered, failed delivery gate |
| 1 Mbps, 50ms one-way latency, 1% random loss | 3 / 10 | 30 / none at 30 | At N=30 corrected retry both runs discovered 28/28 and delivered 28/28 |
| 256 kbps, 150ms one-way latency, 3% random loss | 3 / 10 | 10 / 30 | At N=30 corrected retry found 28/28 routes but delivered 25/28 data |
| 64 kbps, 300ms one-way latency, 5% random loss | 3 / 10 | 3 / 10 | At N=10 corrected retry found 8/8 routes, sent 8/8 but received 6/8 data |

### Specific important samples

- Original loss-only N10: all 8 routes were discovered in both repeats. Received 8/8 then 7/8; one-shot DATA loss explains failure despite successful Discovery.
- Original congested N10: first repeat discovered & delivered 8/8, second repeat discovered 7/8, never published due all-or-nothing gate. Latest corrected retry N10 passed both repeats with 8/8 received.
- Corrected retry congested N30: first run route_requests=53, 28/28 routes & delivery, publisher_elapsed=1118ms; second run route_requests=51, 28/28 routes & delivery, publisher_elapsed=732ms.
- Original degraded N10: 7/8 routes, 0 sent. Retry N10: 8/8 routes and 8/8 received both repeats.
- Original extreme N10: 7/8 routes, 0 sent; retry N10: 8/8 routes, 8 sent, 6 received. Recovered control discovery does not guarantee message delivery.

### Implementation and validation

Experimental change to DiscoveryControlCore::on_summary: after ~500ms, reissue unresolved pending snapshot requests; when announcement stamp is unchanged, retry route requests for desired candidates whose remote routes remain absent. Clear retry bookkeeping on restart and expiration. The dedup logic remains for already discovered routes. New deterministic dropped-snapshot/route-reply smoke test plus old discovery control tests were compiled and passed on Linux Actions. Separate runtime and offline Python tests passed. Do not merge directly to shipping code without full regression and lifecycle/long duration testing.

IMPORTANT gate adjustment: corrected retry CI permits **route_requests >= expected**, as retransmissions increase total requests, but still requires discovered==expected and actual received==expected. Earlier retry Actions run 39804396312 used exact request-count matching and may label successful discovery as failure. Only run 39804789819 is cited for comparative results.

### Limitations and interpretation

- 2 repetitions do not establish a high statistical confidence rate; these are concrete observed results, not inferred reliability.
- tc netem was attached to each namespace eth0 and host veth egress; configured nominal rate limits apply per node and its incoming traffic, not a shared 802.11 RF channel or actual packet airtime.
- Linux bridge broadcast replication, qdisc drops, kernel timing, scheduling, and packet sizes influence observed results. Raw tc -s qdisc counters, per-node stdout, and CSV/JSON are uploaded as run artifacts.
- Publisher's data transmission is a one-shot UDP send. There is no application-level ACK/retry. One missing DATA packet must not be described as an incomplete Discovery.
- Discovery announcement interval approximately 150ms; lease 600ms in runtime node. High delay/jitter can interact with expiration; no production real wireless hardware was tested.
- Control recovery improves route convergence in sampled loss conditions. Need independent delivery retries, ACK or reliable transport, longer repeated runs, and full v25/v26 integrated CI before shipping.

## Reproduce

On privileged Linux Ubuntu 24.04 with iproute2, tc netem, C++20 and Ninja:

    python3 -m unittest discover -s cito/tools/tests -p test_discovery_scale.py -v
    cmake -S cito -B build-scale -G Ninja -DCMAKE_BUILD_TYPE=Release
    cmake --build build-scale --target cito_runtime_udp_node -j2
    c++ -std=c++20 -O2 -I cito/include cito/tests/discovery_retransmit_test.cpp -o build-scale/discovery_retransmit_test
    ./build-scale/discovery_retransmit_test
    python3 cito/tools/discovery_scale.py --binary build-scale/cito_runtime_udp_node --profile congested --counts 3,10,30 --repeats 2 --timeout 65 --lifetime-ms 45000 --output retry-results

Raw logs and artifact ZIPs: open the linked Actions runs, find the job labeled with its profile and download "cito-netem-<profile>" or "cito-discovery-retry-<profile>" artifact.
