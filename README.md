# NativeWeb

> **Modern Web UI for native applications.**

NativeWeb은 기존 C/C++ application과 native SDK를 유지하면서 UI를 HTML/CSS/JavaScript로 만들 수 있게 하는 desktop runtime/platform을 목표로 한다.

현재 저장소는 **Core runtime + Linux/Windows CEF + Windows WebView2 real browser integration 단계**다. Windows/Linux Core CI와 세 browser matrix가 GitHub Actions에서 실제 동작한다.

## Why

기존 native 자산을 Web UI에 연결하기 위해 불필요한 중간 wrapper/runtime을 강요하지 않는 것이 핵심이다.

```text
Typical Electron native path

Web UI
  -> Electron IPC
  -> Node.js
  -> N-API / native addon
  -> C/C++ SDK


NativeWeb target

Web UI
  -> NativeWeb Bridge
  -> C/C++ SDK
```

Python, Node.js, .NET, Rust, Go, Java 등이 더 자연스러운 경우에는 plugin 또는 sidecar로 함께 사용할 수 있다.

## Developer experience

초보자의 기본 경로는 단순해야 한다.

```cpp
nativeweb::WebView webview;
webview.create(parentHandle, "index.html");

webview.bind("math.add", [](int a, int b) {
    return a + b;
});

webview.bind("apple", new Apple())
    .method("add", &Apple::add)
    .method("sub", &Apple::sub);
```

```js
const result = await xytron.math.add(3, 4);
const sum = await xytron.apple.add(10, 20);
```

전문가는 필요할 때만 engine, permissions, session, plugin ABI, transport 같은 고급 기능으로 내려간다.

## Core principles

- **Simple things must be simple.**
- **Advanced things must be possible.**
- **Advanced features must not leak into the beginner experience.**
- Existing native code should not have to be rewritten just to get a modern Web UI.
- Public C++ baseline: **C++11**
- Feature completion = implementation + test + regression pass

## Browser engines

기본은 `auto`.

목표 backend:

- **CEF** — managed/fixed Chromium, Linux first-class, Windows supported
- **WebView2** — Windows system WebView option

Public code는 engine과 무관하게 `nativeweb::WebView`를 사용한다.

## Host layer

NativeWeb은 기존 GUI framework를 대체하지 않는다.

지원 목표:

- Win32
- MFC
- WinForms
- WPF
- Qt
- GTK

각 Host는 **기존 wizard/sample 프로젝트에 WebView control/widget 몇 파일을 추가하는 수준**을 유지한다.

## Native plugins

핵심 장기 기능:

> **Build a DLL/SO. Drop it into the app. Call it from the Web.**

ROS2 pluginlib와 비슷한 사용 경험을 목표로 하되, NativeWeb에서는 shared library가 곧 Web API namespace로 연결된다.

Developer-facing API는 C++답게 만들고, binary boundary는 stable C ABI를 사용한다.

## Current verified status

GitHub Actions에서 C++11 CMake/CTest smoke environment를 실제 검증했다.

| Environment | Status |
|---|---:|
| Ubuntu latest | ✅ |
| Windows latest | ✅ |

Initial verified workflow run:

- Workflow: `Platform Smoke`
- Run ID: `37597876713`
- Head SHA: `c253803db28f0047128a4723a2e82862a26f7bf7`

Any 기반 Core regression과 public API contract가 Windows/Ubuntu에서 통과한다. Linux CEF와 Windows WebView2 모두 public `WebView` API를 통한 실제 JS↔C++ bridge를 검증한다. 현재 공통 검증에는 `xytron.foo()` direct facade, `xytron.invoke()` compatibility, worker-pool 기반 JS→C++ 병렬 실행, RequestId 기반 typed C++ future, root C++ object binding, object/array/binary, reload, events, Promise/error mapping, multi-WebView isolation, destroy-pending, native object Proxy lifecycle가 포함된다.

Latest verified code head: `cca3bc446e7023538a8928682780c7ac5952e892`.

- Core Regression: `38018203881` — Ubuntu/Windows success
- NativeWeb CEF Bridge: `38018203880` — real Linux CEF success
- NativeWeb CEF Windows Bridge: `38018203913` — real Windows CEF success
- NativeWeb WebView2 Bridge: `38018203918` — real Windows WebView2 success
- Platform Smoke: `38018203876` — Ubuntu/Windows success

Callable/signature metadata와 generation-safe registration ownership이 기존 public API 변경 없이 들어갔고, Windows/Linux에서 실제 DLL/SO를 빌드해 `SharedLibrary` load/symbol/unload regression도 통과한다.

## Start here

새 세션이나 새 개발자는 **반드시 [HANDOFF.md](HANDOFF.md)부터 읽는다.**

문서:

- [Session handoff / current status](HANDOFF.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Architecture decisions](docs/DECISIONS.md)
- [Testing and CI](docs/TESTING.md)
- [Roadmap](docs/ROADMAP.md)
- [Target project structure](docs/PROJECT_STRUCTURE.md)
- [Contribution rules](CONTRIBUTING.md)

## Immediate next work

1. Windows WebView2/CEF engine-switch regression
2. PluginModule + stable versioned C ABI prototype
3. real DLL/SO plugin register/call/lifetime regression
4. security permission/capability policy
5. TransferBuffer / SharedBuffer advanced binary transport
6. Win32/MFC/WinForms thin host adapters
7. TypeScript/codegen metadata 확장
8. sidecar runtime prototype

## Repository note

이 저장소는 처음에는 ChatGPT ↔ GitHub 연결 기능 검증용으로 만들어졌기 때문에 과거 integration demo artifact가 일부 남아 있다. 현재부터는 NativeWeb 개발과 handoff 가능한 source-of-truth repository로 사용한다.
