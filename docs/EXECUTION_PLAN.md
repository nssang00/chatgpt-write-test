# NativeWeb autonomous execution plan — Approved Scope A
Updated 2026-10-13

## Objective

Deliver a **usable, deployable SDK for embedding Web UI in existing native
Windows/Linux applications**, not only a successful bridge/Plugin Core.

Canonical scope: [RELEASE_SCOPE_A.md](RELEASE_SCOPE_A.md)
Test matrix: [RELEASE_TEST_MATRIX.md](RELEASE_TEST_MATRIX.md)
Acceptance: [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md)
Source of truth: Draft PR #7, `nativeweb/autonomous-integration` branch.

## Completed baseline: A0 (verified, not product completion)

- C++11 Linux and Windows Core Regression passed, run 38322632990.
- Real Linux CEF, Windows CEF and Windows WebView2 plugin E2E passed,
  run 38322633033 on commit b2f1ced3.
- Installed **Core-only** SDK C++11 + pure-C ABI consumer CI passed,
  run 38322633018; engine SDK distribution remains pending.
- Full Linux ASan 21/21, Linux Release 21/21 and repeated lifecycle tests
  passed per current handoff. Do not substitute these for host/security tests.

## Work sequence: dependency-driven, no ungrounded dates

| Milestone | Output | Exit gate | Status |
| --- | --- | --- | --- |
| A0 Baseline | Core + plugin + all browser backends & CI | Existing three-engine plugin E2E | VERIFIED |
| A1 Security foundation | Origin/trust model, authorization at native dispatch, exact capability/permission grants | A1-SEC-01 through A1-SEC-07 on all three engines | NOT STARTED |
| A2 Host integration | Minimal Win32 HWND and Linux GTK3 host adapters/examples | A1-HOST-01 through A1-HOST-03 | NOT STARTED |
| A3 Engine and SDK distribution | Portable SDK bundle, engine/runtime resources, plugin fixture, clean relocation/consumer | A1-DIST-01 through A1-DIST-04 | CORE-ONLY BASELINE |
| A4 Release validation | End-to-end quickstart, negative security, stress/ASan, runtime failure paths, documentation | All required matrix gates; no unapproved exclusion | NOT STARTED |
| A5 Approval and delivery | Versioned deliverable and release notes | Explicit approval for main merge/public release | WAIT FOR APPROVAL |

### A1: security implementation order
1. Define the trust boundary and default local packaged-content ownership
   (avoid blanket `file://` or localhost trust).
2. Add an engine-independent authorization decision at the **host dispatch**
   boundary with request/frame identity supplied by the engine, not JS.
3. Plumb navigation and frame identity from CEF and WebView2, revoke scope on
   navigation/reload/destroy. Block non-main frames by default.
4. Add typed per-method/plugin capability grants with explicit narrow opt-in.
5. Add failing security tests first, then fixes; verify real engines and
   preserve positive local app behavior.

### A2: host adoption
- Win32: existing HWND, lifecycle, resize/focus; Windows WebView2 automatic
  engine with tested CEF override. Keep wrappers thin.
- GTK3: existing window/widget lifecycle with Linux CEF.
- Each sample calls a normal `bind()` function and an actual object factory
  from a DLL/SO; test fresh app startup and repeated shutdown.

### A3: packaging and adoption
- Separate engine-neutral `NativeWeb::Core` from backend distribution.
- Produce reproducible Windows and Linux SDK artifacts with CMake imports,
  headers, plugins, CEF resources, and WebView2 runtime detection.
- Compile/run relocated installed consumers and actual host samples with
  source-tree dependencies unavailable.
- Include redistributable third-party license/notice checks. No binary
  publication until redistribution is permitted.

### A4: acceptance and documentation
- All security negative cases and host E2E must pass in a CI matrix.
- Include no-engine/invalid-runtime, missing plugin, incompatibility and
  partial shutdown error paths.
- Preserve core tests, browser E2E and Linux ASan; add host lifecycle stress.
- Write a clean-machine quickstart and reproduce it in CI.
- Avoid marking completed work solely from test-harness implementation.

## Execution policy

- Record a blocker with impact in `docs/ISSUE_LOG.md`; independent work
  continues (e.g. packaging metadata while browser CI is blocked).
- Implementation -> failing test (where possible) -> fix -> focused test ->
  whole affected regression/real-engine CI -> evidence/issue closure.
- State precisely: VERIFIED, IMPLEMENTED/UNVERIFIED, BLOCKED, REQUIRES APPROVAL.
- Work on a development branch/PR, keep `main` intact. No release without
  approval; avoid unnecessary intermediate confirmation requests.
- If authorization or API compatibility choices require scope expansion,
  document alternatives and only then request the specific approval.
