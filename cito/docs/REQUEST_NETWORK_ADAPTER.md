# Request network adapter

RequestNetworkAdapter is the loop-owned bridge between public typed
Request/Reply and concrete reliable sessions.

It owns no sockets. Instead it maps a discovered DestinationId to a session
send callback:

```text
RequestKey
   |
handler capability route
   |
smallest ready DestinationId
   |
RequestTransportCore / CTX1
   |
attached reliable session
```

The concrete QUIC session manager will attach and detach these callbacks.

## Fast path

Public C++ `Context::request()` now follows this order:

```text
exact local handler?
  yes -> same-process RequestReplyCore

no local handler
  |
ready remote handler route + attached session?
  no  -> Unavailable, request encode = 0
  yes -> encode once -> CTX1 -> session
```

A same-process handler always wins over a remote route.

This keeps the existing no-interest/no-ready-receiver rule: a typed request is
not serialized merely because a stale or unusable route exists.

## Session lifecycle

The adapter records requester AppId and DestinationId for each outbound
correlation.

- explicit request cancellation emits CTX1 Cancel when the session is present;
- Context destruction cancels only that AppId's remote requests;
- destination/session loss completes its outbound requests as Unavailable;
- server-side peer loss drops `peer/session + RequestId` inbound correlation;
- late handler replies after cancel or peer loss are rejected.

The adapter is intentionally not internally synchronized. It is designed to be
advanced by Cito's single event-loop owner. Transport callbacks must post work
to that loop before calling it.

## Current integration boundary

The C++ public Context is connected to this bridge. Tests wire two
EmbeddedHostRuntime instances with an in-memory reliable session to prove the
full public API path, including local-first selection, encode-zero misses,
remote cancellation, Context teardown, and reuse of the process-level runtime.

Automatic discovery/session creation and the C/Python public remote path remain
later milestones. The existing real MsQuic CTX1 smoke validates the concrete
network transport separately.
