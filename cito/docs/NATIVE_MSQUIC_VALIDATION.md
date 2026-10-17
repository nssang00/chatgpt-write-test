# Cito native MsQuic verification scope (2026-10-17)

This document records **actual GitHub Actions runner evidence**, not a claim
that the latest cumulative local v23 product source is integrated or shipped.

## Proven by native Ubuntu 24.04 + MsQuic 2.6.1

Workflow: `.github/workflows/cito-quic.yml` on
`cito-v23-native-headers`.

- Download and install pinned libmsquic 2.6.1 and matching headers.
- Compile and link an `MsQuicOpen2` / `MsQuicClose` probe.
- Compile both v23 listener/admission headers against the real SDK.
- Run two separate Linux network namespaces with MsQuic QUIC Streams,
  Datagram, Request/Reply, and the legacy public `Context::request()`.
- Verify a certificate issued by a generated private test CA, including
  server IP SAN (normal network 10.202.0.12; sanitized network 10.203.0.12).
- Verify an unrelated CA is rejected in the MsQuic handshake (transport
  shutdown event).
- Test positive server admission, owner-loop callback, OnClosed and
  `ConnectionClose` reaping.
- Test an explicit **application authorization reject** after a successful
  TLS handshake: authorized sessions remain zero and connection reaping occurs.
- Build and run the existing public Request/Reply smoke with
  AddressSanitizer/UndefinedBehaviorSanitizer. The existing smoke disables
  LeakSanitizer (`detect_leaks=0`): its pass is *not* a no-leaks guarantee.

## Security posture and caveats

- A verified **server** certificate does not authenticate the **client**.
  The v23 admission smoke has test-only callbacks `Authorize` = permit/reject.
  Production requires client identity verification (mTLS, tokens with
  binding, or equivalent), Cito node ID mapping and authorization policy.
- The legacy `MsQuicRequestSessionOptions` now optionally accepts a
  `ca_certificate_file`. Conflicting `ca_certificate_file` and
  `skip_server_certificate_validation` options fail closed.
  Certificate verification remains enabled by default.
- Do not treat QUIC `SEND_COMPLETE` as evidence the remote application
  received or accepted a message. In the rejected-admission scenario,
  the low-level test client may report a successful send even though the
  server has intentionally accepted **zero application sessions**.
  Drone control commands need application acknowledgments, command IDs,
  expiration and deduplication; transport send completion is insufficient.
- Unit tests and a subset of native headers are from the local cumulative
  v23 archive, but most code in the current GitHub branch still comes from
  the *older* `cito-dev` tree. The entire v23 source has **not** been merged
  or completely revalidated in Actions.
- This test uses ephemeral development certificates only. There is no
  provisioning, renewal or key revocation system.

## Remaining product-level acceptance gates

1. Sync **all** cumulative v23 source into a new GitHub test branch, then
   run its full native build, CTest and sanitizers.
2. Integrate the accepted v23 server streams and QUIC datagrams with the
   **public** Cito `Context` publish/subscribe and request/reply APIs.
3. Authenticate and authorize peer identity before admitting streams;
   require explicit on-wire application response where commands must
   confirm execution.
4. Test wrong certificate SAN, absent/expired cert, repeated connect/shutdown,
   loss, reordering, reconnect, resource exhaustion, and concurrent teardown.
5. Test Linux x64/ARM64 and distribution packaging with pinned SDK,
   no manual SDK installation for end users.
6. Only then expand to Protobuf, ROS 2, PX4/SITL, QoS and performance comparison.

GitHub CI: https://github.com/nssang00/chatgpt-write-test/actions/workflows/cito-quic.yml
