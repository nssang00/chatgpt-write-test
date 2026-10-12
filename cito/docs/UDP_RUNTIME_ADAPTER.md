# Cito UDP Runtime Adapter

`UdpRuntimeAdapter` is a portable datagram adapter around `DiscoveryControlCore` and `HostRuntimeCore`.

It intentionally contains no POSIX or Winsock types. An endpoint is currently an internal IPv4 value plus port:

```text
UdpEndpoint { ipv4, port }
```

The OS socket layer only converts between this endpoint and `sockaddr` / Winsock structures.

The adapter owns UDP-specific address caches:

- CoordinatorId -> control endpoint
- DestinationId -> data endpoint
- coordinator + DemandKey -> endpoint-route references

Discovery decisions remain in `DiscoveryControlCore`.

## Control receive

```text
UDP datagram
   |
   +-- CTS2 -> observe summary, remember control address, maybe CTQ1
   +-- CTQ1 -> local snapshot -> CTB1 reply
   +-- CTB1 -> apply remote demand, maybe CTR3
   +-- CTR3 -> local demand check -> CTR4 reply
   +-- CTR4 -> apply direct routes + data endpoint addresses
```

Restart and lease expiry clear coordinator-owned address state. Route replacement uses destination reference counts so old endpoint entries are reclaimed.

## Data path

For outbound data, `HostRuntimeCore` checks exact remote destinations first. If none exist, there is no CTD1 framing and no UDP send. If destinations exist, CTD1 is encoded once and the adapter invokes the socket-send callback with the same non-owning packet span for each destination. The production path therefore does not build one payload vector per destination.

Inbound CTD1 uses `DataPacketView` and then local exact DemandKey delivery; the payload is not copied by the packet decoder.

The in-memory three-host smoke models Position, Battery, and Publisher adapters and proves that Position route detail/data reaches only the Position host.
