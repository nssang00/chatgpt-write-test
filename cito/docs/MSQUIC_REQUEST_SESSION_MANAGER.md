# MsQuic Request/Reply session manager

`MsQuicRequestSessionManager` is the concrete reliable-session attachment for
Cito Request/Reply.

It is an optional internal transport library. Normal application code still
uses only:

```cpp
ctx.handle<GetStatus>(resource, handler);
auto result = co_await ctx.request(resource, GetStatus{...});
```

The manager does not add a public Channel, Client, Stub, or transport object to
the Context API.

## Ownership

MsQuic callbacks do not mutate HostRuntimeCore, RequestReplyCore,
RequestNetworkAdapter, or discovery state directly.

Callbacks copy transport events/bytes into a queue. The Cito loop owner calls:

```cpp
manager.poll();
manager.reconcile();
```

and all request/discovery/session attachment state changes happen there.

Send-buffer completion and handle-local shutdown bookkeeping remain inside the
MsQuic callback layer because they do not own Cito routing/discovery state.

## Client lifecycle

`RequestSessionLifecycleCore` already turns discovered handler routes into:

```text
Connect(DestinationId, IPv4:QUIC-port)
Disconnect(DestinationId)
```

The concrete manager now executes those actions:

```text
handler capability route
        |
QUIC endpoint cache
        |
RequestSessionLifecycleCore
        |
MsQuic ConnectionStart
        |
CONNECTED callback -> loop queue
        |
RequestNetworkAdapter.attach_session()
        |
Context::request() -> CTX1 -> QUIC stream
```

Unexpected session loss detaches the destination and completes pending remote
requests as `Unavailable`. The lifecycle returns to a reconnectable state.

## Server lifecycle

The manager can also listen for incoming request streams. Each accepted
connection receives an internal peer/session id. Incoming CTX1 frames are
posted to the loop and delivered through the existing RequestNetworkAdapter.

A request reply is sent on the same bidirectional stream. Cancel is allowed on
a separate stream; it removes the original peer+RequestId correlation and
gracefully closes the retained request stream so a late handler reply cannot
revive it.

## Public Context network smoke

The MsQuic CI now has a third real two-node namespace smoke:

```text
client process
  Context::request()
        |
  RequestNetworkAdapter
        |
  MsQuicRequestSessionManager
        |
     QUIC
        |
server process
  MsQuicRequestSessionManager
        |
  RequestNetworkAdapter
        |
  Context::handle()
```

The client route is learned through the normal DiscoveryControlCore /
UdpRuntimeAdapter control messages, including CTR5 QUIC endpoint metadata.
The manager then creates the session and attaches it to the same process
runtime used by Context.

This closes the previous gap between the in-memory public Context remote bridge
and the standalone QUIC request/reply smoke.

## Lazy first request and deadlines

A client manager installs a readiness-wait hook into RequestNetworkAdapter.
This lets `Context::request()` arrive before route discovery or QUIC session
establishment has completed.

The request value is retained without serialization. `poll()` advances both
MsQuic completions and pending-request deadlines. Once a matching session is
attached, RequestNetworkAdapter invokes the lazy encoder exactly once and sends
the CTX1 request.

A timeout before readiness returns `DeadlineExceeded` with encode count zero.
A timeout after send completes the local correlation as
`DeadlineExceeded` and sends CTX1 Cancel best-effort.

The real namespace smoke now begins `Context::request()` before the route and
session exist, then learns the CTR5 route, connects, and completes with the
remote typed reply.

## Current boundary

The smoke still drives `poll()/reconcile()` explicitly. The next runtime
milestone is to make the normal Cito event loop own those calls and to connect
the UDP discovery control plane itself to that loop, so application code does
not manually drive route/session progress.


## Real UDP discovery control-plane smoke

The public two-node QUIC smoke no longer seeds the route inside the client
process. The provider advertises its live handler demand through a real UDP
control socket. The requester has already issued `Context::request()`, so the
handler capability is desired before discovery completes.

The namespace test performs the actual control exchange:

```text
provider CTS2 announcement
requester CTQ1 snapshot request
provider CTB1 snapshot batch
requester CTR3 route request
provider CTR5 QUIC endpoint
```

Only after CTR5 is received does RequestSessionLifecycleCore emit Connect and
the MsQuic manager attach a reliable session. The retained typed request then
encodes once and is sent.

This validates one real path from pre-discovery public request through UDP
control discovery and QUIC Request/Reply data transport.
