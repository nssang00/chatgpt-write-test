# Testing and CI

## Definition of done

기능은 다음 세 조건을 모두 만족해야 완료로 간주한다.

```text
implementation
    +
feature/regression test
    +
full relevant CI pass
```

버그 수정:

```text
bug
  -> reproduction test
  -> test fails
  -> fix
  -> test passes
  -> full regression
```

## Current verified CI

Workflow:

```text
.github/workflows/platform-smoke.yml
```

Matrix:

- `ubuntu-latest`
- `windows-latest`

Baseline:

- C++11
- CMake
- build
- CTest

Initial verified run:

- Run ID: `37597876713`
- Head SHA: `c253803db28f0047128a4723a2e82862a26f7bf7`
- Ubuntu: success
- Windows: success

Platform Smoke 외에 `.github/workflows/core-regression.yml`이 추가되었다.

현재 검증된 NativeWeb Core/API regression:

- Run ID: `37610573658`
- Head SHA: `abf8a2c5908c1bff3ee3e8473de3a52242e7e6b7`
- Ubuntu: build + CTest success
- Windows: build + CTest success
- Any/Variant containers/binary/invalid access
- typed bind adapter
- public WebView API compile contract
- BrowserBackend compile contract

Latest full verified feature baseline:

- Head SHA: `c4ac5666c640423b50bb6dfda285e75a0f618713`
- Core Regression run `37646528511`: Ubuntu + Windows success
- Platform Smoke run `37646528046`: Ubuntu + Windows success
- NativeWeb CEF Bridge run `37646528043`: Linux real CEF success

Latest public API compile baseline:

- Head SHA: `fe6dfc5419c7c281a53d7628e938429229b79698`
- Core Regression run `37646977459`: Ubuntu + Windows success
- Platform Smoke run `37646977368`: Ubuntu + Windows success

Core coverage now includes Any/containers/binary, typed bind, typed async future casting, structured errors, request IDs/pending calls, event dispatcher, bridge messages/runtime, ObjectRegistry, NativeObjectRuntime, WebView orchestration/engine selection and public API compile contracts.

Real CEF integration coverage now includes public WebView orchestration, reload reconnect, JS→C++, C++→JS, objects, arrays, binary, events, Promise resolve/reject in both bridge directions where applicable, native exception mapping, missing-method rejection, multi-WebView isolation, destroy-with-real-pending-Promise, and native object Proxy lifecycle/round-trip.

## Target CI topology

```text
core-regression
  +-- ubuntu
  +-- windows

api-regression
  +-- ubuntu
  +-- windows

browser-contract
  +-- linux / CEF
  +-- windows / CEF
  +-- windows / WebView2

host-smoke
  +-- MFC
  +-- WinForms
  +-- WPF
  +-- Qt
  +-- GTK

plugin-regression
  +-- DLL Windows
  +-- SO Linux

cli-e2e
  +-- ubuntu
  +-- windows
```

초기 구현 순서는 core -> API -> Linux CEF -> Windows WebView2/CEF -> host/plugin/CLI 순으로 확장한다.

## Core regression

`Any.h` 확보 후 최소 테스트:

- scalar construction/copy
- string
- bool
- integer/floating conversion
- VariantList
- VariantDict
- binary vector
- nested value
- invalid cast/error
- copy/move semantics where supported
- async/future interaction

테스트는 C++11에서 동작해야 한다.

## Bridge contract regression

최소 baseline:

1. JS -> C++ int/string
2. JS Object -> C++ VariantDict
3. JS Array -> C++ VariantList
4. C++ -> JS scalar/object/list
5. C++ return -> Promise resolve
6. C++ exception -> Promise reject
7. std::future -> Promise
8. binary -> Uint8Array
9. two WebViews independent
10. reload -> bridge reconnect
11. destroy -> pending call safe termination/rejection
12. unknown method
13. invalid arguments
14. object handle lifetime
15. event subscribe/unsubscribe

## Public API compile tests

