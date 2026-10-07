# NativeWeb Roadmap

이 문서는 우선순위 문서다. 날짜 약속이 아니라 dependency와 개발 순서를 나타낸다.

## Phase 0 — Repository foundation

상태: **in progress**

- [x] GitHub repository write/read validation
- [x] Linux/Windows C++11 CMake/CTest smoke CI
- [x] Architecture/handoff documentation
- [ ] Root project/CMake skeleton
- [ ] Canonical user `Any.h` import
- [ ] Core regression workflow

완료 기준: 새 세션이 저장소만 보고 개발을 이어갈 수 있고, core tests를 Windows/Linux에서 반복 실행할 수 있다.

## Phase 1 — Core value/async/runtime

- [ ] Any/VariantList/VariantDict integration
- [ ] structured error model
- [ ] binary type
- [ ] async/future abstraction
- [ ] request IDs
- [ ] pending request registry
- [ ] object registry
- [ ] event primitive
- [ ] permissions/capability skeleton

완료 기준: browser 없이 core contracts를 unit test할 수 있다.

## Phase 2 — Public WebView API skeleton

- [ ] `nativeweb::WebView`
- [ ] create/destroy
- [ ] load/reload
- [ ] bind
- [ ] execute
- [ ] emit/event
- [ ] capabilities
- [ ] API compile regression on Windows/Linux

완료 기준: public API shape가 C++11에서 안정적으로 compile된다.

## Phase 3 — Linux CEF backend

Selected CEF:

```text
144.0.36+g78619fd+chromium-144.0.7559.264
```

- [ ] CEF package acquisition/install strategy
- [ ] multi-process bootstrap
- [ ] BrowserBackend implementation
- [ ] renderer bridge injection
- [ ] request/response transport
- [ ] Any <-> CEF value conversion
- [ ] events
- [ ] reload reconnect
- [ ] binary
- [ ] multi-WebView
- [ ] real GitHub Actions integration test

완료 기준: real CEF로 bridge baseline 전부 통과.

## Phase 4 — Windows browser backends

### WebView2

- [ ] WebView2 backend
- [ ] auto detection
- [ ] WebView2 integration contract tests

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

핵심 제품 차별화 단계.

- [ ] stable C ABI draft
- [ ] C++ wrapper
- [ ] plugin macro/export
- [ ] DLL/SO loader
- [ ] embedded metadata
- [ ] plugin namespace registration
- [ ] object/event/binary support
- [ ] ABI compatibility validation
- [ ] TypeScript declaration generation
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
