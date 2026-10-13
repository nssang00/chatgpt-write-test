# NativeWeb

> **Modern Web UI for native applications.**

NativeWeb(Xytron)은 **Electron/Tauri형 데스크톱 앱 플랫폼**으로, **공통 네이티브 Core는 C/C++**, 실제 사용자 백엔드는 **C++·Python·C# 중 선택**한다. Electron처럼 OS 창·앱 메뉴·컨텍스트 메뉴를 제어하는 독립 실행 앱과 WebView2처럼 WPF·WinForms·MFC에 들어가는 컨트롤을 모두 제공하는 것이 목표다. HTML/CSS/JavaScript 프론트엔드와 C/C++ 앱을 결합해 **새 앱을 만들거나 기존 앱에 내장**할 수 있으며, Python은 LLM/AI 앱의 실제 백엔드, C#은 레거시 .NET 앱의 실제 백엔드가 될 수 있으며 공식 wrapper도 제공한다.

확정된 제품 요구사항: [독립 앱 셸·호스트 컨트롤·언어 백엔드 계약](docs/PRODUCT_MODES_AND_BACKENDS.md). 아직 이 셸/언어/컨트롤 기능은 구현 또는 검증 완료가 아니다.

현재 저장소는 **Core/Plugin 런타임과 Linux/Windows CEF·Windows WebView2의 실제 브라우저 E2E를 통과한 기반 단계**다. 첫 완성 목표에는 **보안, CLI 새 프로젝트 생성/다운로드/빌드/실행/배포, 양방향 플러그인 콜백, Python·C# 최소 wrapper, Win32·GTK3 Host Adapter, 엔진 포함 배포**를 포함한다 (승인된 Scope A). 기존 E2E 성공만으로 출시 완료로 판정하지 않는다.

## Main Backend, Modules, Plugins

- **One Main Backend** (cpp/python/csharp) is the application's logical
  main Module; **0..N additional Modules** may implement features in
  ANY of these languages simultaneously.
- **Plugin = independently packaged/loaded Module**. C++ DLL/SO plugin
  authoring is a primary convenience path, with reverse JS callbacks.
- JavaScript `xytron.camera.capture()` calls the same API whether
  its Module implementation is C++, Python or C#. The app-scoped Core
  registry handles discovery, routing, permissions and lifetimes.
- [Full architecture and testcases](docs/MODULE_ARCHITECTURE.md)

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

**Python 및 C#/.NET**은 실제 앱 백엔드를 작성하는 공식 선택지이며 래퍼 API도 제공한다 (현재 구현/검증 전). Python/.NET을 Core wrapper만으로 처리하지 않으며 실제 앱 백엔드 코드도 작성할 수 있도록 한다. Node/Rust 등의 별도 프로세스 Sidecar는 고급 선택지다.

## CLI-first development experience (planned)

The `xytron` UX is a **required product goal**. The commands below are
**target syntax, not yet working commands**:

```sh
xytron new desktop hello --backend cpp
cd hello
xytron restore
xytron run
xytron build --configuration release
xytron test
xytron publish --runtime win-x64
xytron plugin new camera --language cpp
xytron plugin build camera
xytron doctor
```

The CLI manages pinned engine/SDK dependencies and a reproducible manifest;
manual CEF/WebView2 archive assembly is not the default user experience.
See [product vision](docs/PRODUCT_VISION.md).

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

핵심 제품 기능:

> **Build a DLL/SO. Call native from JS, and call JS back from native.**

플러그인 소유 콜백/이벤트의 **완성은 아직 미검증**이며, 첫 완성본에 포함하는 필수 작업이다.

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

## Immediate next work — product-aligned

1. Secure native dispatch boundary; cross-origin/iframe/method negative tests.
2. Implement C++ DLL/SO plugin-to-JavaScript callback/event lifetime path.
3. Create minimum xytron CLI for new/restore/run/build/test/publish, plugin new/build.
4. Add greenfield desktop app and Win32/GTK3 embedded host E2E.
5. Build initial Python/C# official wrapper smoke tests.
6. Distribute engine-inclusive runtime SDK, test clean installs and publish.

See [product vision](docs/PRODUCT_VISION.md) and
[first release test matrix](docs/RELEASE_TEST_MATRIX.md).

## Repository note

이 저장소는 처음에는 ChatGPT ↔ GitHub 연결 기능 검증용으로 만들어졌기 때문에 과거 integration demo artifact가 일부 남아 있다. 현재부터는 NativeWeb 개발과 handoff 가능한 source-of-truth repository로 사용한다.
