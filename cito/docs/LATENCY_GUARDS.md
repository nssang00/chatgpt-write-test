# Cito Latency Guards

## Goal

Cito performance work starts by removing avoidable work from the path, not by adding more threads or platform-specific syscall tricks.

Absolute latency numbers are environment dependent. This document defines structural invariants that can be tested deterministically and that must remain true as the runtime evolves.

## Main latency sources and Cito responses

### 1. Broad discovery and endpoint exchange

Risk:

- every application participates in global discovery
- every publisher scans or matches against unrelated endpoints
- join/restart storms create control-plane spikes

Guard:

- aggregate local subscriptions at host/coordinator level
- outward identity is an exact DemandKey: `ScopeId + ResourceId + TypeId`
- local duplicate subscriptions do not change the outward summary
- the host summary version changes only on unique DemandKey `0 -> 1` and `1 -> 0` transitions
- discovery backends are replaceable; SWIM, LAN multicast, rendezvous, and static peers are mechanisms, not the Cito programming model
- lower-version advertisements from the same coordinator incarnation are ignored instead of triggering snapshot pulls
- recently retired coordinator incarnations are suppressed so delayed packets cannot create pull storms
- exact remote snapshots maintain an inverse DemandKey -> candidate-host index; publish does not scan all known hosts
- coordinator leases are expiration-indexed; one refresh replaces one timer entry
- restart/expiry removes all candidate and direct-route state owned by that coordinator
- route detail is incarnation-bound; delayed old route responses cannot restore stale destinations

### 2. Mandatory data relay through a host agent

Risk:

```text
publisher -> network -> agent -> local queue -> subscriber
```

adds scheduling, queueing, copies, and a central bottleneck.

Guard:

- the Host Coordinator is control-plane-first
- normal data delivery remains direct when possible
- same-host delivery is intended to use direct SHM
- remote host-ingress fan-out may be added later as an optimization when many local readers justify one remote receive, but it is not a required hop

### 3. Work when nobody is interested

Risk:

serialization, allocation, and socket work before discovering that no destination exists.

Guard:

```text
DemandIndex lookup
    |
    +-- empty -> return
    |
    +-- matches -> encode
```

The regression suite asserts zero encoder calls and zero sends on a no-demand publish.

### 4. Re-encoding for fan-out

Risk:

N subscribers cause N serializations.

Guard:

- same-process object-native delivery does not invoke the wire encoder
- one required wire representation is encoded lazily only when a SHM/UDP destination exists
- the same encoded payload object is reused across matching SHM and UDP destinations
- multiple representations are allowed only when transports/compatibility actually require them, and each representation is generated at most once per publish

### 5. Full lease-table scans on timers

Risk:

a periodic timer scans every remote lease, creating event-loop latency spikes proportional to all known interests.

Guard:

- lease expiration is indexed by expiration time
- refresh replaces the previous scheduled expiry
- one live lease has one scheduled expiry entry
- `expire(now)` processes only entries that are due

### 6. Recursive serialization temporary buffers

Risk:

nested structs and container elements allocate temporary byte vectors and copy them into parent buffers.

Guard:

- complex wire encoding writes recursively into one output vector
- field/element lengths are reserved then back-patched
- nested decode uses a non-owning byte span instead of copying a slice

### 7. Transport packet payload copies

Risk:

packet framing decode copies the payload before the type decoder can use it.

Guard:

- the data packet layer exposes `DataPacketView`
- the view aliases the received byte buffer
- an owning `DataPacket` decoder remains only as a convenience API

### 8. Same-host broker/reader coupling

Risk:

same-host messages still pass through a coordinator process, or a shared-memory writer waits for slow/dead readers through shared refcounts/cursors.

Guard:

- same-host data path uses a publisher-owned bounded ring
- subscribers map the ring read-only
- subscriber cursors remain process-local
- writer does not inspect or wait for reader progress
- overwritten data is reported as reader-local drops
- no global SHM allocator, shared reference count, or reader mutex is introduced

### 9. Too many runtime threads and shared-state locks

Risk:

thread wakeups, context switches, cache-line bouncing, and mutex contention increase p99 latency.

Guard:

- one event-loop thread owns mutable discovery/route/transport state
- worker threads are lazy and bounded
- workers perform isolated heavy/blocking work and post completion back
- adding a dedicated subsystem thread requires measurement showing it is needed

### 10. Unbounded queues and histories

Risk:

throughput appears healthy while queue wait time and memory grow without bound.

Guard:

- event queue, worker queue, reliability history, retries, and future SHM resources are bounded
- queue-full behavior is explicit
- slow readers must not block unrelated readers

### 11. Dynamic/reflection path on the production static hot path

Risk:

generated C++ messages converted through DynamicData require field-name lookup, variants, shared ownership, and extra allocation.

Guard:

- DynamicData remains the tooling/simulation/reference compatibility path
- IDL-generated types use a generated direct `StaticCodec<T>` on the normal encode/decode path
- DynamicData remains available as the tooling/simulation/reference path, but is bypassed by generated production messages
- direct static output must be byte-for-byte identical to the DynamicData reference wire
- nested structs/arrays/sequences are recursively encoded into the same output buffer without per-field/per-element temporary byte vectors

### 12. Local callback scan cost

Risk:

A same-process publish scans every handler even when only one exact Resource+Type subscription can match.

Guard:

- Context stores handlers in an exact `type -> resource -> bucket` index
- publish performs heterogeneous string lookup without constructing a new resource string
- only the matching bucket is traversed
- unsubscribe during callback is marked inactive and cleaned after dispatch, avoiding iterator invalidation
- subscriptions use weak shared runtime state so destruction after Context teardown is safe

## Deterministic latency regression suite

`ctest -L latency` guards structural properties rather than timing thresholds:

- duplicate local subscriptions do not churn summary version
- repeated lease refresh does not grow the expiry schedule
- no-interest publish performs zero encoding/sends
- same-process-only fan-out encodes zero times
- mixed SHM/UDP fan-out encodes once and reuses the same payload
- packet decode view aliases the receive buffer
- generated Position and complex Telemetry codecs declare a direct static path and match the DynamicData reference bytes
- stale summary versions and recently retired incarnations do not trigger snapshot pulls
- remote demand snapshot updates preserve exact candidate-host lookup
- bounded demand snapshot packets carry at most 32 DemandKeys per control datagram
- route detail requests are sent only to candidate hosts whose exact DemandKey summary overlaps
- coordinator refresh keeps one scheduled expiry per live coordinator
- restart/lease expiry removes coordinator-owned direct routes
- route responses from a retired incarnation are rejected
- same-process publish uses an exact Type+Resource handler bucket rather than scanning unrelated handlers
- SHM writer progress is independent of reader progress
- slow SHM readers report overwritten sequences instead of blocking the writer
- two independent SHM reader processes consume the same publisher ring without shared reader state

Timing benchmarks and p99 measurements are recorded separately so noisy CI timing does not create false failures.

## Metrics to add with the network runtime

- discovery control bytes / host / second
- unique DemandKeys / host
- summary version changes / second
- subscription change -> routable p50/p95/p99
- event-loop queue depth and maximum stall
- encode count / published sample
- bytes copied / sample where measurable
- worker queue depth
- stale route removal time
- restart -> first successful data time
