# Cito Architecture Constitution v1.0 (Draft)

## Product goal

Cito is a lightweight typed messaging runtime that lets applications publish and receive data without requiring users to manage peers, ports, transport selection, discovery machinery, or serialization calls.

## Non-negotiable principles

1. **Simple first. Powerful when needed. Complexity stays optional.**
2. The default mental model is `Context + publish + on + run`.
3. Advanced features extend the same model; they do not create a second programming model.
4. Scale changes runtime internals, not application API.
5. Discover demand, not every node or endpoint.
6. Do no unnecessary work: no interested destination means no serialization, buffer allocation, or network send.
7. Users do not pay runtime cost for features they do not use.
8. All queues, histories, retries, and shared resources are bounded.
9. Transport semantics are uniform while mechanisms remain free to specialize: local/SHM, UDP, QUIC, or future transports.
10. A failed or slow application must not stop unrelated applications.
11. C++ is the initial core implementation language; cross-language boundaries use a stable C ABI.
12. Gateway/integration layers (DDS, ROS 2, MAVLink, legacy protocols) stay outside the native core.
13. Current-session/local verification comes first. GitHub Actions is used when independent network nodes, OS-specific behavior, or unavailable environments are required.
14. Every development phase requires unit tests, cumulative regression tests, and a minimal smoke test before it is considered complete.

## Public API baseline

```cpp
cito::Context ctx;
ctx.on<Position>(handler);
ctx.publish(Position{...});
ctx.run();
```

Optional isolation:

```cpp
cito::Context ctx("acme.robotics");
```

Optional opaque resource identifier:

```cpp
ctx.on<Position>("drone_17", handler);
ctx.publish("drone_17", Position{...});
```

`Resource` is an opaque UTF-8 identifier in v1. Cito assigns no hierarchy or REST-style semantics to its contents.

## Type direction

- Primary definition path: small OMG IDL data-type subset.
- Stable field IDs and compatible evolution are required design properties.
- Generated/static types are the normal fast path.
- `TypeBuilder` and `DynamicData` are optional expert/tooling/simulation APIs over the same canonical type model and wire semantics.
- Built-in text/bytes messages remain available for simple tools and simulation.
- Wire format must support evolution without transmitting field names on every message.

## Testing hierarchy

1. Current session: algorithms, codec/type logic, unit tests, regression tests, same-process smoke tests, simulations, sanitizers, and benchmarks where possible.
2. Same-host SHM: multiple real OS processes on one host/runner.
3. Independent Linux network nodes: Linux network namespaces + veth + bridge on one GitHub Actions Ubuntu runner.
4. Network fault testing: namespace-local `tc/netem` for loss, delay, reordering, link down/up, and recovery.
5. Windows Actions only for Windows-specific implementation and cross-platform compatibility.
6. Physical multi-machine tests are reserved for later real-network performance validation.

Detailed test gates are defined in `TESTING.md`.
