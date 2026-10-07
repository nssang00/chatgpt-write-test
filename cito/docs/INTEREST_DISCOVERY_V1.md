# Cito Interest Discovery v1 — Prototype Direction

## Goal

Find only destinations that expressed demand for the exact message identity instead of discovering every node/endpoint and matching afterward.

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

Only the local count transition `0 -> 1` needs an outward advertisement, and only `1 -> 0` needs a withdrawal.

## Destination index

The prototype index maps:

```text
InterestKey -> set<DestinationId>
```

A publisher lookup does not expose or scan the full host list; it receives only the destination set stored for that demand key.

## Current-session validation

The prototype tests cover:

- host-level duplicate subscription aggregation
- last-subscriber withdrawal
- duplicate advertisement idempotence
- scope isolation
- resource/type exact matching
- destination removal
- no-interest empty lookup
- 10,000 virtual hosts / 40,000 interest edges scale smoke

The scale smoke intentionally makes no absolute latency/throughput claim. It validates bounded state shape and that the lookup API is demand-key based rather than total-node based.

## Deferred

- LAN advertisement protocol
- TTL/lease and stale destination cleanup
- startup/reconnect storm control
- multicast vs unicast discovery transport
- rendezvous/directory mode
- wildcard/pattern resources
- security/authentication of advertisements
- real network namespace integration

Those will be added after the local model and wire/type rules are stable enough to justify inter-node transport tests.
