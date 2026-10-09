# NativeWeb Roadmap

이 문서는 우선순위 문서다. 날짜 약속이 아니라 dependency와 개발 순서를 나타낸다.

## Phase 0 — Repository foundation

상태: **complete**

- [x] GitHub repository write/read validation
- [x] Linux/Windows C++11 CMake/CTest smoke CI
- [x] Architecture/handoff documentation
- [x] Root project/CMake skeleton
- [x] Canonical user `Any.h` import
- [x] Core regression workflow

완료 기준: 새 세션이 저장소만 보고 개발을 이어갈 수 있고, core tests를 Windows/Linux에서 반복 실행할 수 있다.

## Phase 1 — Core value/async/runtime

- [x] Any/VariantList/VariantDict integration
- [x] structured error model
- [x] binary type
- [x] async/future abstraction
- [x] request IDs
- [x] pending request registry
- [x] object registry
- [x] event primitive
- [x] engine capability skeleton
- [ ] security permission/capability policy

완료 기준: browser 없이 core contracts를 unit test할 수 있다.

## Phase 2 — Public WebView API skeleton

- [x] `nativeweb::WebView` public pImpl shape
- [x] create/destroy declarations
- [x] load/reload declarations
- [x] dynamic bind contract
- [x] C++11 typed bind adapter
- [x] typed execute adapter
- [x] emit declaration
- [x] capabilities
- [x] public WebView Impl -> BrowserBackend orchestration
- [x] engine auto/CEF/WebView2 selection contract
- [x] API compile regression on Windows/Linux
- [x] engine-independent BrowserBackend contract

완료 기준: public API shape가 C++11에서 안정적으로 compile된다.

## Phase 2.5 — Public execution and JavaScript DX contract

- [x] RequestId / pending future baseline
- [x] structured request / response / error / event envelope
- [x] `xytron.foo()` direct JS facade
- [x] `xytron.invoke()` primitive compatibility test
- [x] runtime WorkerPool / TaskQueue
- [x] JS -> C++ default worker execution
- [x] concurrent/out-of-order JS call regression
- [x] remove per-call `std::async` from typed C++ -> JS future conversion
- [x] root/singleton native object binding API baseline
- [x] Binary vs Transfer vs Shared public semantics contract
- [ ] TransferBuffer implementation
- [ ] SharedBuffer implementation

상세 계약: [API_CONTRACT.md](API_CONTRACT.md)

## Phase 2.6 — Callable metadata foundation

Plugin SDK와 TypeScript generation 전에 공통 callable metadata layer를 만든다.

- [ ] `Callable` type-erasure
- [ ] `SignatureMetadata` (argument count/types + result type)
- [ ] existing free function/lambda bind parity
- [ ] member + const-member parity
- [ ] void / exception parity
- [ ] explicit overload-selection escape hatch
- [ ] current `bind()` public API unchanged
- [ ] root object `.method()` public API unchanged
- [ ] `RegistrationToken` / owner tracking

상세 설계: [CALLABLE_PLUGIN_DESIGN.md](CALLABLE_PLUGIN_DESIGN.md)

## Phase 3 — Linux CEF backend

Selected CEF:

```text
144.0.36+g78619fd+chromium-144.0.7559.264
```

- [x] CEF package acquisition/install strategy
- [x] multi-process bootstrap
- [x] BrowserBackend implementation
- [x] renderer bridge injection
- [x] request/response transport
- [x] Any <-> CEF value conversion
- [x] events
- [x] reload reconnect
- [x] binary
- [x] multi-WebView
- [x] real-browser destroy while C++->JS Promise is pending
- [x] native object handle / JS Proxy vertical slice
- [x] C++ -> JS synchronous call
- [x] C++ -> JS Promise result
- [x] JS Promise rejection -> C++ Error
- [x] real GitHub Actions integration test

완료 기준: real CEF로 bridge baseline 전부 통과.

## Phase 4 — Windows browser backends

### WebView2

- [x] WebView2 backend
- [x] runtime-aware auto detection
- [x] WebView2 integration contract tests
- [x] WebView2 multi-WebView isolation

### CEF Windows

- [ ] CEF Windows backend
- [ ] same contract suite
- [ ] engine switch test

완료 기준:

```text
Windows / WebView2
Windows / CEF
Linux   / CEF
```

가 가능한 한 동일 public API contract를 통과한다.

## Phase 5 — Thin host adapters

- [ ] Win32
- [ ] MFC
- [ ] WinForms
- [ ] WPF
- [ ] Qt
- [ ] GTK

각 sample은 framework 기본 wizard/sample project에 control/widget 몇 파일을 추가한 수준을 유지한다.

Host layer가 application framework로 커지면 설계를 다시 검토한다.

## Phase 6 — Desktop APIs

우선순위 A:

- [ ] app
- [ ] window
- [ ] webview
- [ ] dialog
- [ ] clipboard
- [ ] shell

우선순위 B:

- [ ] fs/path
- [ ] process
- [ ] notification
- [ ] menu/context menu
- [ ] tray
- [ ] global shortcut
- [ ] screen/DPI

우선순위 C:

- [ ] session/cookies/cache/proxy
- [ ] custom protocol
- [ ] single instance
- [ ] updater
- [ ] secure storage
- [ ] power
- [ ] capture

## Phase 7 — Plugin SDK

핵심 제품 차별화 단계. Phase 2.6 Callable metadata foundation을 재사용한다.

- [ ] small cross-platform SharedLibrary abstraction
- [ ] PluginModule + registration ownership
- [ ] stable versioned C ABI draft
- [ ] embedded plugin descriptor (id/version/ABI/runtime/capabilities)
- [ ] C++ wrapper
- [ ] `NATIVEWEB_PLUGIN` macro/export convenience
- [ ] plugin namespace registration
- [ ] callable/module lifetime coupling
- [ ] native object/module lifetime coupling
- [ ] queued/running task/module lifetime coupling
- [ ] conservative unload / plugin_busy policy
- [ ] real DLL Windows regression
- [ ] real SO Linux regression
- [ ] object/event/binary support
- [ ] ABI compatibility validation
- [ ] TypeScript declaration generation
- [ ] missing-dependency diagnostics
- [ ] `xweb plugin new/build/inspect`

장기:

- [ ] isolated plugin host process

## Phase 8 — Sidecar

- [ ] process lifecycle abstraction
- [ ] transport protocol
- [ ] restart/error handling
- [ ] typed request/response
- [ ] event stream
- [ ] binary/streaming
- [ ] example Python service
- [ ] example Node service
- [ ] example .NET/Rust service

## Phase 9 — CLI / developer experience

Working CLI name: `xweb` (final brand not fixed).

- [ ] `xweb new`
- [ ] `xweb run`
- [ ] `xweb build`
- [ ] `xweb test`
- [ ] `xweb publish`
- [ ] `xweb doctor`
- [ ] `xweb engine`
- [ ] `xweb permission`
- [ ] `xweb plugin`

`engine = auto`가 기본이다.

## Phase 10 — Code - OSS benchmark

NativeWeb의 Electron-scale compatibility/stress test.

- [ ] Code - OSS Web Workbench load
- [ ] keyboard/editor/WebWorker/WASM/WebGL
- [ ] filesystem/dialog/clipboard
- [ ] native window/menu services
- [ ] Node extension host as sidecar
- [ ] PTY/terminal
- [ ] extension compatibility investigation
- [ ] Electron shell dependency reduction

이 단계는 NativeWeb 1.0의 선행조건이 아니다.
