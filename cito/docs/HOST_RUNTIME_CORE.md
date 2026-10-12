# Cito Host Runtime Core

`HostRuntimeCore` is the transport-independent state machine below application contexts.

It owns:

- local app registration
- per-app exact DemandKey interest counts
- host-level 0->1 / 1->0 demand aggregation
- exact local DemandKey routing
- remote summary tracking
- coordinator lease/restart cleanup
- coordinator-owned direct remote routes
- encode-once remote Cito data packet fan-out

It does **not** own sockets, network threads, or MsQuic callbacks. UDP, SHM coordination, and QUIC are adapters around this state machine.

The C ABI now uses this core even for its current same-process configuration. This removes a separate C/Python runtime model and gives the ABI the same demand/route foundation that network adapters will use.

## Publish fast path

```text
exact DemandKey lookup
      |
      +-- no local / no remote demand -> return
      |
      +-- local apps -> direct raw callback dispatch
      |
      +-- remote destinations
              |
              v
        encode CTD1 packet once
              |
              v
        fan out same packet
```

The C ABI additionally exposes `cito_context_has_demand()`. Generated Python calls this before encoding a typed object, so a no-interest typed Python publish performs zero canonical-wire serialization.

The current C ABI creates one host-runtime core per Context. Cross-process host aggregation and the actual UDP/QUIC adapter attachment remain the next integration step.
