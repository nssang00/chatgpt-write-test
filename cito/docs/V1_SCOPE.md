# Cito v1 Scope

## Product target

Cito v1 targets deployments up to **200 hosts** while preserving the simple application model:

```cpp
cito::Context ctx;
ctx.on<Position>(handler);
ctx.publish(position);
ctx.run();
```

The v1 product scope includes:

- C++ typed API
- OMG IDL subset and generated direct codecs
- demand-indexed discovery
- same-host SHM
- LAN UDP BestEffort and bounded reliability
- stable C ABI
- Python binding
- QUIC secure remote transport
- Linux and Windows implementation compatibility

## Scale target

The architecture is designed around 200 hosts, not 200 Linux namespaces in CI.

Deterministic tests maintain at least 200 coordinator summaries and validate exact DemandKey-to-candidate-host lookup, replacement, and removal. Real namespace tests use smaller topologies for network correctness. Absolute p99/throughput claims require a later physical multi-machine lab.

## Language boundary

The stable cross-language boundary is the C ABI. C++, Python, and future language bindings must share the same Context semantics, type identity, discovery, wire format, and transports rather than implementing separate runtimes.

Current foundation:

- C ABI v1 opaque Context/Subscription handles
- explicit ownership and status codes
- raw `type_id + resource + bytes` publish/subscribe
- Python `ctypes` binding over that ABI

v1 completion requires the C ABI/Python Context to use the same distributed runtime underneath as C++ and a generated typed Python IDL path that produces/consumes the canonical Cito wire.

## QUIC policy

Transport choice stays internal.

```text
same process                 -> in-process
same host                    -> SHM
remote ordinary LAN          -> UDP
secure remote BestEffort     -> QUIC DATAGRAM
secure remote Reliable       -> QUIC stream
```

MsQuic is the first backend. A real Linux namespace smoke already validates one Cito packet over both a reliable stream and a QUIC DATAGRAM.

MsQuic callbacks are transport-completion callbacks only. Cito's mutable discovery/routing/runtime state remains owned by the Cito event loop.

v1 completion requires this backend to be selected through the normal distributed Context transport path rather than only through the standalone integration smoke.

## Definition of v1 complete

The release is not declared complete merely because the component prototypes exist. All of the following must be green:

- 200-host demand/index structural scale regression
- C++ local/SHM/UDP distributed Context flow
- C ABI using that same runtime
- Python using that same runtime
- generated Python IDL type round-trip compatible with generated C++
- BestEffort no-interest zero-work and encode-once invariants
- bounded reliable UDP recovery/failure tests
- QUIC DATAGRAM and stream selected through the runtime
- coordinator restart/lease/stale-route recovery
- Linux regression, sanitizer, SHM and namespace integration
- Windows build/runtime compatibility for C ABI and transport backends
- documentation of stable public API, ABI and wire-version policy

Performance claims additionally require measured p50/p95/p99 benchmarks. Structural tests alone are not marketed as production latency results.

## Current milestone

The first v1 foundation milestone is green:

- 200-host structural scale gate
- C ABI raw boundary and C smoke
- Python raw binding and smoke
- core regression + ASan/UBSan
- same-host SHM and three-node Linux namespace tests
- actual MsQuic stream and DATAGRAM namespace smoke

The next integration work is typed Python generation and attaching C ABI/Python/QUIC to the shared distributed Context/runtime path.
