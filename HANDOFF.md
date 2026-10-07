# NativeWeb Session Handoff

이 문서는 **새 ChatGPT 세션, 새 개발자, 새 작업 브랜치가 가장 먼저 읽는 단일 인수인계 문서**다.

> 목표: 이전 대화를 읽지 않아도 이 저장소만으로 현재 방향, 완료 상태, 다음 작업을 파악하고 바로 개발을 계속할 수 있어야 한다.

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

현재 real CEF implementation의 기존 `native.invoke` 경로는 regression compatibility로 유지하면서 `xytron.*` direct facade를 추가하는 방향이다.



초보자 기본 경험:

```cpp
nativeweb::WebView webview;
webview.create(parentHandle, "index.html");

webview.bind("math.add", [](int a, int b) {
    return a + b;
});
```

```js
const result = await native.math.add(3, 4);
```

범용 migration API도 제공:

```js
const result = await native.invoke("math.add", { a: 3, b: 4 });
```

장기적으로 typed/object API:

```js
const camera = await native.camera.open("CAM-01");
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
- typed async adapter: `std::future<Any> -> std::future<Result>`
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

Latest full verified feature baseline:

```text
Feature head: c4ac5666c640423b50bb6dfda285e75a0f618713

NativeWeb CEF Bridge: 37646528043  SUCCESS
Core Regression:       37646528511  SUCCESS
Platform Smoke:        37646528046  SUCCESS

Latest public API compile head:
fe6dfc5419c7c281a53d7628e938429229b79698
Core Regression:       37646977459  SUCCESS
Platform Smoke:        37646977368  SUCCESS
```

첫 real CEF vertical-slice success는 run `37637283494`, head `d1e9e823f2f7e3ed06c0fd93b32270f3922085b5`였다.

### 아직 완료되지 않은 것

- security permission/capability policy
- larger binary/shared-memory transport
- Windows WebView2 backend
- Windows CEF backend
- Host adapters
- plugin runtime
- sidecar runtime
- CLI
- Code - OSS compatibility experiment

## 13. 다음 작업 우선순위

가장 먼저 해야 할 일:

1. 최신 Core Regression failure가 없는 green baseline을 항상 유지한다.
2. real CEF에 `xytron.foo()` / dotted namespace direct facade를 추가하고 `invoke()` compatibility를 함께 테스트한다.
3. WorkerPool/TaskQueue Core를 테스트 우선으로 추가한다.
4. JS -> C++ bound callable이 browser thread가 아닌 worker pool에서 실행되도록 연결하고 real CEF concurrency regression을 추가한다.
5. C++ -> JS typed future path에서 호출당 불필요한 `std::async` thread가 생기지 않도록 pending-result 구조를 개선한다.
6. root/singleton native object binding metadata API를 설계하고 `xytron.apple.add()`를 실제 테스트한다.
7. Windows WebView2 backend에 동일 browser contract suite를 재사용한다.
8. security permission/capability policy skeleton을 추가한다.
9. TransferBuffer / SharedBuffer는 기본 Binary와 분리된 advanced API로 추가한다.
10. Plugin stable C ABI + C++ wrapper prototype을 만든다.

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
- Windows WebView2 backend가 구현됐다고 가정하지 않는다.
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
