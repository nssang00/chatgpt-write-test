# NativeWeb Session Handoff

## 2026-10-14 owner-approved binding API milestone (READ FIRST)

- Owner-uploaded `Xytron_Cross_Language_Plugin_Binding.md` registration
  API adopted as the public direction. Canonical
  `docs/CROSS_LANGUAGE_BINDING.md`, D-043..045 and A1-BIND-01..11
  list contracts/tests/implementation gaps.
- **C++ B0 function registration VERIFIED:** `XYTRON_MODULE(m)`,
  `m.function`, name/version derived from plugin.json during compile,
  old ABI + legacy NATIVEWEB_PLUGIN preserved. Win/Linux Core 38481436246
  and CLI 38481853765 PASS; CLI-produced DLL/SO actually re-loaded
  and invoked via PluginModule. New header must be installed from
  `include/xytron/` (bug fixed `ac4008ed`).
- **Python/C# registration metadata VERIFIED LOCALLY:** actual
  `@xytron.export` decorator and `[Export]` reflection helper,
  [CI 38481659399](https://github.com/nssang00/chatgpt-write-test/actions/runs/38481659399)
  PASS Windows/Linux. Neither talks to actual JS Core host.
- **Not done:** C++ fluent class_/constructor/method/property
  (A1-BIND-03), strict PluginManager catalog/lazy-load (B1),
  static ESM named import (B4), real Python/.NET host/async callbacks
  (B3), NW-014 method-level native permissions, and standalone shell.
  plugin.json RID entry is not yet copied/published by CLI (NW-032).
- Core run [38481436246](https://github.com/nssang00/chatgpt-write-test/actions/runs/38481436246),
  CLI run [38481853765](https://github.com/nssang00/chatgpt-write-test/actions/runs/38481853765).
  Browser regression status should be checked for executable source
  `c2b4dd5a`. All changes on draft PR #7, not main.



## 2026-10-14 user binding API decision (current)

Uploaded `Xytron_Cross_Language_Plugin_Binding.md` establishes C++
`XYTRON_MODULE(m)` / `m.function` / fluent class API, C# `[Export]`,
Python `@xytron.export`; the JS experience must be language-neutral.
Canonical repo adaptation: `docs/CROSS_LANGUAGE_BINDING.md`.
Keep C++11 nativeweb::Any and versioned C ABI; use plugin.json as one
packaged Plugin identity, with compile-time ID supplied by build tooling.
Do not break legacy NATIVEWEB_PLUGIN; do not claim class/ESM/.NET/Python
runtime integration until their real gate tests pass. Main remains one
logical Module plus N feature Modules and Plugin is a packaged subtype.
Tracked in D-043..045, A1-BIND-01..11, NW-028.



이 문서는 **새 ChatGPT 세션, 새 개발자, 새 작업 브랜치가 가장 먼저 읽는 단일 인수인계 문서**다.

> 목표: 이전 대화를 읽지 않아도 이 저장소만으로 현재 방향, 완료 상태, 다음 작업을 파악하고 바로 개발을 계속할 수 있어야 한다.

## Latest main branch drift — separate owner activity, 2026-10-13

Main currently `5e286f965f55548727f87e08bf8186fb2f8df65c`,
10 commits beyond the previously observed `7951ba62` (M5 CI
workflow/docs). This development work did NOT edit main. PR #7 is
divergent/Draft; review latest main and rerun integration CI before any
owner-approved merge. See NW-023.

## 2026-10-13 verified same-entry iframe security and SDK doctor milestone

- **Code branch:** `nativeweb/autonomous-integration` on Draft PR #7.
  Same-entry negative browser test `dfaabf0e`, doctor feature
  `8d6f6151`, fixed YAML quoting `913a775e` and PowerShell invocation
  `0c879ae0`.
- **Real same-entry frame security test:** a child loads the **identical
  trusted HTML entry**, proves it executed, attempts `xytron.test.checkpoint`
  and the test rejects any forbidden native side effect. Original
  different-file iframe probe and plugin-object E2E still run.
  [Browser CI 38354623946](https://github.com/nssang00/chatgpt-write-test/actions/runs/38354623946)
  **PASS: Linux CEF / Windows CEF / Windows WebView2.** NW-024 VERIFIED
  for this scenario only; NW-014 P0 still OPEN.
- **Native `xytron doctor --sdk PREFIX`:** checks real installed
  `include/nativeweb/plugin.hpp`, NativeWeb CMake package and `cmake`
  availability. [CLI CI 38355060435](https://github.com/nssang00/chatgpt-write-test/actions/runs/38355060435)
  **PASS: Windows and Ubuntu**, including doctor, source scaffolds,
  `xytron plugin build` and actual installed-SDK DLL/SO generation.
  NW-025 VERIFIED for Core SDK only; NW-026 YAML and NW-027 PowerShell
  workflow issues corrected and CI green.
- [Core Regression 38355060575](https://github.com/nssang00/chatgpt-write-test/actions/runs/38355060575)
  **PASS Windows + Ubuntu**; [Installed Core consumer
  38355060701](https://github.com/nssang00/chatgpt-write-test/actions/runs/38355060701)
  **PASS both OS**.
- **Not complete:** `NativePermissionPolicy` not fully bound to
  browser-origin authentication and exact method authorization.
  Real negative method-denial, remote and navigation tests, object
  capability checks and race/revocation remain open. CLI Core doctor
  does **not** validate or download CEF, WebView2, Python or .NET
  engines/hosts. `xytron run`, `restore`, `publish`, native desktop
  shell/menus and language hosts are not implemented yet.
- PR #7 remains Draft. No main merge/release. Main independently
  advanced earlier (NW-023), and integration needs owner approval.

## Important parallel main updates (2026-10-13)

Main has independently moved to `7951ba62625c0deb305fc2f99fc04b0c7f23dd19`
(five M5 CI docs/workflow commits after the previous base). Development
PR #7 is still Draft and divergent. Do not claim `main` is unchanged;
this work made no main branch merge, and final integration needs a fresh
base compatibility check plus owner approval (NW-023).

## 2026-10-13 final verification: latest hardened fixture + WebView2 child denial

**Executable source `4ff17af2fb6d1d1e2752acec7e25ea7d52f35f5d`**
- [Real browser #38343177515](https://github.com/nssang00/chatgpt-write-test/actions/runs/38343177515): Linux CEF, Windows CEF, Windows WebView2 **ALL SUCCESS**. This specifically includes the independent iframe ready handshake, attempted native side effect and forbidden-checkpoint absence, plus legacy C++ Plugin E2E.
- [Core #38343176859](https://github.com/nssang00/chatgpt-write-test/actions/runs/38343176859): Ubuntu/Windows **PASS**, Module Bridge/Registry/trusted document methods.
- [CLI #38343176992](https://github.com/nssang00/chatgpt-write-test/actions/runs/38343176992): Ubuntu/Windows **PASS**, real `xytron plugin build` compiles generated DLL/SO with installed SDK.
- [Installed SDK #38343176874](https://github.com/nssang00/chatgpt-write-test/actions/runs/38343176874): Ubuntu/Windows **PASS** (Core consumer only).
- NW-019 first negative actual browser side-effect case: VERIFIED for *different-file child iframe*. NW-022 wrong-frame reply hardening: VERIFIED against same E2E and Win WebView2. NW-020 actual plugin build VERIFIED, NW-021 test argument fix CLOSED.
- **NW-014 P0 security BLOCKER STILL OPEN**: Only a targeted negative test, not all origins, same-source frames, lifecycle and per-method grants. No release waiver or security claim beyond tested scenario.

## 2026-10-13 latest security/CLI workstream (read first)

- Development branch `nativeweb/autonomous-integration`; [Draft PR #7](https://github.com/nssang00/chatgpt-write-test/pull/7). **No main merge or release.**
- **Native document security:** `022c519e` gates CEF and WebView2
  renderer-originated REQUEST, RESPONSE/ERROR envelopes, preventing a
  second document from injecting native calls or forged responses. The
  security browser fixture now loads a **separate local HTML iframe**,
  actually tries an unauthorized native checkpoint and fails if the
  forbidden native side effect appears. The child signals ready before
  attempted invocation, so a missing iframe cannot count as passing.
  First three-engine real-browser negative fixture **PASS**:
  [E2E 38342611291](https://github.com/nssang00/chatgpt-write-test/actions/runs/38342611291).
  Later `7bccf114` prevents WebView2's top-level-only response API from
  returning a child denial to the wrong Promise, and `4ff17af2`
  adds the required iframe-ready handshake. Latest follow-up:
  [E2E 38343177515](https://github.com/nssang00/chatgpt-write-test/actions/runs/38343177515).
- **Native `xytron plugin build`:** C++ plugin uses an *already installed*
  Core SDK (`--sdk PREFIX`) and actually builds Windows DLL / Linux SO
  by invoking CMake, with validated SDK path arguments. C++11 CLI tests
  and generated binary build passed on both systems:
  [CLI 38343029145](https://github.com/nssang00/chatgpt-write-test/actions/runs/38343029145).
  The CMake semicolon-splitting test typo (NW-021) is resolved; follow-up
  [CLI 38343176992](https://github.com/nssang00/chatgpt-write-test/actions/runs/38343176992).
- Baseline Core 26/26, installed Core SDK and existing real plugins remain
  green. Security docs and scope matrix updated to track **one negative
  frame side-effect test**, not a finished policy.
- **NW-014 stays P0 release blocking:** real method-grant authorization
  and trust root/path canonicalization, navigation epoch, WebView2
  same-URL frame identity, safe native object handles, and remaining
  cross-engine negative tests are NOT COMPLETE. Also `xytron restore/run/publish`,
  Python/.NET real language hosts, native app shell/menus and Plugin→JS
  callbacks remain unimplemented product scope.
- Next independent tracks: full caller/permission binding at dispatch,
  frame-specific WebView2 controls, actual Module→language-host transport,
  CLI restore/run + app shell. Plugin build is no longer a totally
  unimplemented command, but is only a supplied-SDK compile step.

## 2026-10-13 latest verified source checkpoint (read first)

- Development branch `nativeweb/autonomous-integration` / Draft PR #7.
  **Verified executable commit: `7e45e72bdc8a55b9ebedd48918fa232a9077e8b1`.**
- [Browser plugin E2E 38336744516](https://github.com/nssang00/chatgpt-write-test/actions/runs/38336744516):
  real **Linux CEF, Windows CEF and Windows WebView2 ALL PASS**.
  CEF/WebView2 native message intake now checks engine-supplied sender
  vs explicitly hosted local file entry; remote/unrelated source denied.
  **NW-014 P0 remains OPEN** because full security origin/frame/method
  grants, same-file iframe proof, negative browser E2E and native-object
  authorization are NOT DONE.
- [Core 38336744611](https://github.com/nssang00/chatgpt-write-test/actions/runs/38336744611):
  Ubuntu + Windows full C++11 regression 26/26 PASS, including internal
  ModuleRegistry → BridgeRuntime namespaced method calls and stale
  generation rejection. Uses function stubs, NOT running Python/.NET.
- [CLI 38336744554](https://github.com/nssang00/chatgpt-write-test/actions/runs/38336744554):
  Ubuntu + Windows PASS. Generates `cpp/python/csharp` Main scaffolds,
  `xytron module add` cpp/python/csharp feature scaffolds and C++ plugin
  DLL/SO against installed SDK. Commands `run`, `restore`, `publish`,
  `plugin build`, etc remain unimplemented. NW-015 remains open.
- [Installed Core SDK 38336744625](https://github.com/nssang00/chatgpt-write-test/actions/runs/38336744625):
  Ubuntu + Windows PASS. Core only, not complete engine-backed distribution.
- NW-016 test typo FIXED, NW-018 engine linker source-list FIXED with all
  browser regressions green. Details in `docs/ISSUE_LOG.md`.
- Product contract remains Electron-style standalone desktop as primary,
  embedded controls secondary, one Main + mixed cpp/python/csharp
  Modules and independently packaged Plugins, uniform JS calls/callbacks.
  No `main` merge or release without explicit approval.

## 2026-10-13 verified three-track implementation checkpoint (latest)

- **Core Module Registry** `bf67b567`: internal per-app one Main + feature Modules, cpp/python/csharp metadata, plugin delivery marker, duplicate/invalid-ID rejection, generation-safe RAII and concurrent registration. **Linux/Windows Core CI PASS** [38334300674](https://github.com/nssang00/chatgpt-write-test/actions/runs/38334300674). Not connected to JS routing or language runtime yet.
- **xytron CLI bootstrap** `091a57f4`: native C++11 executable generates Main project scaffolds for cpp/python/csharp and independent C++ Plugin project. Real generated plugin DLL/SO compilation with installed Core passes on Linux/Windows [38334470209](https://github.com/nssang00/chatgpt-write-test/actions/runs/38334470209). No app run, restore, publish or real backend transport yet.
- **Native permission policy** `27bf2489`: exact-grant/frame/navigation Core policy unit tests passed on Linux/Windows [38334609344](https://github.com/nssang00/chatgpt-write-test/actions/runs/38334609344). **NOT connected to CEF/WebView2 dispatch**; this is NOT a security fix for untrusted content. See NW-014.
- Source branch `nativeweb/autonomous-integration`, Draft PR #7, `main` untouched. CI and issues stay independent, release approval not requested.
- Next independent tracks: browser-verified origin/frame authorization, Module Registry→Bridge dispatch, CLI module add + real run/restore, plugin→JS event/callback ABI, real Python/C# hosts and standalone shell.

## 2026-10-13 owner-accepted Main/Module/Plugin hierarchy (latest)

- **One logical Main Backend + 0..N feature Modules** in the same app.
  Every Main/feature is a Module; any module implementation language may
  be cpp/python/csharp concurrently. The Core is infrastructure, NOT Main.
- **Plugin is an independently packaged Module**, not another conflicting
  runtime category. A C++ DLL/SO plugin is first; Python/C# plugins can
  be packaged later. JS calls all Modules the same way.
- App-scoped registry; unique identifiers; one Main; tokens/lifecycle,
  authorized module-to-module routing; callback/event safety. See
  `docs/MODULE_ARCHITECTURE.md` and D-041/D-042.
- **Immediate independent tracks:** module registry C++11 core/tests;
  CLI manifest/project scaffolding; native security boundary/test cases.
  Keep any blocked track logged; do not mislabel registry-only tests
  as real mixed-language runtime E2E.

## 2026-10-13 latest owner clarification — REQUIRED PRODUCT CONTRACT

- **Not merely SDK embedding:** Electron-like standalone desktop **native OS
  window + menu bar + right-click context menus + command callbacks**,
  AND WebView2-like control inserted into **WPF, WinForms, MFC**, Win32/GTK3.
- **Shared C/C++11 Core but selectable user-authored backend profiles:**
  `cpp` (versioned DLL/SO plugin, JS↔native callback), `python` (real
  Python LLM/AI backend), `csharp` (actual .NET legacy backend).
  Wrappers-only for Python/C# do not meet this requirement.
- **CLI user command:** `xytron` (the earlier `xweb` working name is
  historical); developer must create, download/restore, run, build,
  test, publish and compile C++ plugins via CLI.
- **Release gates expanded:** native shell/menu/context, CLI backend-profile
  E2E, WPF/WinForms/MFC embedded controls, Python/.NET runtime packaging.
  Existing three-engine browser E2E remains a foundation PASS only.
- Canonical: `docs/PRODUCT_MODES_AND_BACKENDS.md` and
  `docs/RELEASE_SCOPE_A.md`; main unchanged, PR #7 draft, no release.

## 2026-10-13 owner-confirmed full product identity (read first)

- NativeWeb/Xytron is an **Electron/Tauri-category desktop application
  platform**, with **C/C++ native backend** (no required Node.js/Rust backend).
  It is neither just a WebView SDK nor only an embeddable legacy-UI adapter.
- **First-class new-app and existing-host workflows**: CLI creates a new
  C/C++-backed desktop app; Win32/GTK3 adapters embed into existing projects.
- **Plugin is product-core**: versioned DLL/SO C ABI, direct JS calls **both
  directions**, async JS↔native callbacks/events, lifecycle-safe unsubscribe,
  ownership and error propagation. Existing JS→plugin object E2E is only
  the current verified foundation; plugin-owned callback ABI remains undone.
- **Official language wrappers**: Python and C#/.NET are Core API wrappers,
  **not only Sidecars**. Initial wrapper integration tests are required for
  the first usable product; full parity is a later phase.
- **.NET-like CLI mandatory early**: `xytron new`, `restore` (SDK/engine
  download/cache), `run`, `build`, `test`, `publish`, `doctor`,
  `plugin new/build`. Syntax is product target, not working feature yet.
- Canonical docs: `docs/PRODUCT_VISION.md`,
  `docs/RELEASE_SCOPE_A.md`, `docs/EXECUTION_PLAN.md`,
  `docs/RELEASE_TEST_MATRIX.md`, `docs/ACCEPTANCE_CRITERIA.md`.
  See D-033 through D-036 in `docs/DECISIONS.md`.
- Keep verified Linux CEF, Windows CEF and Windows WebView2 plugin E2E
  runs as foundation, **not product completion**; Draft PR #7 only,
  `main` unchanged, release/merge subject to explicit approval.

## 2026-10-13 approved product direction: Scope A (read first)

- **Approved by project owner:** first completion target is a **usable SDK in existing native Windows/Linux apps** — not merely Core + Plugin SDK.
- Required: origin/capability security; minimal Win32 and GTK3 real host examples; Linux CEF / Windows CEF+WebView2 with actual plugin objects; distributable/relocatable engine SDK; install/quickstart/negative CI tests.
- Priority: security at native dispatch with default-deny external/iframe → Win32/GTK3 thin embedding → engine-inclusive SDK packaging → full clean-environment acceptance.
- Canonical plan: `docs/RELEASE_SCOPE_A.md`, `docs/EXECUTION_PLAN.md`, `docs/RELEASE_TEST_MATRIX.md`, `docs/ACCEPTANCE_CRITERIA.md`.
- Existing core+3-engine E2E passes remain valid **foundation evidence only**, not release completion. No `main` merge/public release until specifically approved.
- Other formal host adapters, full Desktop API parity, advanced CLI services,
  full Python/C# wrapper parity, Sidecar and advanced binary are deferred;
  **minimum CLI and Python/C# wrappers plus plugin callbacks are required**.

## 2026-10-13 verified GitHub integration checkpoint (read first)

- Canonical development branch: `nativeweb/autonomous-integration`, Draft PR [#7](https://github.com/nssang00/chatgpt-write-test/pull/7); source ZIP has been synchronized. Keep `main` unchanged until explicit merge approval.
- Verified source commit: `b2f1ced3e59cd1ba77bbb912f336d889e692ecad`. Browser plugin E2E [38322633033](https://github.com/nssang00/chatgpt-write-test/actions/runs/38322633033) PASSED on Linux CEF, Windows CEF (full parallel all-target build), and Windows WebView2. This is real JS/native plugin lifecycle execution, not a mock.
- Same commit: Linux/Windows Core Regression [38322632990](https://github.com/nssang00/chatgpt-write-test/actions/runs/38322632990) SUCCESS, Installed Core SDK Consumer [38322633018](https://github.com/nssang00/chatgpt-write-test/actions/runs/38322633018) SUCCESS, Platform Smoke [38322632977](https://github.com/nssang00/chatgpt-write-test/actions/runs/38322632977) SUCCESS.
- Local latest plugin source: Linux C++11 Release 21/21; AddressSanitizer full 21/21; Release full suite ×10 = 210 passes; plugin object factory / WebView facade / async lifetime ×40 each = 120 passes.
- NW-002/NW-007/NW-008/NW-009 browser CI blockers are resolved, details retained in `docs/ISSUE_LOG.md`. Windows CEF extraction now uses 7-Zip (small offline fixture + pinned archive SHA check), with shared runtime asset copies serialized in CMake.
- This is **not product release completion**. Remaining release gates include a default-deny capability/permission security policy and tests, plugin-owned events/listeners, cross-engine SDK/runtime distribution packaging, and broader planned Desktop integration features.
- Next: first tackle the security capability/permission default and browser-origin boundaries; keep the Draft PR and only request user approval for incompatible API/behavior decisions or final merge/release.

## 1. 프로젝트 한 줄 정의

**NativeWeb은 기존 native application과 C/C++ 자산을 유지하면서 UI를 Web 기술로 만들 수 있게 하는 desktop runtime/platform이다.**

핵심 메시지:

- Modern Web UI for native applications.
- Keep your native backend. Build your UI with the Web.
- Build a DLL/SO. Drop it into the app. Call it from the Web.

Electron 복제품이나 GUI toolkit이 목표가 아니다.

## 2. 반드시 지킬 제품 원칙

1. **Simple things must be simple.**
2. **Advanced things must be possible.**
3. **Advanced features must not leak into the beginner experience.**
4. 기본값으로 바로 성공해야 한다. 전문가는 필요할 때만 engine, permissions, session, IPC 등의 세부 설정으로 내려간다.
5. 기존 native code를 Web UI 때문에 다시 작성하도록 강요하지 않는다.
6. Host layer는 framework가 아니라 얇은 adapter/control이다.
7. public API에서 CEF/WebView2 implementation detail을 노출하지 않는다.
8. JavaScript 기본 DX는 `xytron.foo()` direct API이고 `invoke()`는 primitive/migration API다.
9. JS -> C++ user callable은 기본적으로 runtime-managed worker pool에서 실행한다.
10. Binary의 안전한 기본 semantics와 Transfer/Shared ownership semantics를 분리한다.
11. 새 기능은 테스트 없이 완료로 간주하지 않는다.
12. 버그는 가능하면 먼저 재현 테스트를 추가한 뒤 수정한다.
13. C++ public baseline은 **C++11**이다.

## 3. 핵심 사용자

우선순위가 높은 사용자는 다음과 같다.

- 기존 C/C++ desktop application 개발자
- MFC / WinForms / WPF / Qt / GTK 앱을 점진적으로 modern Web UI로 바꾸려는 팀
- Camera / Sensor / Serial / CAN / Modbus / CUDA / Codec / CAD / GIS / DB / Vendor SDK 등 native 자산이 많은 팀
- Electron을 쓰지만 Node native addon / IPC / packaging에 부담을 느끼는 팀
- Web frontend는 유지하면서 native backend 성능과 기존 library 재사용이 필요한 팀

## 4. 현재 확정된 큰 구조

```text
Web UI
HTML / CSS / JS / React / Vue / Svelte
            |
         Web SDK
            |
      NativeWeb Bridge
            |
+-------------------------------+
| NativeWeb Core                |
| WebView / Any / Async         |
| Events / Objects / Binary     |
| Permissions / Plugin manager  |
+-------------------------------+
            |
      Browser Backend
       /           \
     CEF         WebView2
            |
        Host Layer
Win32 / MFC / WinForms / WPF / Qt / GTK
```

다른 언어/프로세스 연결:

```text
NativeWeb Core
   |
   +-- in-process C/C++
   +-- stable C ABI plugin (.dll/.so)
   +-- .NET wrapper
   +-- Rust/C/Python wrappers
   +-- sidecar process (Python/Node/Go/Java/.NET/Rust...)
```

상세 내용은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 읽는다.

## 5. API 방향

상세 계약은 [docs/API_CONTRACT.md](docs/API_CONTRACT.md)를 따른다.

### 5.1 JavaScript API priority

Recommended:

```js
await xytron.getUser(42);
await xytron.apple.add(1, 2);
await xytron.camera.open();
```

Primitive / Electron migration:

```js
await xytron.invoke("getUser", 42);
```

real CEF에서 `xytron.*` direct facade와 `xytron.invoke()` primitive compatibility가 모두 검증되어 있다. 내부 `native.*` raw bridge는 구현 detail/compatibility layer로 유지한다.



초보자 기본 경험:

```cpp
nativeweb::WebView webview;
webview.create(parentHandle, "index.html");

webview.bind("math.add", [](int a, int b) {
    return a + b;
});
```

```js
const result = await xytron.math.add(3, 4);
```

Root C++ object:

```cpp
webview.bind("apple", new Apple())
    .method("add", &Apple::add)
    .method("sub", &Apple::sub);
```

```js
await xytron.apple.add(1, 2);
```

범용 migration/primitive API도 제공:

```js
const result = await xytron.invoke("math.add", 3, 4);
```

Factory-returned native object:

```js
const camera = await xytron.camera.open("CAM-01");
await camera.start();
const frame = await camera.capture();
```

## 6. Host layer 원칙

Host layer는 절대 또 하나의 application framework가 되어서는 안 된다.

기준:

- MFC: Visual Studio 기본 MFC wizard 프로젝트 + `CWebViewCtrl` 몇 파일
- WinForms: 기본 WinForms 프로젝트 + `WebViewControl`
- WPF: 기본 WPF 프로젝트 + `<native:WebView />`
- Qt: 기존 `QWidget/QMainWindow`에 `NativeWebView` 추가
- GTK: 기존 window에 NativeWeb widget 추가
- Win32: 기존 HWND에 WebView 생성

Host layer가 하는 일은 parent/native handle 전달, resize/focus/lifecycle 연결 정도다.
CEF handler, bridge, IPC, serialization 로직은 Host layer에 두지 않는다.

## 7. Browser engine 정책

사용자 기본값은 항상:

```text
engine = auto
```

전문가용 선택:

```bash
xweb engine list
xweb engine status
xweb engine use cef
xweb engine use webview2
```

현재 방향:

- Linux 기본: Managed CEF
- Windows 기본 후보: WebView2
- Windows에서도 reproducibility/fixed Chromium이 필요하면 CEF 선택 가능
- public type은 항상 `nativeweb::WebView`
- CEF/WebView2 전용 기능은 capability check로 노출

선택된 CEF 버전:

```text
144.0.36+g78619fd+chromium-144.0.7559.264
```

CEF binary 자체를 repository에 commit하지 않는다. GitHub Actions와 개발 bootstrap은 pinned distribution을 `tools/cef/bootstrap_linux.sh`로 내려받고 SHA1을 검증한 뒤 versioned cache/extract directory에서 사용한다. 현재 Linux real CEF integration은 GitHub Actions에서 실제 통과했다.

## 8. Any / Value 정책

사용자가 제공한 기존 `Any.h`를 canonical public/native dynamic type으로 사용한다.

기본 형태:

```cpp
VariantDict = std::map<std::string, Any>
VariantList = std::vector<Any>
```

public `WebView::execute()` / binding API는 가능한 한 이 타입 체계를 유지한다.

현재 저장소의 `include/nativeweb/Any.h`는 사용자가 제공한 원본을 기준으로 한다. 현대 compiler 호환을 위해 legacy MSVC `type_info` typedef를 조건부 처리하고 `<stdexcept>`를 명시적으로 include했다. 또한 초보자 친화적인 `obj["key"]` / `list[0]` 사용이 GCC/MSVC에서 모호하지 않도록 `const char*` key와 `int` index overload를 추가했다.

## 9. Plugin 핵심 방향

ROS2 pluginlib와 비슷한 사용 경험을 목표로 하되 Web binding까지 연결한다.

사용자 경험:

```text
legacy SDK
    |
tiny NativeWeb C++ adapter
    |
camera.dll / libcamera.so
    |
plugins/ 에 배치
    |
native.camera.* 로 Web에서 호출
```

개발자에게는 편한 C++ API/macros를 제공하지만 **DLL/SO binary boundary는 stable C ABI**로 설계한다.

예상 사용 형태:

```cpp
NATIVEWEB_PLUGIN_BEGIN("camera")

bind("open", ...);
bind("capture", ...);

NATIVEWEB_PLUGIN_END()
```

장기적으로 TypeScript definition 생성과 plugin inspect CLI를 제공한다.

## 9.1 Callable / plugin 참고 구현 검토 결론

상세: [docs/CALLABLE_PLUGIN_DESIGN.md](docs/CALLABLE_PLUGIN_DESIGN.md)

검토한 계열:

- PothosCore Callable / Plugin
- ROS class_loader / pluginlib
- Qt QLibrary / QPluginLoader
- Boost.DLL
- POCO SharedLibrary / ClassLoader

채택 방향:

- 현재 `bind()`, object `.method()`, `execute<T>()`, `xytron.foo()` API는 유지
- 내부에 `Callable + SignatureMetadata` 도입
- `Any`와 native object identity는 분리 유지
- registration ownership을 내부 RAII token으로 추적
- plugin callable/object/task가 PluginModule lifetime을 잡도록 설계
- plugin binary boundary는 versioned stable C ABI
- low-level SharedLibrary는 작고 dependency-free하게 유지
- 초기 plugin unload는 보수적으로 운영하고 unsafe hot unload를 강제하지 않음
- static-global registration은 stable ABI mechanism으로 사용하지 않음
- plugin metadata를 TS generation / inspect / permissions에 재사용

이 검토는 public beginner API 변경이 아니라 내부 foundation 강화다.

## 10. Electron / Tauri에서 가져갈 것

가져갈 것:

- Electron의 풍부한 desktop API와 익숙한 이름
- Electron의 Chromium 일관성을 선택할 수 있는 배포 모델
- Tauri의 invoke/Promise 단순성
- Tauri의 capability/security 철학
- Web frontend 재사용
- 작은/얇은 native bridge 개념

보완할 것:

- Node/Rust를 backend 필수 언어로 강제하지 않음
- command string API만 제공하지 않고 typed/object API 제공
- permission 설정은 안전하되 쉽게
- system WebView만 강제하지 않음
- 기존 MFC/WinForms/WPF/Qt/GTK app embedding을 first-class로 지원
- native binary/object/large data를 first-class로 지원

## 11. Desktop API 목표

초기/중기 공식 API 후보:

```text
invoke / events

app
window
webview

dialog
clipboard
shell
fs
path
process

notification
menu
tray
shortcut
screen

session
cookies/cache
protocol
singleInstance

updater
secureStorage
power
capture
```

모두 처음부터 구현한다는 뜻은 아니다. 우선순위는 ROADMAP을 따른다.

## 12. 현재 저장소에서 실제로 완료된 것

### GitHub Actions platform smoke

`.github/workflows/platform-smoke.yml`

- `ubuntu-latest`
- `windows-latest`
- C++11
- CMake configure
- build
- CTest

최초 검증 run:

```text
Workflow: Platform Smoke
Run ID: 37597876713
Head SHA: c253803db28f0047128a4723a2e82862a26f7bf7
Result: success
Ubuntu: success
Windows: success
```

현재 smoke source:

```text
ci/smoke/
  CMakeLists.txt
  main.cpp
```

### 추가로 완료된 Core/API baseline

- root CMake project skeleton
- 사용자 원본 기반 `include/nativeweb/Any.h`
- `nativeweb::Binary` / `NativeWindowHandle` public types
- Any / VariantList / VariantDict / nested value / binary / invalid-access regression
- C++11 typed bind adapter: ordinary lambda -> `DynamicFunction(VariantList -> Any)`
- typed pending result: RequestId가 `std::promise<T>/std::future<T>`를 직접 resolve/reject하며 호출당 변환용 `std::async` thread를 만들지 않음
- `nativeweb::WebView` pImpl public API shape 및 typed `execute<Result>()` adapter
- public `WebView::Impl` orchestration: BridgeRuntime + BrowserBackend factory/registry
- `Engine::Auto / Cef / WebView2` selection contract
- public engine capability API (`webview.capabilities().supports(...)`)
- optional `WebViewListener` lifecycle callbacks
- public API compile regression
- engine-independent internal `BrowserBackend` / listener contract
- structured `nativeweb::Error(code, message)`
- monotonic request IDs + thread-safe PendingCallRegistry
- resolve/reject/rejectAll contract using `std::promise/std::future`
- destroy contract baseline: `webview_destroyed` rejection for every pending call
- thread-safe ObjectRegistry: `shared_ptr<T> -> opaque ObjectId -> typed lookup/release`
- NativeObjectRuntime + public `NativeObjectHandle`
- `WebView::addObject / bindObjectMethod / releaseObject`
- EventDispatcher + subscribe/unsubscribe
- structured bridge request/response/error/event envelope
- BridgeRuntime method registry, outbound calls, inbound routing, events, shutdown
- process-wide bounded WorkerPool/TaskQueue
- JS -> C++ bound callable의 worker-pool 기본 실행 및 real concurrency 검증
- `xytron.foo()` dotted direct facade + `xytron.invoke()` compatibility
- root/singleton object binding: `webview.bind("apple", new Apple()).method(...)`
- raw-pointer root binding은 ownership을 NativeWeb으로 이전하며 shared_ptr overload도 제공
- Windows + Ubuntu Core Regression is green

### Linux real CEF baseline

Pinned CEF:

```text
144.0.36+g78619fd+chromium-144.0.7559.264
```

실제로 완료/검증된 항목:

- pinned archive download + SHA1 validation
- extracted runtime cache
- upstream CEF Linux smoke
- `CefExecuteProcess` / `CefInitialize` multi-process bootstrap
- internal `CefBackend` behind `BrowserBackend`
- renderer V8 injection of `native.invoke`, `native.on`, `native.off`
- Any <-> CefValue/V8 conversion
- JS -> C++ typed lambda invocation
- C++ return -> JS Promise resolve
- C++ exception -> JS Promise reject
- unknown native method -> Promise reject
- JS Object -> VariantDict -> JS Object
- JS Array -> VariantList -> JS Array
- native Binary -> renderer ArrayBuffer / JS Uint8Array view
- reload 후 bridge reinjection/reconnect
- C++ -> synchronous JavaScript function -> C++ future
- C++ -> async JavaScript Promise -> C++ future
- JavaScript Promise reject -> `nativeweb::Error`
- C++ event -> JS callback
- V8 context release 시 pending renderer state / event subscriptions 정리
- CEF runtime directory 실행과 ICU/resources layout 검증
- public `WebView.bind/execute/emit` 경로로 real CEF end-to-end 검증
- `engine=cef` factory 선택 및 capabilities 검증
- real CEF multi-WebView isolation
- renderer event subscription을 browser/context별로 격리
- 실제 JS unresolved Promise가 pending인 상태에서 `WebView::destroy()` 시 C++ future가 `webview_destroyed`로 종료
- native object handle -> JS Proxy-like object
- JS object method -> C++ object method 호출
- native object handle을 JS -> C++ 인자로 round-trip
- `dispose()` -> native lifetime release
- release 후 object method 호출 -> `native_object_not_found`
- `xytron.math.add()` / nested dotted direct facade
- `xytron.invoke()` primitive compatibility
- JS -> C++ user callable이 CEF browser/UI thread가 아닌 worker pool에서 실행
- `Promise.all()` native calls의 실제 병렬 overlap
- C++ root object `apple` 등록 후 `xytron.apple.add/sub/name()` real CEF 호출
- C++ -> JS typed future가 RequestId-correlated typed promise로 직접 완료

Latest full verified feature baseline:

```text
Feature head: a0f5390990c941b7153db6849fda142b9694e4f0

NativeWeb CEF Bridge: 37764512272  SUCCESS
Core Regression:       37764512413  SUCCESS
Platform Smoke:        37764512261  SUCCESS
```

직전 CEF build failure `37698537108`의 원인은 worker-pool 도입 시 별도 CEF test target에 `worker_pool.cpp`와 `Threads::Threads`가 누락된 것이며, `9da113f12530dc41191258b7578405900c2f8cc3`에서 수정되어 이후 real CEF가 green이다.

첫 real CEF vertical-slice success는 run `37637283494`, head `d1e9e823f2f7e3ed06c0fd93b32270f3922085b5`였다.

### Windows real WebView2 baseline

Pinned WebView2 SDK:

```text
Microsoft.Web.WebView2 1.0.4258.31
```

실제로 완료/검증된 항목:

- Win32 parent HWND -> WebView2 controller
- document-created bridge injection
- WebMessage JSON -> canonical Any/bridge envelope
- `xytron.foo()` direct facade
- `xytron.invoke()` primitive compatibility
- object/array/binary conversion
- JS -> C++ worker-pool execution + concurrent overlap
- C++ -> JS sync function / async Promise / Promise rejection
- events
- reload reconnect
- native object Proxy lifecycle
- root C++ object binding
- pending C++ future rejection on WebView destroy
- real two-WebView isolation
- `Engine::Auto` resolves WebView2 on Windows when the real runtime is available
- factory registration is gated by actual Evergreen Runtime availability

Latest verified WebView2 baseline:

```text
Feature head: aaa22a5f4e53923836a300a4213a8308cdeab213
NativeWeb WebView2 Bridge: 37787721031 SUCCESS
Core Regression:            37787721138 SUCCESS
Platform Smoke:             37787721167 SUCCESS
```

### 아직 완료되지 않은 것

- security permission/capability policy
- larger binary/shared-memory transport
- Windows WebView2/CEF engine-switch regression
- Host adapters
- native object/module lifetime coupling
- queued/running task/module lifetime regression
- plugin descriptor runtime/capability metadata
- C++ NATIVEWEB_PLUGIN convenience wrapper
- overload-selection helper / stable plugin type IDs
- sidecar runtime
- CLI
- Code - OSS compatibility experiment

## 13. 다음 작업 우선순위

가장 먼저 해야 할 일:

1. 최신 Core/Linux CEF/Windows CEF/WebView2 Regression이 green인 상태를 항상 유지한다.
2. plugin-created native object를 C ABI v1-compatible extension으로 표현하고 ObjectRegistry owner lease와 연결한다.
3. real DLL/SO object factory -> JS/native handle -> release까지 module lifetime regression을 추가한다.
4. conservative unload / `plugin_busy` policy를 정의한다.
5. runtime/capability/permission plugin descriptor를 확장한다.
6. Windows에서 WebView2/CEF engine-switch regression을 추가한다.
7. security permission/capability policy skeleton을 추가한다.
8. TransferBuffer / SharedBuffer를 기본 Binary와 분리된 advanced API로 추가한다.
9. TypeScript/codegen metadata를 Callable signature 위에 확장한다.

세부 단계는 [docs/ROADMAP.md](docs/ROADMAP.md)를 따른다.

## 14. 회귀 테스트 baseline

최소 계약:

1. JS → C++ int/string
2. JS Object → C++ VariantDict
3. JS Array → C++ VariantList
4. C++ → JS
5. C++ return → Promise resolve
6. C++ exception → Promise reject
7. `std::future` async
8. binary → `Uint8Array`
9. 두 WebView가 독립 동작
10. reload 후 bridge reconnect
11. destroy가 pending call을 안전하게 종료
12. invalid method/args 처리

상세 정책은 [docs/TESTING.md](docs/TESTING.md)를 읽는다.

## 15. 새 세션 시작 절차

새 세션에서는 다음 순서로 읽는다.

1. `HANDOFF.md`
2. `README.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DECISIONS.md`
5. `docs/TESTING.md`
6. `docs/ROADMAP.md`

그리고 GitHub Actions와 repository HEAD를 확인한다.

### 새 세션이 절대 추측하면 안 되는 것

- CEF archive가 이미 추출/통합되었다고 가정하지 않는다.
- Any.h를 새 Value type으로 임의 교체하지 않는다. 현재 committed Any.h를 기준으로 확장한다.
- Linux CEF integration, public WebView orchestration, multi-WebView, destroy-pending, native object Proxy vertical slice는 실제로 통과했다.
- Windows WebView2 backend도 real GitHub Actions에서 동일 bridge HTML과 multi-WebView isolation을 실제 통과했다.
- Windows CEF backend도 real GitHub Actions에서 동일 CEF contract suite를 실제 통과했다.
- browser backend 완료 여부는 항상 최신 Actions run으로 재확인한다.
- placeholder 제품명/CLI 이름을 최종 브랜드로 간주하지 않는다.

## 16. 작업 종료 시 handoff 갱신 규칙

의미 있는 작업이 끝날 때마다 이 문서를 갱신한다.

최소 갱신 항목:

- 실제 완료된 기능
- 마지막으로 통과한 CI
- 실패 중인 테스트/known issue
- 새로 확정된 architectural decision
- 바로 다음 작업
- 외부 입력/파일이 필요한 blocker

**대화가 아니라 repository가 source of truth가 되도록 유지한다.**


### Callable foundation implementation baseline

Public API는 변경하지 않았다.

계속 동작하는 형태:

```cpp
webview.bind("math.add", [](int a, int b) {
    return a + b;
});

webview.bind("apple", new Apple())
    .method("add", &Apple::add)
    .method("sub", &Apple::sub);
```

내부 구현:

```text
typed C++ callable
      ↓
Callable
 ├─ DynamicFunction-compatible opaque invoke
 └─ CallableSignature
      ↓
BindingRegistry
      ↓
BridgeRuntime / WorkerPool
```

완료된 항목:

- free function/lambda/member/const-member callable metadata
- known bridge types: void/bool/integer/number/string/list/dict/binary/native-object
- root object method가 public JS argument signature만 노출
- 기존 DynamicFunction primitive compatibility 유지
- BindingRegistry를 BridgeRuntime의 method storage에서 분리
- permanent application binding 유지
- move-only RegistrationToken
- generation-aware release: 오래된 token이 같은 이름의 새 binding을 제거하지 못함
- Windows/Linux Core regression
- Linux CEF / WebView2 browser regression에서 기존 public API 변화 없음

### SharedLibrary foundation

Qt QLibrary / Boost.DLL / POCO SharedLibrary에서 필요한 최소 low-level 역할만 dependency-free internal abstraction으로 구현했다.

```text
SharedLibrary
  load(path)
  loaded()
  symbol(name)
  unload()
```

platform:

- Windows: LoadLibraryExW / GetProcAddress / FreeLibrary
- Linux: dlopen / dlsym / dlclose

실제 테스트 shared library를 CI에서 빌드한 뒤 symbol을 resolve/call한다.
missing library / missing symbol / move ownership / unload도 regression에 포함한다.

아직 SharedLibrary 성공만으로 Plugin SDK 완료라고 간주하지 않는다.
다음 단계는 PluginModule + versioned C ABI + real plugin registration/lifetime test다.


### Latest full verified callable/loader baseline

```text
Code head: cca3bc446e7023538a8928682780c7ac5952e892

Core Regression:              38018203881 SUCCESS
Linux CEF Bridge:             38018203880 SUCCESS
Windows CEF Bridge:           38018203913 SUCCESS
Windows WebView2 Bridge:      38018203918 SUCCESS
Platform Smoke:               38018203876 SUCCESS
```

이 baseline에서 기존 `bind()`, root `.method()`, `xytron.foo()`, worker concurrency, typed future, native object, multi-WebView contract는 유지된다.

추가로 검증된 foundation:

- Callable + signature metadata
- BindingRegistry
- generation-safe RegistrationToken
- real Windows DLL / Linux SO SharedLibrary load/symbol/unload


### PluginModule / C ABI v1 verified baseline

현재 이것은 **plugin function-registration vertical slice**이며 최종 Plugin SDK 전체가 아니다.

구현:

- public C-compatible `include/nativeweb/plugin_abi.h`
- well-known entry point `nativeweb_plugin_init_v1`
- plugin id/version/ABI validation
- relative plugin API -> `<plugin-id>.<method>`
- null/bool/int32/double/string/binary synchronous value ABI
- plugin error -> structured `nativeweb::Error`
- PluginModule owns RegistrationToken list
- Callable owns strong PluginLibraryLease
- module teardown unregisters public methods before releasing its own lease
- retained/in-flight Callable can keep DLL/SO loaded after PluginModule teardown

실제 regression:

```text
valid plugin DLL/SO
  -> load
  -> init v1
  -> sample.add / sample.fail register
  -> invoke

bad ABI plugin
  -> plugin_abi_mismatch

plain shared library
  -> missing nativeweb_plugin_init_v1 rejection
```

Latest verified code head:

```text
b876a74726e33609d3603ec572c6c8d03ab592e8

Core Regression:          38107973666 SUCCESS (Ubuntu + Windows)
Linux CEF Bridge:         38107973658 SUCCESS
Windows CEF Bridge:       38107973662 SUCCESS
Windows WebView2 Bridge:  38107973704 SUCCESS
Platform Smoke:           38107973650 SUCCESS
```

Core regression의 `plugin.module`은 Ubuntu/Windows에서 실제 shared library를 빌드해 실행한다.

추가로 완료된 plugin/lifetime foundation:

- queued 상태의 worker task가 module teardown 뒤에도 copied Callable lease로 DLL/SO를 유지
- running 상태의 worker task가 module teardown 중에도 DLL/SO를 유지
- ObjectRegistry managed pointer가 object + optional owner lease를 함께 유지
- NativeObjectRuntime에 internal owner lease overload 추가
- C++ `Plugin / PluginApi` header-only wrapper
- `NATIVEWEB_PLUGIN(Type, "id")`가 stable C ABI v1 entry point를 export
- wrapper plugin의 int/string/binary/error mapping을 실제 Windows DLL/Linux SO로 검증
- CEF multi-WebView coordinator를 worker concurrency에 맞게 thread-safe하게 보강

남은 plugin 핵심:

1. C ABI에서 plugin-created native object handle/factory를 표현하고 real object/module lifetime을 검증
2. plugin-owned events/listeners
3. runtime/capability/permission descriptor
4. safe unload state / `plugin_busy`
5. explicit overload helper
6. TS metadata generation

## 18. 2026-10-12 plugin object methods and safe unload update

Supersedes the *pending* statuses for object factories and conservative unload
in sections 13–16 above. Detailed contract: `docs/PLUGIN_OBJECT_LIFETIME.md`.

- ABI v1 has optional `register_object_factory` **and** `register_object_method`
  append-only host fields, checked by `struct_size`.
- Actual Linux SO plugin object methods (add/value/error/slow call), object
  ownership, concurrent release, and conservative explicit unload are covered
  by `plugin.object_factory`.
- `plugin.module` covers retained callables, dynamicFunction extraction, and
  worker-pool queued calls during quiesce/unload.
- Linux C++11 build and 19/19 CTest regression tests passed locally.
- New changes are not verified in Windows/CEF/WebView2 CI.
- Next: connect plugin manager/factories to WebView object runtime and test
  `xytron.*` object creation in real browser; plugin method dispatch/runtime
  is ready but the WebView exposure path remains pending.

## 2026-10-13: WebView plugin facade integration (local package)

- Added `WebView::loadPlugin(path)` to register C ABI plugin functions on the WebView's bridge registry.
- Added `WebView::bindPluginFactory(method, pluginId, relativeType)` to expose a zero-argument plugin object factory to `xytron.<method>()`. Results are `NativeObjectHandle`, already serialized into JS object proxies by the existing CEF/WebView2 bridge.
- Added `WebView::createPluginObject(pluginId, relativeType)` and `WebView::unloadPlugin(pluginId)`, with existing `plugin_busy` semantics.
- `plugin.webview_facade` regression covers module load, factory binding, live-object busy unload, release, successful unload.
- Linux C++11: 20/20 CTest passed. Browser/Windows end-to-end not yet run.
- LIMITATIONS: C ABI v1 factories have zero arguments; `camera.open("CAM-01")` requires an ABI extension. Plugin manager operations must currently be serialized by the embedding application (not thread-safe). Duplicate plugin IDs discovered after construction need preflight validation before production use. Real CEF/WebView2 browser invocation still needs E2E tests.

### Continuation: argument-aware object factories (2026-10-13)

- Added size-gated `nw_host_api_v1::register_object_factory_args` with C ABI
  `nw_plugin_create_object_args_v1`; older zero-argument factory callbacks remain valid.
- `PluginModule::createObject` and `WebView::createPluginObject` accept optional
  `VariantList` arguments; factory bindings forward JS arguments.
- Serialized `WebView` plugin-manager operations with `pluginsMutex_`.
- Extended shared-library regression fixture for argument-aware factory
  creation and argument errors. Linux C++11 build + CTest 20/20 passed.
- Remaining: pre-registration duplicate-ID validation, callback lifetime
  hardening, actual CEF/WebView2 browser E2E and Windows DLL CI.


### Continuation: duplicate ID and async callback lifetime (2026-10-13)

- `PluginModule` accepts a host-side ID pre-registration validator. `WebView`
  checks duplicate IDs under `pluginsMutex_` after `init`/descriptor validation
  but before `register_api()` can overwrite existing bridge bindings.
- WorkerPool callbacks for `__native_object.call`, `__native_object.release`
  and bound plugin factories own a shared `ObjectBridgeState`; none holds a raw
  `WebView::Impl*`. Closing it prevents late object creation; in-flight native
  methods retain object and plugin-library leases.
- Added `plugin.async_lifetime` regression with fake browser, destroying a
  `WebView` during a slow SO method and while a slow SO factory is active.
  `plugin.webview_facade` also checks duplicate registration count and
  competing multi-threaded loads.
- Linux C++11 CTest: 21/21 passed (locally, no browser engines).
- Still TODO: real CEF/WebView2 JS E2E, Windows DLL build/CI, stress/sanitizer
  verification across platforms, plugin-owned background threads and events.
- This is a **local ZIP source snapshot**, not a new upstream Git commit.
  `SNAPSHOT_SHA.txt` refers to the original upstream baseline only.

### Continuation: real-browser plugin object E2E harness (2026-10-13)

- Added `--plugin-path=<SO-or-DLL>` to both existing CEF and WebView2 browser
  integration executables; in this mode a real plugin is loaded before the
  browser initializes, and JS-facing factory + busy/unload checks are bound.
- Added shared `tests/integration/cef/plugin_bridge_test.html` page for
  argument-aware creation, methods, structured errors, busy/quiesce,
  disposal, and final unload.
- Standalone CEF/WebView2 integration CMake builds a real shared-library
  fixture from `tests/plugin/object_factory_plugin.cpp`, and exposes the
  `browser.plugin_object_lifecycle` CTest target.
- Added a cross-platform runner `tools/run_browser_plugin_e2e.py`, which
  requires actual binaries and expected checkpoints; see
  `docs/BROWSER_PLUGIN_E2E.md`.
- This local environment does not contain an extracted CEF SDK nor a Windows
  WebView2 runtime, so browser E2E is **not claimed as passing** here.
- Next: run E2E on existing Linux/Windows CEF and Windows WebView2 CI runners
  with real SDKs, review any engine-specific failures, and add Windows DLL
  diagnostics/stress coverage.
- Included `.github/workflows/browser-plugin-e2e.yml` (Linux CEF, Windows CEF,
  Windows WebView2) with pinned SDK bootstraps and browser CTest execution.
  The new workflow has not been run on GitHub; do **not** mark CI green yet.

### 2026-10-13: Autonomous execution and Release-regression repair

- Adopted `docs/EXECUTION_PLAN.md`, `docs/ISSUE_LOG.md`, and `docs/ACCEPTANCE_CRITERIA.md`: log/triage failures, continue unrelated work, ask only for material approvals, keep `main` unchanged.
- Rebuilt latest ZIP in Linux C++11 **Release** and found 2/21 failing regressions (`plugin.object_factory`, `plugin.webview_facade`) because side-effecting `assert(...)` expressions disappeared under `NDEBUG`.
- Replaced `assert` with unconditional `NW_REQUIRE` in all three plugin regression files via `test_require.hpp`; Release build and CTest now **21/21 pass**, plugin tests repeated 10 times, plus Debug CTest 21/21, verified locally. Product runtime not modified by this repair.
- Outstanding: latest ZIP source still needs to be ported into GitHub development branch before actual browser CI, and CEF/WebView2 E2E remains unverified.

- GitHub integration tracking branch: `nativeweb/autonomous-integration`, draft PR #7 (docs-only at this stage; latest ZIP code not yet synced).
