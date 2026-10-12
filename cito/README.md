# Cito

Cito is a lightweight typed messaging runtime focused on a very small application API and demand-oriented discovery.

## P0 API

```cpp
cito::Context ctx;

ctx.subscribe<Position>([](const Position& p) {
    // use p
});

ctx.publish(Position{1.0, 2.0});
ctx.run();
```

Optional isolation and resource identifiers stay opt-in:

```cpp
cito::Context ctx("acme.robotics");
ctx.subscribe<Position>("drone_17", handler);
ctx.publish("drone_17", position);
```

In v1, a resource is an opaque UTF-8 identifier. Cito does not assign REST-style path or hierarchy semantics to it.

## Testing contract

Every development phase must pass:

- unit tests
- cumulative regression tests
- a minimal smoke test

before the phase is considered complete.

Run:

```bash
ctest --test-dir build -L unit --output-on-failure
ctest --test-dir build -L smoke --output-on-failure
ctest --test-dir build -L regression --output-on-failure
```

See `docs/TESTING.md` for the local-first and GitHub Actions test policy.

## Current status

The project has moved beyond the original same-process P0:

- exact Type+Resource local dispatch
- OMG IDL subset + generated direct static codec
- DynamicData/reference wire interoperability
- demand-summary discovery and direct route selection
- same-host multi-process SHM smoke
- shared `HostRuntimeCore` + transport-independent discovery control core
- portable UDP runtime adapter with actual three-node network-namespace selective delivery
- coordinator lease expiry removes candidate routes and UDP endpoint cache state
- bounded selective-NACK reliability prototype
- 200-host demand-index structural scale gate
- stable C ABI v1 foundation
- generated typed Python IDL with byte-for-byte C++ wire compatibility
- simple Python `ctx.on(Position, ...)` / `ctx.publish(Position(...))`
- no-interest typed Python publish performs zero serialization
- multiple C/Python Contexts in one process aggregate onto one embedded host runtime
- optional MsQuic integration with real QUIC stream + DATAGRAM namespace smoke

The shared discovery/runtime and UDP data path are now reusable library components rather than test-node-only logic. C/Python use that host runtime inside one process. The remaining integration work is to move the registry into one compiled shared runtime across C++/C ABI/Python/DSO boundaries, extend host aggregation across processes with local IPC, and attach UDP/QUIC/SHM underneath the normal public `Context` lifecycle.

See `docs/V1_SCOPE.md` for the exact target and completion criteria.

## Build

```bash
cmake -S . -B build -G Ninja
cmake --build build
ctest --test-dir build --output-on-failure
```

See `docs/ARCHITECTURE_CONSTITUTION.md` for the current design rules.


## Public API vocabulary

Cito is intent-first: **Publish/Subscribe** for typed data distribution and
**Request/Reply** for one-shot command/query semantics. New code uses
`publish()` / `subscribe()`; `on()` remains a compatibility alias.
The planned Request/Reply verbs are `request()` / `handle()`.

See `docs/PUBLIC_API.md`.
