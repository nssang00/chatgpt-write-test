# POSIX UDP control manager

`PosixUdpControlManager` is the thin loop-owned socket adapter for Cito's
discovery/control plane on POSIX systems.

It does not implement discovery policy. Discovery matching, snapshot state,
route demand, restart handling, and lease semantics remain in
`DiscoveryControlCore` and `UdpRuntimeAdapter`.

The manager owns only:

- one nonblocking UDP control socket;
- bounded receive pumping per `poll()`;
- sending `UdpSend` actions returned by the runtime adapter;
- periodic CTS2 summary announcements to configured discovery targets;
- coordinator lease expiry polling;
- draining initial route requests queued by RequestSessionLifecycleCore.

The runtime path is:

```text
Context::request()
      |
RequestSessionLifecycleCore::ensure()
      |
UdpRuntimeAdapter::ensure_routes()
      |
desired handler capability
      |
POSIX UDP control socket
      |
CTS2 -> CTQ1 -> CTB1 -> CTR3 -> CTR5
      |
QUIC endpoint cache
      |
RequestSessionLifecycleCore::reconcile()
      |
MsQuicRequestSessionManager
      |
CTX1 Request/Reply
```

A request may be created before any remote coordinator is known. The desired
route is retained inside DiscoveryControlCore. When a later snapshot reveals a
matching handler coordinator, the CTR3 route request is emitted automatically;
application code does not call `ensure_routes()` a second time.

The manager is intentionally not part of the normal public API. It is a
platform I/O backend to be owned by the Cito event loop. A Windows backend can
provide the same role without changing discovery/runtime semantics.
