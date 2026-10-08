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

P0 is intentionally same-process only. It validates the public mental model and lifecycle before discovery or transport code is added.

Locally verified with:
- GCC 14.2
- Clang 17
- CMake 3.31
- CTest

## Build

```bash
cmake -S . -B build -G Ninja
cmake --build build
ctest --test-dir build --output-on-failure
```

See `docs/ARCHITECTURE_CONSTITUTION.md` for the current design rules.
