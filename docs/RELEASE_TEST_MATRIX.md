# Scope A1 release verification matrix

**Rule:** real host + real browser + real DLL/SO where the scenario crosses
those boundaries. A mock or header-only compile does not satisfy an E2E gate.

| ID | Scenario / expected result | Windows WebView2 | Windows CEF | Linux CEF | Status |
| --- | --- | --- | --- | --- | --- |
| A1-CORE-01 | C++11 Release build + CTest regressions pass | Required | Shared Windows Core | Required | Existing baseline PASS |
| A1-PLUG-01 | Real DLL/SO factory(77), methods, errors, dispose, busy/unload | Required | Required | Required | PASS: run 38322633033 |
| A1-SEC-01 | Trusted packaged entry loads; scoped native call succeeds | Required | Required | Required | NOT IMPLEMENTED |
| A1-SEC-02 | Remote https page has no native access by default | Required | Required | Required | NOT IMPLEMENTED |
| A1-SEC-03 | Arbitrary `file://` outside app root denied; path normalization/symlinks checked | Required | Required | Required | NOT IMPLEMENTED |
| A1-SEC-04 | Cross-origin and nested iframe (including `about:blank` inheritance) denied by default | Required | Required | Required | NOT IMPLEMENTED |
| A1-SEC-05 | Trusted page navigates/redirects to untrusted origin: prior grants and stale object handles cannot invoke | Required | Required | Required | NOT IMPLEMENTED |
| A1-SEC-06 | Forged JS message/frame/origin metadata and direct raw transport are rejected at native boundary | Required | Required | Required | NOT IMPLEMENTED |
| A1-SEC-07 | Missing method capability denied; explicit exact grant allows only that method | Required | Required | Required | NOT IMPLEMENTED |
| A1-HOST-01 | Existing Win32 host: create/resize/focus/reload/destroy with `Engine::Auto` | Required | Backend toggle | — | NOT IMPLEMENTED |
| A1-HOST-02 | Existing GTK3 window: same lifecycle, native callbacks | — | — | Required | NOT IMPLEMENTED |
| A1-HOST-03 | Both actual host samples invoke native function and real plugin, dispose safely | Required | Required | Required | NOT IMPLEMENTED |
| A1-DIST-01 | Install/relocate SDK then build C++11 consumer without source checkout | Required | Required | Required | Core-only PASS; engine distribution NOT IMPLEMENTED |
| A1-DIST-02 | Packaged CEF ICU/locales/DLL or SO and executable run from relocated bundle | Optional CEF | Required | Required | NOT IMPLEMENTED |
| A1-DIST-03 | WebView2 Evergreen available/missing paths reported accurately; fallback selection specified | Required | — | — | NOT IMPLEMENTED |
| A1-DIST-04 | C ABI plugin binary load / incompatibility / missing dependency gives actionable errors | Required | Required | Required | PARTIAL: prior regression; package case pending |
| A1-LIFE-01 | Rapid open/close, simultaneous objects, in-flight destroy/unload: no UAF, no permanent busy | Required | Required | Required | PARTIAL: Core regressions |
| A1-DOC-01 | Follow quickstart in clean CI environment; package licensed and reproducible | Required | Required | Required | NOT IMPLEMENTED |

## Failure workflow

For each failure record: test ID; exact command and SHA; OS, compiler,
SDK/runtime versions; expected vs actual; error output; severity; scope;
workaround; owner or next action; retest link. Do not silently retry flakiness.

## Interpretation

- "Existing baseline PASS" only certifies the previously executed narrow
  regression, not a host sample or packaged consumer.
- Windows CEF may be an optional *end-user choice*, but its advertised backend
  retains its CI parity gate.
- Security tests must exercise the final native dispatch/IPC boundary; simply
  hiding `xytron` from JS is insufficient.
- Sandbox/origin policy details may need engine-specific implementation.
  Any proposed relaxation of default-deny is a **requires approval** decision.
- Core events remain. Plugin-owned event ABI is tracked separately unless
  adopted into the first vertical slice.
