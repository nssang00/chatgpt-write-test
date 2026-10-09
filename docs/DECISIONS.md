# Architecture Decisions

이 파일은 이미 합의된 결정을 기록한다. 새 세션은 특별한 이유가 없으면 아래 결정을 다시 처음부터 논의하지 않는다.

## D-001: Product identity

**Status: Accepted**

NativeWeb은 GUI toolkit이 아니라 Web UI for native applications runtime/platform이다.

Electron 복제나 C++ 전용 UI toolkit을 목표로 하지 않는다.

## D-002: C++ first-class, C ABI at binary boundary

**Status: Accepted**

Public native SDK는 C++ 친화적으로 만든다.

하지만 plugin/.NET/타 언어 경계의 안정성을 위해 low-level binary contract는 C ABI로 둔다.

## D-003: C++11 baseline

**Status: Accepted**

Core/public C++ API는 가능한 한 C++11에서 빌드되어야 한다.

새 기능 때문에 baseline을 올릴 때는 별도 architectural decision이 필요하다.

## D-004: User-provided Any.h is canonical

**Status: Accepted**

사용자가 제공한 기존 `Any.h`와 `VariantList`, `VariantDict` 구조를 public dynamic type의 기준으로 사용한다.

임의의 새 Value type으로 public API를 교체하지 않는다.

## D-005: Browser engine abstraction

**Status: Accepted**

Public API는 `nativeweb::WebView` 하나를 사용한다.

CEF/WebView2 타입이 사용자 code에 새지 않게 한다.

기본 engine 선택은 `auto`.

## D-006: Managed CEF + WebView2

**Status: Accepted**

- Linux: CEF first-class
- Windows: WebView2 및 CEF 지원
- CEF는 fixed/managed Chromium 선택지
- WebView2는 Windows system runtime 선택지

Engine-specific 기능은 capability로 노출한다.

## D-007: Host layer stays thin

**Status: Accepted**

MFC/WinForms/WPF/Qt/GTK/Win32 Host는 기존 framework의 project/lifecycle을 유지한다.

NativeWeb application base class나 별도 message loop를 강요하지 않는다.

## D-008: Beginner-first defaults

**Status: Accepted**

모든 주요 subsystem은 안전하고 합리적인 기본값을 제공한다.

전문가 설정은 optional advanced layer로 둔다.

## D-009: Familiar API names, improved high-level APIs

**Status: Accepted**

Electron/Tauri 사용자가 알아보기 쉬운 이름을 우선한다.

예:

- `dialog.open`
- `shell.openExternal`
- `clipboard.writeText`
- `window.minimize`

동시에 더 높은 수준 API가 의미 있으면 추가한다.

예:

```js
const file = await native.file.open();
const camera = await native.camera.open();
```

## D-010: invoke compatibility + typed/object API

**Status: Accepted**

Low-level/migration:

```js
await native.invoke("device.open", options);
```

Recommended:

```js
await native.device.open(options);
```

High-level object:

```js
const device = await native.device.open(options);
await device.start();
```

세 계층은 서로 배타적이지 않다.

## D-011: Promise/future is standard async model

**Status: Accepted**

JavaScript async API는 Promise를 기준으로 한다.

C++에서는 `std::future` 등의 비동기 결과를 framework가 Promise로 연결한다.

## D-012: Binary is first-class

**Status: Accepted**

`std::vector<uint8_t>` 등 native binary를 JS `Uint8Array/ArrayBuffer`로 자연스럽게 연결한다.

Large data transport는 shared memory 등의 최적화를 내부에서 선택한다.

## D-013: Never expose raw native pointers to JS

**Status: Accepted**

Native object는 opaque ID + registry + JS Proxy로 관리한다.

Native lifetime은 `shared_ptr` 등의 소유권 모델과 연결한다.

## D-014: Plugin system is core differentiator

**Status: Accepted**

ROS2 pluginlib와 비슷하게 사용자는 DLL/SO만 빌드/배치해서 Web에서 호출할 수 있어야 한다.

사용자-facing C++ API는 간단하게, binary boundary는 stable C ABI로 한다.

## D-015: Sidecar is a first-class escape hatch

**Status: Accepted**

Python/Node/Go/Java/.NET/Rust 등 별도 runtime이 자연스러운 경우 executable sidecar를 지원한다.

NativeWeb의 목표는 모든 언어를 C++ process 안에 embed하는 것이 아니다.

## D-016: Capability-based security

**Status: Accepted**

Tauri의 좋은 점인 capability/permission 철학을 가져간다.

단, 초보자의 기본 경로를 복잡한 manifest 작성으로 막지 않는다.

위험 기능만 명시적 permission을 요구하는 방향을 선호한다.

## D-017: Web standards remain Web standards

**Status: Accepted**

