# Cito Pub/Sub multiprocess and multi-node Actions validation

**Date:** 2026-10-19
**Branch:** `cito-pubsub-multiprocess-validation`
**Base:** `cito-v24-mtls-native` (stacked on PR #10, not cumulative local v25)

## Test matrix

| Scenario | Distinct OS processes | Distinct netns | Observable assertion | Result |
|---|---:|---:|---|---|
| Shared-memory ring, writer → two readers | 3 | No | Both readers receive 100 ordered messages without drops | Passed |
| UDP interest discovery, one publisher → two matching subscribers + one unrelated | 4 | 4 | 2 destinations discovered/sent, both position subscribers receive, battery subscriber sees no data | Passed |
| Reusable HostRuntimeCore / UdpRuntimeAdapter | 4 | 4 | 2 matching interest routes, two deliveries, unrelated type has 0 route requests | Passed |
| Native MsQuic CTD1 Stream → typed Cito Context::on | 2 | 2 | `received=1 value=42`, datagram also verified | Passed |

### GitHub Actions evidence

- [Shared memory + four-node fanout success](https://github.com/nssang00/chatgpt-write-test/actions/runs/39213746907)
- [Native MsQuic typed receiver success](https://github.com/nssang00/chatgpt-write-test/actions/runs/39213772970)

The four-node tests use IP addresses 10.212.0.11 (publisher),
10.212.0.12 (matching subscriber 1), 10.212.0.14 (matching subscriber 2),
and 10.212.0.13 (unrelated subscriber), one process per namespace.
The SHM test runs all three processes in a single namespace because
POSIX shared memory is a host-local IPC transport.

## Important limitations

- **Full automatic QUIC Pub/Sub is NOT yet verified.** The current GitHub
  PR #10 branch still has a placeholder remote Context::publish send
  callback and lacks RequestNetworkAdapter::receive_data(), unlike the
  newer cumulative *local* v25 source.
- The native MsQuic test therefore explicitly creates a CTD1 typed wire
  frame, transmits it over real QUIC, and passes it to the receiving
  Context's handler via a small owner-thread test bridge. That verifies
  native transport, framing, and public callback independently, not
  end-to-end discovery-to-Context.publish-to-delivery automation.
- The UDP node tests exercise the demand-based core/adapter, not
  certificate-authenticated MsQuic or physical separate computers.
- Actual hardware network, firewalls/NAT, ROS 2/PX4 integration and
  high-load durability are not covered by this test.
- The test reuses the older GitHub tree, not a full migration of local v25
  authorization enforcement into the native QUIC driver.

## Next acceptance gate

Merge cumulative local v25 sources with the native MsQuic driver in a
separate test branch, then require a black-box **Publisher Context in
process A** → discovery → authenticated native MsQuic session →
**Subscriber Context in process B**. Extend to 1:N matching subscribers
and verify node/topic ACLs fail closed on the actual receive path.
