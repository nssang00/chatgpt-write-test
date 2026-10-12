# Cito

Cito is a lightweight typed messaging runtime focused on a very small application API and demand-oriented discovery.

## P0 API

```cpp
cito::Context ctx;

ctx.on<Position>([](const Position& p) {
    // use p
});

ctx.publish(Position{1.0, 2.0});
ctx.run();
```

Optional isolation and resource identifiers stay opt-in:

```cpp
cito::Context ctx("acme.robotics");
ctx.on<Position>("drone_17", handler);
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
- UDP network-namespace discovery/data smokes
- bounded selective-NACK reliability prototype
- 200-host demand-index structural scale gate
- stable C ABI v1 foundation
- Python binding over the C ABI
- optional MsQuic integration with real QUIC stream + DATAGRAM namespace smoke

The C ABI/Python binding currently expose the same-process raw `type_id + resource + bytes` common boundary. QUIC is validated as a real optional transport backend, but neither is yet fully wired into the normal distributed `Context` path. Those integrations remain part of the v1 completion gate rather than being represented as finished production support.

See `docs/V1_SCOPE.md` for the exact target and completion criteria.

## Build

```bash
cmake -S . -B build -G Ninja
cmake --build build
ctest --test-dir build --output-on-failure
```

See `docs/ARCHITECTURE_CONSTITUTION.md` for the current design rules.
