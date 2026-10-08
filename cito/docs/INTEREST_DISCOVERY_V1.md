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

`HostInterests` now maintains a monotonically increasing summary version and can produce a deterministic exact-key snapshot. A remote cache is identified by a summary stamp:

```text
CoordinatorId
incarnation
version
key_count
```

`incarnation` changes when a coordinator restarts, so a reset version number can never be mistaken for an already-applied old state. A peer pulls the exact snapshot only when this stamp represents newer or inconsistent state. Lower versions from the same incarnation are treated as stale and ignored. After a restart, recently retired incarnations are remembered in a small bounded cache so delayed UDP/gossip advertisements from the old process do not trigger repeated snapshot pulls. Exact hash sets are the v1 representation. Bloom/Cuckoo summaries remain optional future compression if measurement justifies them.

## Destination index

The prototype index maps:

```text
InterestKey -> set<DestinationId>
```

Cito now separates two indexes:

```text
RemoteDemandIndex
DemandKey -> candidate CoordinatorId set
        |
        | only for matching hosts
        v
direct route detail exchange
        |
        v
InterestIndex
DemandKey -> direct DestinationId set
```

A publisher therefore does not scan the full host list. Host summaries narrow discovery to candidate hosts, while the data hot path uses only direct destination entries. The coordinator remains control-plane-first and is not made a mandatory data relay.

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
- stale lower-version summary advertisements are ignored
- coordinator restart changes incarnation and triggers one new snapshot
- delayed retired-incarnation advertisements do not trigger pull storms
- exact host snapshots update an inverse DemandKey -> candidate-host index

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

## Versioned demand-control prototype

The second control-plane prototype now models the intended two-stage flow:

```text
CTS2 summary announcement
  CoordinatorId + control port + lease
  incarnation + version + key_count
        |
        | only when cached stamp is stale/new
        v
CTQ1 bounded snapshot request
        |
        v
CTB1 exact DemandKey batch (max 32 keys)
        |
        v
RemoteDemandIndex: DemandKey -> candidate hosts
        |
        | only for hosts matching the publish DemandKey
        v
CTR3 route request
  CoordinatorId + incarnation + DemandKey
        |
        v
CTR4 direct endpoint batch
  CoordinatorId + incarnation + endpoints
        |
        v
InterestIndex: DemandKey -> direct destinations
```

Snapshot batching is deliberately bounded so one control datagram and one event-loop callback cannot grow with the host's entire subscription set. The current batch cap is 32 exact DemandKeys and stays below a conservative UDP payload size.

The three-node network-namespace smoke proves that the publisher pulls both host summaries but requests route details only from the Position host. The unrelated Battery host reports zero route requests and receives no data.

Coordinator announcements are leased. Refresh replaces the existing expiration entry instead of adding timer backlog. When a coordinator restarts with a new incarnation, all old candidate-host state and direct routes owned by that coordinator are removed before new detail is accepted. Route request/response packets carry the incarnation, so a delayed response from the retired process cannot repopulate stale direct routes.

A second namespace smoke discovers a direct route, stops the coordinator announcements, waits past the lease, and requires the publisher's final direct-destination set to be empty.

## Legacy exact-key LAN advertisement prototype

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

This exact-key ADD/REMOVE packet remains as an early correctness baseline. The versioned summary/pull/route prototype above is now the preferred scalable direction; the exact-key path stays in regression tests until the newer path covers lifecycle and fault recovery equally well.

The first network smoke uses two different subscriptions and one publisher. The publisher must discover both interests but select only the destination whose exact `Scope + Resource + Type` matches the published data.

## Deferred

- production LAN advertisement transport policy (broadcast vs multicast vs future adaptive choice)
- startup/reconnect randomized jitter and rate limiting
- pending snapshot/route request timeout and retry policy
- multicast vs unicast discovery transport
- rendezvous/directory mode
- wildcard/pattern resources
- security/authentication of advertisements

Those will be added after the local model and wire/type rules are stable enough to justify inter-node transport tests.
