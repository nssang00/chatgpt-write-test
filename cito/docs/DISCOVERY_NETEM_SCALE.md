# Cito Discovery: namespace network impairment experiment

The script runs real UDP between Linux network namespaces and a bridge on one
kernel. Linux tc netem is attached to both source namespace eth0 egress and
destination host-side veth egress. This limits per-node outgoing traffic and
aggregated incoming traffic; it is not shared Wi-Fi airtime or actual drones.

The network profiles below are synthetic test parameters, not measurements:

| Profile | Rate | One-way delay | One-way random loss |
| --- | --- | --- | --- |
| baseline | unlimited | 0 | 0 |
| lan | 100 Mbit/s | 1 ms | 0 |
| wifi | 10 Mbit/s | 10 ms | 0.1% |
| bandwidth_1m | 1 Mbit/s | 0 | 0 |
| latency_100ms | unlimited | 100 ms | 0 |
| loss_1pct | unlimited | 0 | 1% |
| congested | 1 Mbit/s | 50 ms | 1% |
| degraded | 256 kbit/s | 150 ms | 3% |
| extreme | 64 kbit/s | 300 ms | 5% |

Delay is split across two egress queues; per-hop random loss is calculated as
1 - sqrt(1 - total_loss). Actual rate, loss and delay are subject to Linux
timer granularity, bridge replication, packet size, and queue capacity (200
packets by default).

Important: current Cito announcements recur at ~150 ms and use a 600 ms lease.
Severe delays can cause expiry. Publisher sends application data once, with no
application ACK or retry; a missing payload does not by itself prove discovery
failure. Record peak_discovered and discovery_route_rate separately from
received and delivery_success_rate. Successful publish() is not receive ACK.

Requires privileged Linux with sudo, CAP_NET_ADMIN, iproute2/netem, CMake,
Ninja, Python 3.10+, C++20. Run:

    python3 -m unittest discover -s cito/tools/tests -p test_discovery_scale.py -v
    cmake -S cito -B build-scale -G Ninja -DCMAKE_BUILD_TYPE=Release
    cmake --build build-scale --target cito_runtime_udp_node -j2
    python3 cito/tools/discovery_scale.py --binary build-scale/cito_runtime_udp_node --profile congested --counts 3,10,30,50 --repeats 3 --timeout 65 --lifetime-ms 45000 --output discovery-netem-results

Profiles and raw tc -s qdisc show outputs are saved with per-node stdout, JSON
and CSV. Netem qdisc presence is checked on each veth before launching nodes.
A setup error must not be reported as a Cito throughput ceiling.
Last fully passing node count is a tested lower bound, not a maximum.

GitHub Actions BuildFailed/startup_failure/jobs=0 indicates runner never ran.
Do not report a namespace PASS or FAIL until a runner produced evidence.
