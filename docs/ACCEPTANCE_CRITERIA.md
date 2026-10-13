# NativeWeb Scope A1 — first usable SDK acceptance criteria

**Approved 2026-10-13:** First deliverable is an **Electron/Tauri-category desktop development
platform powered by C/C++**. It supports new CLI-generated apps **and**
existing native-host embedding, with Python/C# wrapper vertical slices,
bidirectional plugin callbacks and redistributable engine SDK. A Core +
Plugin SDK-only target is insufficient. See [RELEASE_SCOPE_A.md](RELEASE_SCOPE_A.md) and
[RELEASE_TEST_MATRIX.md](RELEASE_TEST_MATRIX.md).

## Previously verified foundation (not sufficient for release)

| Gate | Status | Evidence |
| --- | --- | --- |
| Linux/Windows C++11 Core Regression | PASS for covered tests | CI 38322632990 |
| Linux CEF plugin object E2E | PASS | CI 38322633033 |
| Windows CEF plugin object E2E + parallel full build | PASS | CI 38322633033 |
| Windows WebView2 plugin object E2E | PASS | CI 38322633033 |
| Linux lifetime/ASan | PASS for covered tests | Linux ASan 21/21; repeated regression evidence in HANDOFF |
| Relocatable Core SDK consumer | PASS for Core only | Linux/Windows CI 38322633018 |

## New compulsory Scope A1 gates

| Gate | Definition of done | Status |
| --- | --- | --- |
| SECURITY | Native-boundary default deny for remote/untrusted docs, files, frames, redirects and ungranted methods; explicit narrow grants; real three-engine negative E2E | NOT COMPLETE — BLOCKER |
| CLI NEW/RESTORE/RUN/BUILD/TEST/PUBLISH | Working .NET-like xweb CLI MVP from fresh project through engine/SDK download to packaged run; useful diagnostics | NOT COMPLETE — BLOCKER |
| PLUGIN CALLBACKS | Actual DLL/SO plugin ↔ JS async callback/event/reference, error, unsubscribe and destroy/unload safety in all browsers | NOT COMPLETE — BLOCKER |
| PYTHON/C# WRAPPERS | Python and C# initial official wrapper API with async/handle/error/callback CI cases | NOT COMPLETE — BLOCKER |
| GREENFIELD APP | CLI-generated new native desktop app runs packaged UI+plugin on fresh Windows/Linux runtime | NOT COMPLETE — BLOCKER |
| WIN32 HOST | Embedded native HWND sample, real Win WebView2/CEF bridge/plugin and create/resize/focus/reload/destroy verified | NOT COMPLETE — BLOCKER |
| GTK3 HOST | Embedded GTK3 app sample, Linux CEF bridge/plugin and lifecycle verified | NOT COMPLETE — BLOCKER |
| DISTRIBUTION | Engine-backed portable SDK, resources/runtime prerequisites, CMake install and relocatable app+plugin tests on clean Windows/Linux environments | NOT COMPLETE — BLOCKER |
| FAILURE BEHAVIOR | Missing/unsupported runtime, invalid/missing plugin, denied origins, shutdown races, deterministic errors | PARTIAL — BLOCKER |
| ADOPTION | Quickstart is sufficient to build/run an installed consumer without repo source/undocumented setup | NOT COMPLETE — BLOCKER |
| THIRD PARTY | Engine and SDK redistribution notices/licenses checked before external release | NOT COMPLETE — RELEASE BLOCKER |
| FINAL REVIEW | All required tests green and open P0/P1 blockers closed; permission/security exceptions and release explicitly approved | NOT COMPLETE |

**Preserve:** C++11 public baseline; `Engine::Auto`, `nativeweb::WebView`,
direct `xytron.foo()`, stable C ABI plugin and safe unload. Do not weaken
security to make a smoke test green.

**Deferred from this first deliverable:** formal MFC/WinForms/WPF/Qt host
adapters, full Python/C# wrapper feature parity, advanced CLI plugin registries,
Sidecar, full Desktop API parity, advanced shared/transfer buffer, Code - OSS,
full installer/code signing. Existing APIs must not be removed.

**Interpretation:** Real plugin E2E PASS does not imply trusted-origin policy,
host integration or engine-inclusive package PASS. A release gate may only be
excluded by explicit approval. The current GitHub PR stays draft; `main`
and external releases require approval.
