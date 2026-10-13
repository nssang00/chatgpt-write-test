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

## Verified status and urgent integration gap

At source `27bf2489`, [Core Regression #38334609344](https://github.com/nssang00/chatgpt-write-test/actions/runs/38334609344) passed on Linux and Windows with `core.native_permission_policy`. It tests exact method grants, trusted verified main frame, frame/navigation ID mismatch, revoke and concurrent decisions.

**Outstanding P0 release blocker NW-014:** no proven wiring from CEF/WebView2 frame/origin identity to the policy and the actual native JS→C++ request dispatch. It does NOT yet prevent an untrusted page from calling a native method. When wiring, prohibit JS-supplied identity bits and authorize original object method ownership, not just the internal object operation name. Add negative real-browser tests on all three backends.
