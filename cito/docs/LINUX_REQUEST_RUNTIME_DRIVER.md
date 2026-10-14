# Linux Request/Reply runtime driver

`LinuxRequestRuntimeDriver` is the first concrete owner for Cito's
single-threaded distributed Request/Reply loop.

It composes existing modules rather than duplicating their policy:

```text
Context::run()
    |
EmbeddedHostRuntime::RuntimeDriver
    |
LinuxRequestRuntimeDriver
    |
    +-- PosixUdpControlManager
    |      CTS2 / CTQ1 / CTB1 / CTR3 / CTR5
    |
    +-- RequestSessionLifecycleCore
    |      Connect / Disconnect
    |
    +-- MsQuicRequestSessionManager
    |      CTX1 streams
    |
    +-- RequestNetworkAdapter
           lazy encode + deadlines
```

## Blocking model

The driver does not use a fixed 1 ms sleep loop.

It waits on:

- the UDP discovery/control socket;
- a nonblocking wake pipe signaled by MsQuic callbacks;
- the nearest request deadline;
- the next summary-announcement deadline;
- a bounded 50 ms maintenance ceiling for coordinator lease expiry.

UDP readability and QUIC completions therefore wake the owner loop immediately.
Request deadlines and announcements set the blocking timeout. The maintenance
ceiling only bounds cleanup latency; it is not used as the data-path polling
interval.

## Public lifecycle

`Context::run()` now delegates to the process-level embedded runtime driver
when one is installed. `Context::stop()` requests termination and wakes the
blocked loop.

If no distributed runtime driver is installed, `Context::run()` preserves the
previous local behavior and returns immediately. This keeps embedded/local
tests compatible while the platform bootstrap layer is still being completed.

The runtime permits one installed driver and the Linux driver itself rejects
concurrent `run()` ownership.

## Current integration boundary

The driver is still installed by the internal Linux platform bootstrap in the
network smoke. Application code no longer calls UDP or QUIC `poll()` /
`reconcile()` itself, but automatic platform/bootstrap configuration is not
yet exposed as a stable public API.

The next step is to define internal default/bootstrap configuration and then
mirror the driver contract on Windows without changing `Context`,
`publish/subscribe`, or `request/handle`.
