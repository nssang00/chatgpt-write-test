# Request/Reply core

Cito Request/Reply uses the same process runtime and AppId space as typed
Publish/Subscribe. It is not a second RPC runtime.

The transport-independent core currently fixes these semantics:

- handler lookup key is `ScopeId + ResourceId + RequestTypeId`;
- one request dispatches to exactly one handler;
- v1 local selection is deterministic: first registered handler wins;
- every dispatched request gets a monotonically increasing `RequestId`;
- pending completions are indexed directly by `RequestId`;
- cancellation removes pending state before reporting `Cancelled`;
- late replies after cancellation or requester destruction are ignored;
- synchronous handler exceptions map to `Internal`;
- removing a handler app completes its in-flight requests as `Unavailable`;
- removing a requester app drops its pending callbacks without touching dead
  requester state.

The core accepts byte spans and does not own discovery, transport, IDL codecs,
or language bindings. Public `request()/handle()` will perform demand lookup
before request serialization so the no-handler fast path can remain
encode-zero/send-zero.

Future milestones attach:

1. generated request -> reply type metadata;
2. C++ public `request()/handle()`;
3. C ABI and Python;
4. deadline timer integration on the single event loop;
5. same-host SHM and remote QUIC request/reply envelopes;
6. handler selection policies beyond the documented deterministic v1 rule.


## Handler capability demand

Request/Reply handler availability is advertised through the existing
three-part demand index without confusing it with ordinary Pub/Sub demand.

For a request `TypeId`, Cito derives a deterministic internal capability
TypeId tagged as `cito.request.handler.v1` and advertises:

```text
ScopeId + ResourceId + request_handler_capability_type(RequestTypeId)
```

The public `DemandKey` / `InterestKey` shape stays unchanged. A normal
subscriber to `GetStatus` therefore cannot be mistaken for a
`GetStatus` Request/Reply handler.

Handler registration adds this capability interest; explicit handler close or
Context destruction removes it. Existing snapshot, candidate-host, route,
lease and restart machinery can therefore discover handler hosts without a
second RPC discovery subsystem.
