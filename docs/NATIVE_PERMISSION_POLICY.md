# Native authorization foundation — implementation status

The internal C++11 NativePermissionPolicy can deny by default, require a
host-supplied verified main-frame identity and exact method grants, and revoke
on navigation. Its separate Core CTest covers the default deny behavior,
frame verification flags, main-frame-only, navigation epoch, wildcard and
prototype-name blocking, app-scoped grants and concurrent read/revoke.

**This is NOT wired to real CEF or WebView2 bridge message intake yet.**
Caller IDs/verification flags must be issued by the actual backend/host,
never parsed from JS-supplied payloads. The WebView engine must authenticate
frame, origin, app asset root and navigation; route object-id operations back
through method permissions; revoke permissions/tokens on reload/destroy.
Cross-origin child frames and backend-to-backend calls require further tests.

A green unit test for this Core primitive is NOT evidence that native API
access from an untrusted web page is blocked in a real browser.
A1-SEC-01..07 remain release blockers until full cross-engine negative
E2E and security review. See docs/RELEASE_TEST_MATRIX.md.
