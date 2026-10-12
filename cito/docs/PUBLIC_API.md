# Cito public API direction

Cito's public API expresses **user intent**, not transport machinery.

## Stable mental model

Data distribution uses **Publish/Subscribe**:

```cpp
cito::Context ctx("acme");

auto sub = ctx.subscribe<Position>(
    "drone_17",
    on_position);

ctx.publish(
    "drone_17",
    position);
```

One-shot command/query semantics use the **Request/Reply** pattern. The planned
public verbs are:

```text
request(...)   - send a typed request and await one typed reply
handle(...)    - register the handler for a typed request
```

The low-level act of replying to a specific request may use `reply()`, but
`reply()` is not the handler-registration verb.

## API vocabulary

Normal users should need only:

```text
Context

Publish/Subscribe
  publish
  subscribe

Request/Reply
  request
  handle

Lifecycle
  run
  stop/close
```

`subscribe()` registrations are owned by the `Context`: ignoring the returned
handle keeps the subscription active until Context shutdown. The returned
handle exists for explicit early `close()`.

`on()` remains a compatibility **scoped/RAII** helper with its original
lifetime semantics. New examples and tests use `subscribe()`.

## Progressive disclosure

Level 1:

```cpp
ctx.subscribe<Position>(handler);
ctx.publish(position);
```

Level 2 adds an opaque exact resource:

```cpp
ctx.subscribe<Position>("drone_17", handler);
ctx.publish("drone_17", position);
```

Level 3 may add reliability, timeout/deadline, metadata, or execution policy.

Users do not select SHM, UDP, QUIC, coordinator IDs, destination IDs, sockets,
event loops, or worker pools in the normal API.

## Runtime rule

For IDL-generated direct-codec types:

- same Context: object-native delivery, zero serialization;
- another Context in the same process: shared HostRuntimeCore demand lookup,
  encode once only when another app has demand;
- same host across processes: direct SHM data path (integration milestone);
- remote: UDP/QUIC chosen internally (integration milestone).

Handwritten C++ types without a direct static codec continue to work inside one
Context without forcing serialization.

## Request/Reply implementation sequence

Request/Reply is built on the same runtime, discovery, type identity and
transports as Publish/Subscribe. It does not introduce a second RPC runtime.

1. Define request/reply type metadata and correlation envelope.
2. Add a pending-request index keyed by RequestId on the single event loop.
3. Add handler demand keyed by scope + resource + request type.
4. Implement same-process `request()/handle()` first.
5. Add deadline, cancellation and status before remote public release.
6. Route same-host request/reply over the normal direct/SHM path.
7. Route remote reliable request/reply over QUIC stream by default.
8. Add generated convenience facades for gRPC/protobuf migration after the
   core intent API is stable.

## Required Request/Reply tests

The Request/Reply milestone is not complete until these cumulative gates pass:

- one request -> exactly one reply;
- no handler -> fail fast without request serialization when demand is absent;
- scope/resource mismatch -> no accidental handler selection;
- multiple handlers -> deterministic documented selection policy;
- timeout removes pending correlation state;
- cancellation removes pending state and late reply is ignored;
- handler error maps to typed status;
- requester destruction during an in-flight call is safe;
- handler destruction during dispatch is safe;
- same-process C++/C/Python use one runtime;
- C++ <-> Python generated request/reply wire is byte compatible;
- sanitizer regression is clean;
- namespace smoke verifies real remote selective routing before network
  Request/Reply is declared complete.

## Design constraint

Do not make `Channel`, `Topic`, `Client`, `Stub`, `DataReader`,
`DataWriter`, or a transport object mandatory for ordinary use. Convenience
facades may exist, but the core API remains intent-first.
