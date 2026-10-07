# Cito Network Testing Strategy

## Rule

Use the cheapest and most faithful environment for each class of failure. GitHub Actions is not the default test environment; it is used when the behavior requires independent network nodes, another OS, or network fault injection that is not meaningful in the current development session.

## 1. Current-session / local verification first

Use the current development environment for:

- type and schema rules
- codec and wire compatibility
- discovery/interest algorithms in simulation
- same-process `Context` behavior
- fuzz-like malformed input tests
- sanitizers
- microbenchmarks that do not require independent hosts

## 2. Same-host SHM

When SHM is introduced, run multiple real OS processes on one runner/host. Do not use network namespaces to model SHM peers: Cito's SHM contract is explicitly same-host, cross-process communication.

## 3. Independent Linux network nodes

For UDP discovery, interest propagation, destination selection, join/leave, and recovery tests, use Linux network namespaces on one GitHub Actions Ubuntu runner.

Recommended topology:

```text
GitHub Actions Ubuntu VM
        |
     br-cito
   /    |     \
ns-a   ns-b   ns-c
 |      |      |
IP A   IP B   IP C
```

Each namespace gets its own veth interface, IP address, routing table, socket namespace, and loopback device. Cito test nodes are executed with `ip netns exec`.

Start with 3-node correctness tests, then increase to roughly 10 and 30 nodes for regression coverage. Large-scale algorithmic tests remain in-process simulations rather than thousands of namespaces.

## 4. Fault injection

When reliability/recovery exists, apply `tc/netem` inside selected namespaces to test packet loss, latency, reordering, bandwidth limits, link down/up, and network partition/recovery.

These are correctness/regression tests, not absolute performance benchmarks.

## 5. What network namespaces do not prove

A single Actions VM does not reproduce physical NICs, switches, DMA/hardware queues, IGMP snooping, independent-host CPU scheduling, real LAN congestion, or real WAN jitter. Do not use namespace tests to claim production throughput or latency.

## 6. Windows

Use Windows GitHub Actions only for Windows-specific behavior and cross-platform compatibility, especially Windows SHM and socket/backend differences.

## Promotion rule

A feature reaches GitHub Actions only after its algorithmic/unit behavior is tested locally where possible. Network Actions are added when the feature first requires independent network namespaces; Windows Actions are added when the feature first has Windows-specific implementation or wire-compatibility risk.