API shape 자체가 regression contract다.

예:

```cpp
nativeweb::WebView webview;
webview.create(parent, "index.html");
webview.bind("math.add", [](int a, int b) { return a + b; });
webview.destroy();
```

이 예제가 C++11 Windows/Linux에서 compile되는지 항상 검증한다.

## Browser integration tests

Mock만으로 CEF backend 완료를 선언하지 않는다.

CEF integration 완료 조건 및 현재 상태:

- [x] real CEF distribution 사용
- [x] CefExecuteProcess/CefInitialize
- [x] browser create
- [x] local HTML load
- [x] JS -> C++
- [x] C++ -> JS
- [x] JS-facing Promise resolve/reject
- [x] JS-returned Promise -> C++ future resolve/reject
- [x] reload reconnect
- [x] binary
- [x] events
- [x] destroy while bridge calls are pending (real browser, C++ -> unresolved JS Promise)
- [x] multi-WebView isolation
- [x] native object Proxy method call / handle round-trip / dispose

WebView2 backend가 추가되면 같은 browser contract suite를 재사용한다.

## Host tests

Host layer는 복잡한 logic을 가지면 안 된다.

따라서 host test의 핵심은:

- 기본 framework sample/project 형태로 build
- WebView control 생성
- resize
- focus
- load
- destroy
- bridge API 접근

Host-specific business logic을 만들지 않는다.

## Plugin regression

최소 contract:

- DLL/SO load
- ABI version check
- plugin metadata/name
- function registration
- function invoke
- async result
- exception/error
- event emit
- binary
- unload/lifetime behavior
- incompatible ABI rejection

장기적으로 isolated plugin host mode도 별도 regression suite로 둔다.

## Test naming/layout target

예상 구조:

```text
tests/
  core/
    any_regression.cpp
    async_regression.cpp
    object_registry_regression.cpp

  api/
    public_api_compile.cpp

  bridge/
    bridge_contract.*

  integration/
    cef/
    webview2/

  plugin/
    sample_plugin/
    plugin_regression.*

  host/
    mfc/
    winforms/
    wpf/
    qt/
    gtk/

  cli/
```

## CI rules

- `fail-fast: false`: 한 platform 실패가 다른 platform 결과를 가리지 않게 한다.
- 테스트 실패 시 `ctest --output-on-failure` 또는 동등한 상세 로그를 남긴다.
- compiler/platform/backend matrix를 명시적으로 표시한다.
- real browser integration은 mock unit test와 job 이름을 분리한다.
- flaky test를 무조건 retry해서 숨기지 않는다. 원인을 기록한다.
- known failure를 success로 포장하지 않는다.


## Execution/concurrency regression

새 execution runtime은 최소 다음을 검증한다.

- worker pool이 caller/browser thread와 다른 thread에서 user callable 실행
- 여러 request를 동시에 queue할 수 있음
- 여러 worker에서 실제 overlap 가능
- completion order가 request order와 달라도 RequestId가 올바른 결과를 연결
- native exception이 해당 request 하나만 reject
- shutdown 후 새 task reject
- queued/running task lifecycle을 정의된 정책대로 처리
- real CEF에서 JS Promise 여러 개를 동시에 호출해도 독립적으로 완료

## JavaScript facade regression

real browser에서 둘 다 유지한다.

Recommended:

```js
await xytron.math.add(1, 2);
await xytron.camera.open();
```

Primitive compatibility:

```js
await xytron.invoke("math.add", 1, 2);
```

direct facade는 dotted namespace, Promise rejection, native object return을 모두 동일 bridge contract로 사용해야 한다.

## Binary semantics regression

기본 Binary와 advanced ownership API는 별도 테스트한다.

- Binary: safe ordinary value semantics
- Transfer: explicit ownership transfer/detach semantics
- Shared: explicit shared lifetime/release semantics
- 크기 기반 내부 최적화가 기본 Binary의 observable semantics를 변경하지 않는지 검증