HTTP, WebSocket 등 Web에서 이미 잘 되는 기능을 NativeWeb 전용 API로 불필요하게 재발명하지 않는다.

## D-018: Testing is part of feature completion

**Status: Accepted**

Feature + test + full regression pass가 완료 기준이다.

버그 수정은 가능하면 failing reproduction test를 먼저 만든다.

## D-019: GitHub Actions is official cross-platform gate

**Status: Accepted**

최소 Windows/Linux를 GitHub Actions에서 계속 검증한다.

브라우저 backend가 추가되면 동일 contract test를 backend matrix에서 실행한다.

## D-020: Code - OSS is a future stress/compatibility benchmark

**Status: Accepted**

Code - OSS를 NativeWeb에서 실행하는 것은 장기 검증 목표다.

Microsoft VS Code binary 재포장이 아니라 Code - OSS source 기반 port/experiment를 전제로 한다.

Node extension host는 처음부터 제거하려 하지 않는다.


## D-021: Direct JavaScript API is the default

**Status: Accepted**

Recommended JavaScript usage is direct namespace/function access such as `xytron.getUser()` and `xytron.camera.open()`.

`xytron.invoke("...")` remains a first-class primitive for Electron migration, dynamic dispatch and framework internals, but it is not the primary Getting Started API.

## D-022: Native objects are first-class Web objects

**Status: Accepted**

C++ native objects map to JS Proxy-like objects through opaque ObjectId + ObjectRegistry.

The public goal includes singleton/root object binding and factory-returned object instances.
Raw native pointers are never exposed to JS.

Because C++11 has no reflection, exposed methods require explicit binding metadata.

## D-023: JS-to-C++ user code defaults to a worker pool

**Status: Accepted**

Incoming JS calls must not execute arbitrary user C++ inline on the browser/UI dispatch thread.

Default execution is queued to a NativeWeb-managed worker pool.

Advanced users may later choose serial/UI/custom execution policies without changing the beginner path.

## D-024: RequestId correlates concurrent bidirectional calls

**Status: Accepted**

C++ -> JS calls use RequestId-correlated pending state and return `std::future<T>`.

Multiple calls may be outstanding concurrently and may complete out of order.

JS -> C++ calls use the same request/response correlation concept and resolve/reject the matching Promise.

## D-025: Binary has safe defaults; ownership-changing transports are explicit

**Status: Accepted**

`Binary` is the default safe value API.

Transfer and shared-memory semantics use separate explicit advanced APIs/types.

Runtime optimizations may be automatic only when they do not change observable ownership/lifetime semantics.

## D-026: C++17 type support is optional convenience

**Status: Accepted**

C++11 remains the Core/public baseline.

`std::optional`, `std::variant`, `std::string_view` and similar newer-standard adapters may be offered conditionally without raising the Core baseline.


## D-027: Callable metadata is internal foundation

**Status: Accepted**

현재 beginner-facing `bind()` API를 유지하면서 내부에 typed callable type-erasure와 signature metadata layer를 추가한다.

metadata는 argument validation, error reporting, TypeScript generation, plugin inspection에 재사용한다.

Pothos-style arbitrary runtime Object model을 bridge Any 전체로 확장하지 않는다. `Any` value world와 `NativeObjectHandle` object identity world를 분리한다.

## D-028: Registration ownership is explicit internally

**Status: Accepted**

Binding/object/plugin registration은 owner와 lifetime을 추적할 수 있어야 한다.

내부 `RegistrationToken` 또는 동등한 RAII registration handle을 두고, plugin module이 자신이 만든 registrations를 소유/정리한다.

일반 사용자의 `webview.bind(...)`에는 이 복잡성을 노출하지 않는다.

## D-029: Plugin code lifetime is tied to module lifetime

**Status: Accepted**

Plugin의 callable, native object, queued/running task 등 plugin code를 실행할 수 있는 entity는 `PluginModule` lifetime reference를 보유한다.

live code/object가 있는 상태의 강제 DLL/SO unload는 허용하지 않는다.

초기 기본값은 controlled shutdown 시 unload이며 hot unload는 advanced 기능이다.

## D-030: Plugin UX is C++, binary boundary is stable C ABI

**Status: Accepted**

사용자는 C++ wrapper/macro로 plugin을 작성할 수 있다.

실제 DLL/SO entry point는 versioned `extern "C"` stable ABI를 사용한다.

Static constructor registration은 user convenience implementation detail로도 신중히 사용하며, plugin ABI 자체를 static-global side effect에 의존시키지 않는다.

## D-031: SharedLibrary stays small and internal

**Status: Accepted**

Qt QLibrary, Boost.DLL, POCO SharedLibrary의 공통 low-level 역할을 참고해 OS library load/symbol/unload abstraction을 둔다.

현재 Core에 Boost/Qt/POCO를 plugin loading을 위한 필수 dependency로 추가하지 않는다.
