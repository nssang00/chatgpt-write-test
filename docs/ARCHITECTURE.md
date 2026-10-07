# NativeWeb Architecture

## Product position

NativeWeb은 GUI toolkit이 아니라 **Web UI for native applications runtime/platform**이다.

목표는 기존 native backend와 application structure를 최대한 유지하면서 HTML/CSS/JavaScript UI를 사용할 수 있게 하는 것이다.

```text
Web frontend
    |
Web SDK / Promise API
    |
NativeWeb Bridge
    |
NativeWeb Core
    |
Browser backend
    |
Native host
```

## Architecture layers

### Web application

- Vanilla HTML/CSS/JS
- React
- Vue
- Svelte
- 기타 일반 Web framework

Node.js runtime을 renderer에 필수로 두지 않는다.

### Web SDK

초보자에게는 자연스러운 namespace/object API를 제공한다.

```js
await native.dialog.open();
await native.clipboard.writeText("hello");
const camera = await native.camera.open();
```

Migration/primitive API도 유지한다.

```js
await native.invoke("camera.open", options);
native.on("camera.frame", handler);
```

### Public Native SDK

기본 C++ API:

```cpp
nativeweb::WebView webview;
webview.create(parentHandle, "index.html");

webview.bind("math.add", [](int a, int b) {
    return a + b;
});

auto result = webview.execute<int>("ui.calculate", 3, 4);
webview.destroy();
```

C++11 baseline을 유지한다.

.NET wrapper는 이후 stable C ABI 위에 제공한다.

### Core Runtime

Core는 다음 책임을 가진다.

- WebView lifecycle
- function registry
- request / response
- events
- async Promise / `std::future`
- error mapping
- object registry
- thread dispatch
- permissions/capabilities
- binary transport selection
- plugin manager
- engine abstraction

### Dynamic value model

Canonical native dynamic type은 사용자 제공 `Any.h`다.

```cpp
using VariantList = std::vector<Any>;
using VariantDict = std::map<std::string, Any>;
```

지원 목표:

- null
- bool
- integer
- floating point
- string
- list
- dict
- binary
- object handle
- structured errors

### Native object bridge

Raw pointer는 JS로 보내지 않는다.

```text
std::shared_ptr<Camera>
        |
 Object Registry
        |
 opaque object id
        |
     JS Proxy
```

예:

```js
const camera = await native.camera.open();
await camera.start();
const frame = await camera.capture();
```

lifetime은 registry가 관리한다.

### Async

```text
C++ std::future / async result
        |
NativeWeb async runtime
        |
Bridge
        |
JavaScript Promise
```

Exception/error는 Promise rejection으로 변환한다.

### Binary

작은 binary와 큰 binary의 public API는 동일해야 한다.

```text
std::vector<uint8_t>
        |
 transport selector
   /            \
IPC          shared memory
   \            /
    Uint8Array
```

사용자는 transport 선택을 몰라도 된다.

## Browser backend

Public `WebView`는 engine-independent다.

```text
nativeweb::WebView
       |
BrowserBackend interface
       |
   +---+----+
   |        |
  CEF    WebView2
```

초기 정책:

- Linux: CEF first-class
- Windows: WebView2 + CEF
- default: `auto`
- fixed Chromium/reproducibility: CEF
- smaller/system runtime: WebView2 on Windows

Engine-specific feature는 capability로 확인한다.

```cpp
if (webview.capabilities().supports(Capability::PdfPrint)) {
    // ...
}
```

## CEF process model

Real CEF integration은 multi-process 구조를 따른다.

대략:

```text
main()
  |
CefExecuteProcess(...)
  |
(if browser process)
  |
CefInitialize(...)
  |
NativeWeb Runtime
```

Raw CEF handler는 internal backend implementation detail이다.

Public API에서 `CefClient`, `CefMessageRouter`, V8 handler 타입을 요구하지 않는다.

## Host layer

Host layer의 목표:

> 기본 wizard/sample project에 WebView control 몇 개 파일만 추가된 것처럼 보여야 한다.

