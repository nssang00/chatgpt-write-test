# Cito Interest Discovery v1 — Prototype Direction

## Goal

Find only destinations that expressed demand for the exact message identity instead of discovering every node/endpoint and matching afterward.

The useful analogy is a GIS route/index lookup: do not scan every possible destination on each publish. Maintain an index that lets the hot path ask only for destinations already associated with the requested demand key.

This is only an indexing analogy. Cito resources are not geographic or hierarchical.

## Prototype key

```text
ScopeId + ResourceId + TypeId
```

- `ScopeId`: communication isolation
- `ResourceId`: opaque logical resource identity; no hierarchy semantics
- `TypeId`: logical message type identity

The current prototype uses exact matching only.

## Host aggregation

Multiple local subscriptions on one host for the same key are aggregated into one outward host-level interest.

```text
local subscriber A --\
local subscriber B ----> one host interest
local subscriber C --/
```

Only the local count transition `0 -> 1` changes the outward demand summary, and only `1 -> 0` removes it. Duplicate local subscribers therefore cause no external summary churn.

`HostInterests` now maintains a monotonically increasing summary version and can produce a deterministic exact-key snapshot. The intended control protocol advertises the version cheaply; a peer pulls the exact snapshot only when its cached version differs. Exact hash sets are the v1 representation. Bloom/Cuckoo summaries remain optional future compression if measurement justifies them.

## Destination index

The prototype index maps:

```text
InterestKey -> set<DestinationId>
```

A publisher lookup does not expose or scan the full host list; it receives only the destination set stored for that demand key.

## Publish fast path

The routing prototype now enforces:

```text
lookup demand
   |
   +-- none --> return
   |            no encode
   |            no send
   |
   +-- destinations --> encode once
                        reuse payload
                        send only to matches
```

Current tests explicitly verify that no-interest delivery invokes the encoder zero times, and that three matching destinations invoke the encoder once and the send path three times.

## Current-session validation

The prototype tests cover:

- host-level duplicate subscription aggregation
- last-subscriber withdrawal
- duplicate advertisement idempotence
- scope isolation
- resource/type exact matching
- destination removal
- no-interest empty lookup
- no-interest zero-encode fast path
- encode-once fan-out
- unrelated-interest exclusion
- 10,000 virtual hosts / 40,000 interest edges scale smoke

The scale smoke intentionally makes no absolute latency/throughput claim. It validates bounded state shape and that the lookup API is demand-key based rather than total-node based.

## Discovery backend boundary

Cito does not make SWIM, multicast, rendezvous, or static peers part of the application-visible model. They are interchangeable ways to find or exchange host demand summaries.

The stable internal contract is:

```text
peer/address discovery
        +
versioned DemandKey summary
        |
        v
InterestIndex
```

A small LAN may use multicast/broadcast, a larger deployment may use sampled gossip or a directory, and a static deployment may inject peers. The application still uses the same `publish/on` API.

## LAN advertisement prototype

The existing first LAN control packet carries exact-key ADD/REMOVE records:

```text
ADD / REMOVE
DestinationId
data UDP port
lease duration
ScopeId
ResourceId
TypeId
```

Repeated ADD packets refresh the lease without duplicating the destination in the InterestIndex. REMOVE withdraws immediately, and expired leases remove stale destinations.

The advertisement deliberately does not carry the sender IP address. The UDP receive path learns the source address from the network packet itself, while the advertisement supplies the data port and demand identity.

This packet format is a transport/correctness prototype, not the final scalable control plane. The next protocol revision should carry host summary versions and pull/batch exact DemandKey snapshots rather than periodically broadcasting every unique key.

The first network smoke uses two different subscriptions and one publisher. The publisher must discover both interests but select only the destination whose exact `Scope + Resource + Type` matches the published data.

## Deferred

- production LAN advertisement transport policy (broadcast vs multicast vs future adaptive choice)
- startup/reconnect storm control
- startup/reconnect storm control
- multicast vs unicast discovery transport
- rendezvous/directory mode
- wildcard/pattern resources
- security/authentication of advertisements

Those will be added after the local model and wire/type rules are stable enough to justify inter-node transport tests.
