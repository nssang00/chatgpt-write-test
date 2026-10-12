# Cito Discovery Control Core

`DiscoveryControlCore` is the transport-independent control-plane state machine layered on `HostRuntimeCore`.

It owns protocol decisions but no sockets:

- leased coordinator announcement observation
- snapshot pull de-duplication
- bounded snapshot continuation
- exact remote DemandKey candidate application
- publish-side desired route tracking
- route-detail requests only to exact candidate hosts
- direct-route removal when a new summary withdraws a DemandKey
- stale/restarted incarnation rejection
- lease-expiry control-state cleanup

The output of the state machine is a small `ControlAction`:

```text
target = Source | Coordinator
bytes  = encoded CTS/CTQ/CTB/CTR packet
```

A UDP adapter maps `CoordinatorId` to a UDP address and sends the bytes. A QUIC adapter maps the same action to a QUIC peer/session. Neither adapter reimplements discovery decisions.

## Publisher flow

```text
summary announcement
      |
      v
snapshot pull
      |
      v
DemandKey -> candidate host index

app publishes/warms key
      |
      v
ensure_routes(DemandKey)
      |
      +-- unrelated hosts: no request
      |
      v
candidate hosts only
      |
      v
route request -> direct endpoint batch
```

Route requests are cached per coordinator, DemandKey and incarnation. Repeated `ensure_routes()` creates no control churn.

A newer snapshot that no longer contains a previously requested DemandKey removes the old direct route immediately. A delayed route response cannot restore it because the coordinator must still be a current candidate for the desired key.

The first smoke models Position and Battery on separate hosts and verifies that publishing Position requests route detail from the Position host only.
