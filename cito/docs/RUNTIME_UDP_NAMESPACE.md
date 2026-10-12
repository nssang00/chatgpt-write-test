# Cito Runtime UDP Namespace Smoke

The Linux namespace integration now has a thin socket node built on the reusable runtime layers:

```text
recvfrom / sendto
       |
UdpRuntimeAdapter
       |
DiscoveryControlCore
       |
HostRuntimeCore
```

The node itself performs no discovery matching or route-selection logic.

The three-node topology is:

```text
publisher      Position subscriber      Battery subscriber
10.201.0.11    10.201.0.12             10.201.0.13
     |               |                       |
     +--------------- br-cito ---------------+
```

The publisher declares a desired Position route before discovery completes. As versioned summaries arrive, the runtime pulls both exact snapshots but emits route-detail traffic only to the Position host. Once the route is ready, the same CTD1 buffer is passed directly to `sendto`.

Assertions:

- two summary snapshot requests
- exactly one route request
- Position subscriber receives one data sample
- Battery subscriber receives zero route requests and zero data
- no application-level endpoint scan

The older standalone summary node remains temporarily for the coordinator lease-expiry regression until that scenario is migrated to the reusable adapter as well.
