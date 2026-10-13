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

## Additional product-core gates — platform, plugins, CLI and wrappers

| ID | Tested user workflow / expected result | Required platform | Status |
| --- | --- | --- | --- |
| A1-CB-01 | Actual plugin invokes named JS callback; JS returns value asynchronously to plugin without blocking browser UI thread | Linux CEF, Win CEF, Win WebView2 | NOT IMPLEMENTED |
| A1-CB-02 | Plugin emits event; JS subscribes/unsubscribes; no delivery after unsubscribe or navigation | all 3 browsers | NOT IMPLEMENTED |
| A1-CB-03 | JS can pass callback reference/token to plugin as explicitly supported; callback can be invoked or rejected safely | all 3 browsers | NOT IMPLEMENTED |
| A1-CB-04 | Callback error/rejection propagates across C ABI as structured code/message, handles out-of-order completion | all 3 browsers | NOT IMPLEMENTED |
| A1-CB-05 | Plugin unload/reload and WebView destroy revoke live callback tokens without UAF/deadlock | all 3 browsers + ASan when available | NOT IMPLEMENTED |
| A1-CLI-01 | From empty workdir, `xytron new desktop hello --backend cpp` creates a valid new native desktop app | Windows and Linux | NOT IMPLEMENTED |
| A1-CLI-02 | `xytron restore` resolves/pins/downloads required SDK and browser engine, reuses cache, handles offline/error cases | Windows and Linux | NOT IMPLEMENTED |
| A1-CLI-03 | `xytron run` builds/launches real browser+plugin app with JS↔C++ callback test and auto engine | Windows and Linux | NOT IMPLEMENTED |
| A1-CLI-04 | `xytron build`, `xytron test`, `xytron publish` build/test/package runnable app without manual CMake SDK editing | Windows and Linux | NOT IMPLEMENTED |
| A1-CLI-05 | `xytron plugin new/build` creates valid versioned C ABI DLL/SO; `xytron doctor` diagnoses missing compiler/engine | Windows and Linux | NOT IMPLEMENTED |
| A1-WRAP-01 | Python wrapper attaches to Core and invokes typed native/JS action with structured async success/error | Linux and Windows target matrix | NOT IMPLEMENTED |
| A1-WRAP-02 | C#/.NET wrapper attaches to same Core and exposes Task-style async/error, correct handle disposal | Windows, with Linux parity where supported | NOT IMPLEMENTED |
| A1-WRAP-03 | Python and C# callbacks/handles remain safe across WebView destroy and runtime/plugin shutdown | Wrapper-specific CI + actual browser path | NOT IMPLEMENTED |
| A1-PRODUCT-01 | Generated new app and separately embedded host app use the same NativeWeb core/engine/bridge/plugin API | Windows and Linux | NOT IMPLEMENTED |

**Existing JS→plugin factory E2E PASS does not satisfy A1-CB cases.**
C++→JS Core calls already exist but must be exercised from a separately loaded
plugin and through the intended callback C ABI.

## Standalone OS shell, real language backends and managed controls

| ID | Scenario and expected observable behavior | CI platforms | Current state |
| --- | --- | --- | --- |
| A1-SHELL-01 | Standalone OS window create/title/show/resize/close; JS event routing | Linux CEF, Windows WebView2/CEF | NOT IMPLEMENTED |
| A1-SHELL-02 | Real native app menu create/update/disabled/checked/accelerator and command event | Linux + Windows | NOT IMPLEMENTED |
| A1-SHELL-03 | Native context menu right-click/popup/selection invokes JS/backend callback; closes cleanly | Linux + Windows | NOT IMPLEMENTED |
| A1-SHELL-04 | Untrusted page/frame cannot invoke restricted window/menu/context commands | Three engines | NOT IMPLEMENTED |
| A1-SHELL-05 | Multi-window menu routing and dispose/close callback invalidation | Linux + Windows | NOT IMPLEMENTED |
| A1-BACK-01 | CLI-generated `cpp` desktop app invokes real DLL/SO; plugin calls JS back | Windows + Linux | NOT IMPLEMENTED |
| A1-BACK-02 | CLI-generated `python` desktop app invokes real Python backend and receives async/stream callbacks | Windows + Linux | NOT IMPLEMENTED |
| A1-BACK-03 | CLI-generated `csharp` app invokes real .NET backend and receives Task/event callbacks | Windows + Linux | NOT IMPLEMENTED |
| A1-BACK-04 | Python/.NET missing dependency, crash, shutdown, callback cancel report meaningful errors | Windows + Linux | NOT IMPLEMENTED |
| A1-HOST-04 | MFC child control embeds WebView; real resize/focus/reload/disposal with MFC app menu unchanged | Windows WebView2/CEF | NOT IMPLEMENTED |
| A1-HOST-05 | WinForms control embeds WebView and calls C# backend safely on correct UI dispatcher | Windows WebView2 | NOT IMPLEMENTED |
| A1-HOST-06 | WPF component embeds WebView, respects WPF layout/dispatcher and native callback disposal | Windows WebView2 | NOT IMPLEMENTED |
| A1-DIST-05 | xytron publish includes Python runtime/dependencies as configured; new app runs on clean host | Windows + Linux | NOT IMPLEMENTED |
| A1-DIST-06 | xytron publish handles .NET runtime/config assets; new C# app runs on clean host | Windows + Linux | NOT IMPLEMENTED |