지원 목표:

```text
Native:
- Win32
- MFC
- Qt
- GTK

.NET:
- WinForms
- WPF
```

Host adapter의 책임:

- native parent handle 전달
- bounds/resize 전달
- focus 전달
- host lifecycle 전달
- framework-friendly control/widget wrapper

Host adapter에 넣지 않는 것:

- IPC protocol
- serialization
- CEF handler logic
- plugin management
- permission engine
- business logic

### MFC

예상 사용자 코드:

```cpp
class CMyDlg : public CDialogEx {
    CWebViewCtrl webview_;
};

BOOL CMyDlg::OnInitDialog() {
    CDialogEx::OnInitDialog();
    webview_.Create(this, IDC_WEBVIEW);
    webview_.Load("index.html");
    return TRUE;
}
```

### WinForms

예상 사용자 코드:

```csharp
var webView = new WebViewControl {
    Dock = DockStyle.Fill
};

Controls.Add(webView);
webView.Load("index.html");
```

장기적으로 Visual Studio Designer Toolbox 지원을 고려한다.

## Plugin architecture

ROS2 pluginlib처럼 shared library를 runtime에서 발견/로드하는 경험을 목표로 한다.

```text
Vendor SDK
   |
thin C++ adapter
   |
camera.dll / libcamera.so
   |
NativeWeb Plugin Manager
   |
native.camera.*
```

개발자-facing C++:

```cpp
NATIVEWEB_PLUGIN_BEGIN("camera")
bind("open", ...);
bind("capture", ...);
NATIVEWEB_PLUGIN_END()
```

Binary boundary:

```c
extern "C" NW_EXPORT
int nativeweb_plugin_init(
    const nw_host_api* host,
    nw_plugin_api* plugin);
```

즉:

- C++ API/macros = 편의 계층
- C ABI = binary compatibility 계약

장기적으로:

- embedded metadata
- plugin version/capability
- TypeScript definitions 생성
- `xweb plugin inspect`
- isolated plugin host process

## Sidecar architecture

모든 언어를 in-process로 강제하지 않는다.

```text
NativeWeb App
    |
Sidecar Manager
    |
Python / Node / Go / Java / .NET / Rust executable
```

transport 후보:

- stdin/stdout
- named pipe
- Unix domain socket
- local TCP
- gRPC

사용자-facing API는 transport-independent하게 설계한다.

## Desktop API

Web 표준으로 해결 가능한 것은 Web에 맡긴다.

예:

- HTTP → fetch
- WebSocket → WebSocket
- EventSource → SSE

NativeWeb이 제공할 desktop API:

- app
- window
- webview
- dialog
- clipboard
- shell
- filesystem/path
- process
- menu/context menu
- tray
- notification
- shortcut
- screen/DPI
- session/cookies/cache/proxy
- custom protocol
- single-instance
- updater
- secure storage
- power
- capture

## API levels

### Level 0 — Zero config

```bash
xweb new myapp
xweb run
```

### Level 1 — Simple API

```cpp
WebView
bind()
load()
execute()
```

### Level 2 — Desktop API

```text
dialog / fs / window / clipboard / shell / ...
```

### Level 3 — Advanced

- engine
- permissions
- session
- proxy
- cache
- custom protocol
- capabilities

### Level 4 — Expert / native

- plugin ABI
- browser backend extension
- transport tuning
- shared memory
- custom host integration

상위 레벨을 쓰기 위해 하위 레벨의 programming model을 버릴 필요가 없어야 한다.

## Code - OSS long-term benchmark

Code - OSS를 NativeWeb에서 구동하는 것을 장기 compatibility benchmark로 고려한다.

초기에는 Node extension host를 없애지 않는다.

```text
Code - OSS Web Workbench
        |
NativeWeb WebView
        |
NativeWeb Core
   +----+------+
   |           |
native APIs   Node extension host sidecar
```

목적은 VS Code fork 자체가 아니라 Electron급 대형 앱이 NativeWeb 위에서 가능한지를 검증하는 것이다.
