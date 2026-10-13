# NativeWeb

> **Modern Web UI for native applications.**

NativeWeb은 기존 C/C++ application과 native SDK를 유지하면서 UI를 HTML/CSS/JavaScript로 만들 수 있게 하는 desktop runtime/platform을 목표로 한다.

현재 저장소는 **Core/Plugin 런타임과 Linux/Windows CEF·Windows WebView2의 실제 브라우저 E2E를 통과한 기반 단계**다. 첫 완성 목표는 **보안, 최소 Win32·GTK3 Host Adapter, 엔진 포함 배포 패키지와 실사용 샘플까지 갖춘 SDK (승인된 Scope A)**이다. 기존 E2E 성공만으로 출시 완료로 판정하지 않는다.

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

현재 C++ convenience baseline:

```cpp
class CameraPlugin : public nativeweb::Plugin {
public:
    void registerApi(nativeweb::PluginApi& api) override {
        api.bind("open", ...);
        api.bind("capture", ...);
    }
};

NATIVEWEB_PLUGIN(CameraPlugin, "camera")
```

이 wrapper는 header-only이며 plugin DLL/SO가 NativeWeb Core에 직접 링크하지 않아도 된다.
macro 내부에서는 versioned `nativeweb_plugin_init_v1` C ABI entry point만 export한다.

## Current verified status

- Linux/Windows C++11 Core Regression: [CI 38322632990](https://github.com/nssang00/chatgpt-write-test/actions/runs/38322632990) — PASS.
- Real browser plugin object lifecycle: [CI 38322633033](https://github.com/nssang00/chatgpt-write-test/actions/runs/38322633033) — Linux CEF, Windows CEF and Windows WebView2 all PASS.
- Core SDK clean installed consumer: [CI 38322633018](https://github.com/nssang00/chatgpt-write-test/actions/runs/38322633018) — Linux/Windows PASS, **Core-only package**.
- Full Scope A1 security, Win32/GTK3 embedded hosts and engine-inclusive distribution are **not yet complete**.

First-deliverable scope and gates:
[Scope A](docs/RELEASE_SCOPE_A.md) ·
[Execution plan](docs/EXECUTION_PLAN.md) ·
[Release test matrix](docs/RELEASE_TEST_MATRIX.md) ·
[Acceptance criteria](docs/ACCEPTANCE_CRITERIA.md).

## Installed Core SDK (first packaging slice)

```sh
cmake -S . -B build-sdk -DNATIVEWEB_BUILD_TESTS=OFF -DCMAKE_INSTALL_PREFIX=/tmp/nativeweb-sdk
cmake --build build-sdk --config Release
cmake --install build-sdk --config Release
cmake -S examples/sdk_consumer -B build-consumer -DCMAKE_PREFIX_PATH=/tmp/nativeweb-sdk
cmake --build build-consumer --config Release
ctest --test-dir build-consumer -C Release --output-on-failure
```

The exported CMake target is `NativeWeb::Core`. This does not yet package
CEF or WebView2 engines. See [SDK packaging](docs/SDK_PACKAGING.md).

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

## Immediate next work — approved Scope A

1. Secure the JS-to-native boundary (trusted packaged app origin, native-side default deny, frame/navigation/method scopes).
2. Add real Win32 + GTK3 embedded host examples and lifecycle/plug-in E2E.
3. Package engine-backed relocatable SDK/runtime for clean Windows/Linux consumers; check redistribution notices.
4. Run the full acceptance matrix and prepare a candidate deliverable for explicit merge/release approval.

See [execution plan](docs/EXECUTION_PLAN.md) and [release gates](docs/ACCEPTANCE_CRITERIA.md).

## Repository note

이 저장소는 처음에는 ChatGPT ↔ GitHub 연결 기능 검증용으로 만들어졌기 때문에 과거 integration demo artifact가 일부 남아 있다. 현재부터는 NativeWeb 개발과 handoff 가능한 source-of-truth repository로 사용한다.