Python LLM/AI CI uses deterministic local fake-model output instead of
external subscription credentials. OS menu E2E cannot be satisfied with an
HTML-only menu. Embedded-control E2E cannot be satisfied by a standalone
browser host disguised as a component.

## Unified Main/Module/Plugin regression cases

| ID | Test case | Scope | Current state |
| --- | --- | --- | --- |
| A1-MOD-01 | Register exactly one Main; Main may be cpp/python/csharp | Core C++11 + CI | CORE Windows/Linux PASS: 38334300674; runtime E2E pending |
| A1-MOD-02 | Additional Modules accept all languages independent of Main | Core C++11 + CI | CORE Windows/Linux PASS: 38334300674; runtime E2E pending |
| A1-MOD-03 | Duplicate module IDs, invalid reserved IDs and second Main return stable codes | Core C++11 + CI | CORE Windows/Linux PASS: 38334300674; runtime E2E pending |
| A1-MOD-04 | RAII token removal, module destruction/expired registry and replacement safety | Core Release/ASan | CORE Windows/Linux PASS: 38334300674; new-test ASan pending |
| A1-MOD-05 | Registry is app-scoped; same IDs in different apps do not collide | Core C++11 + CI | CORE Windows/Linux PASS: 38334300674; runtime E2E pending |
| A1-MOD-06 | Plugin `delivery=plugin` is Module, but embedded feature Module is not independent package; manifest/build rejection of mismatch | CLI + Runtime E2E | NOT IMPLEMENTED |
| A1-MOD-07 | Main Python + C++ camera Plugin + C# ERP Module coexist, JS calls identical, actual backend-to-backend request/reply, callbacks/events | Win/Linux actual-browser E2E | NOT IMPLEMENTED |
| A1-MOD-08 | Module-to-module permissions not implicit; forged calls denied by Core even when Main initiates | three browser engines | NOT IMPLEMENTED |
| A1-MOD-09 | Module unload with in-flight JS/worker callbacks, crash and restart do not leak calls or crash other Modules | Windows/Linux real engines + ASan | NOT IMPLEMENTED |
| A1-CLI-06 | `xytron new` default creates exactly one Main; `module add` adds features without changing Main; `plugin new` creates independently delivered module | Win/Linux CLI end-to-end | NOT IMPLEMENTED |

These are additive to verified plugin object E2E, and do not replace
application-shell, Python/C# actual backend, security, packaging or embedded
control release gates.

## Verified implementation slices, not yet product E2E

- Module Registry Core test passes on Ubuntu and Windows: [Core Regression 38334300674](https://github.com/nssang00/chatgpt-write-test/actions/runs/38334300674). This verifies A1-MOD-01..05 at metadata/RAII level; A1-MOD-06..09 require real runtime and remain blocked.
- Native xytron CLI scaffold and CLI-generated C++ plugin DLL/SO compilation against installed SDK pass on both systems: [Xytron CLI 38334470209](https://github.com/nssang00/chatgpt-write-test/actions/runs/38334470209). It does NOT pass full A1-CLI-01/05 or end-user publish.
- Exact-method/frame default-deny C++ policy primitive passes on Linux/Windows: [Core Regression 38334609344](https://github.com/nssang00/chatgpt-write-test/actions/runs/38334609344). Actual engine security boundary is NOT IMPLEMENTED/VERIFIED; A1-SEC-01..07 remain blocked.

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

## 2026-10-13 coverage update (CI source 7e45e72b)

| Coverage | Verified evidence | Does NOT satisfy |
| --- | --- | --- |
| Native method entry guard | `core.trusted_document` and 3-engine **positive** browser lifecycle PASS in 38336744516 | A1-SEC-01–07 real **negative** trust/origin/iframe/permission E2E |
| Module namespace dispatch | `core.module_bridge` + Module Registry C++11, Ubuntu/Windows Core run 38336744611 PASS | A1-MOD-07 actual Python/C# hosts; secure cross-module transport; unloaded DLL lease |
| CLI `module add` scaffolds | Python Main + cpp/python/csharp feature sources/manifests, CLI 38336744554 PASS both OS | A1-CLI-06 full runtime use and schema migration; A1-CLI run/restore/publish |
| Independent C++ Plugin DLL/SO generation | CLI tests install Core SDK and compile generated module both OS, 38336744554 PASS | Plugin `xytron plugin build` command and runnable published desktop app |
| Existing Plugin Browser E2E | All 3 engines 38336744516 PASS | Plugin→JS reverse callback/event ABI and full desktop app shell |

The unit tests reject invalid methods, wrong main frame/source and stale
module generations, but these tests alone are **not evidence** that
a malicious real page/frame could not trigger a native side effect.
