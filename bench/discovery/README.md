# NetNS discovery / presence-convergence feasibility benchmark

Experimental test for comparing:

- Custom Python UDP multicast bootstrap + bounded 4-neighbor digest/delta exchange + periodic repair (gossip).
- Native Zenoh 1.10.1 peer mode.
- Cyclone DDS Python 11.0.1 DataWriter/DataReader.

This is NOT an OMG compliance test or production HyParView/Plumtree/SWIM. The custom prototype contacts at most four randomly selected unicast gossip contacts per exchange but retains a list of all discovered node IDs; multicast HELLO runs every approximately 3 seconds. It does not test real topic payload reliability, QoS or multihop routing.

Each virtual host is a Linux network namespace with a veth attached to a shared bridge. A shared barrier coordinates cold middleware startup after Python imports. Each node learns all N distinct node IDs via actual Pub/Sub presence traffic (Zenoh, Cyclone), or multicast HELLO/indirect gossip (custom). A node converges when it knows N distinct IDs. This is NOT native discovery protocol completion. It measures time to full application-visible presence, not SPDP/SEDP latency.

Collected: all-nodes completion, slowest-node time, partial convergence, total Linux bridge-veth bytes/packets, per-node CPU and maximum RSS. Traffic includes repeating application presence packets, not solely discovery bytes. netem applies loss at both ends of each veth and 2ms per direction in lossy tests. This does not model real Wi-Fi interference, mobility, RF collisions or hardware differences.

GitHub-hosted runners have limited RAM; a conservative cgroup memory check explicitly marks large cases SKIP rather than causing OOM. Startup exceptions, timeouts and missing records are failures, not successful benchmarks. Research-quality results require several repeated trials, documented hardware, matching reliability semantics and native implementations for accurate overhead comparison.

Install Python 3.11 and Linux iproute2. Run:

    python -m pip install eclipse-zenoh==1.10.1 cyclonedds==11.0.1
    sudo -E "$(which python)" bench/discovery/run.py --sizes 10,30,100,200,300 --losses 0,10 --timeout 22

Artifacts: discovery-results/results.csv, results.json, per-node logs/JSON, and per-run summary.json.
