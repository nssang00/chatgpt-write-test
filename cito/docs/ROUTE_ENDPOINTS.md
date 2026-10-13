# Route endpoint transport metadata

Cito route discovery needs to advertise transport-specific listener ports
without exposing transport choice in the public Context API.

## CTR5

`RouteEndpoint` now contains:

```text
DestinationId destination
u16           data_port
u16           quic_port
```

CTR5 deliberately keeps the same 12-byte per-endpoint footprint as CTR4.
CTR4 encoded the last u16 as reserved zero; CTR5 uses that field for the QUIC
port.

```text
CTR4 endpoint: destination u64 + data_port u16 + reserved u16
CTR5 endpoint: destination u64 + data_port u16 + quic_port u16
```

New route batches are encoded as CTR5. The decoder accepts CTR4 and maps its
reserved field to `quic_port=0`. A route endpoint must advertise at least one
transport port.

This allows a destination to advertise:

- UDP only: `data_port != 0, quic_port = 0`
- QUIC only: `data_port = 0, quic_port != 0`
- both: both ports non-zero

No public user API changes.

## Discovery endpoint cache

UdpRuntimeAdapter remains the portable control-plane adapter that knows the
source IPv4 address of a route response. It now caches both:

```text
DestinationId -> IPv4 + data_port
DestinationId -> IPv4 + quic_port
```

The UDP publisher uses only the data endpoint. Request/Reply session lifecycle
uses only the QUIC endpoint. Route withdrawal, coordinator restart, and lease
expiry clear both caches through the same destination reference lifecycle.

## Request session lifecycle

`RequestSessionLifecycleCore` converts discovered handler routes into
transport-neutral session actions:

```text
desired RequestKey
  -> synthetic handler capability DemandKey
  -> remote DestinationIds
  -> discovered QUIC endpoints
  -> Connect / Disconnect actions
```

It tracks Connecting/Connected state and detects endpoint changes. It does not
own MsQuic objects or sockets. A concrete session manager executes these
actions and reports connection success/failure/disconnect back on the Cito
event-loop owner.

This keeps discovery/routing policy separate from the MsQuic callback model.
