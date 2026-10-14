# Unity WebView integrated preview — source + contract stage

**Status: WINDOWS NATIVE BUILD + C# API CONTRACT. NO UNITY PLAYER EXECUTION OR COMPLETE DUAL-BACKEND PROOF.**

Target product: Windows Unity WebView, WebView2 HWND Overlay + CEF accelerated Texture/RawImage behind a common beginner API. The preserved CEF 58.4.4 OneClick validation and WebView2 58.5.2 HWND review happen in OTHER protected branches.

## Protect original assets
CEF OneClick archive SHA-256: \`07e06a42f38cab584ce4e35091d47710539cbaee21883e033ecb97565ec24eb8\` (122/122 internal source manifest checks in local assembly test).
WebView2 Stage2 resizable archive SHA-256: \`3f04d0ab41aadd83d07dc451e12325a51422417da89316b671b2e97557b5a2f3\`.
The actual CEF source bundle and WebView2 prototype DLL are **not** committed to GitHub through this integration branch. This is an additive proof-of-contract source tree; they remain independently versioned and must be provided from exact validated archives.

## Present implementation
- \`UnifiedWebView.ResolveMode\`: Auto RawImage/MeshMaterial/RenderTexture -> Texture, ScreenRect/None -> Overlay. Invalid explicit overrides rejected.
- CEF Texture bridge forwards Initialize/Open/Load/Reload/Stop/History/Resize/Pump/Close/Shutdown to unchanged validated \`Company.WebView.WebView\`. The original \`CefTextureSurface\` must be used and bound to a Unity RawImage in Inspector.
- Overlay now uses a separate `CompanyWebView2UnifiedPreview.dll` build (`UNIFIED_PREVIEW`) with URL navigation, fire-and-forget JS execution, JS→C# string events, C#→JS messages, STA worker dispatch and explicit async ready/close states. It requires `OverlayParentHwnd`; one view only. Legacy r5 sample DLL remains byte-identical in protected branch.
- Common PostMessage and ExecuteJavaScript now delegate in Overlay but explicitly reject on CEF until the validated CEF public facade supports them. Script result and navigation-complete callbacks are NOT implemented.
- Unity standalone preview host \`UnifiedTextureSceneHost\` uses D3D11 CEF package setup in the original source. It must not be considered verified in Player yet.

## CI boundary
Contract tests build/run via .NET 8 with a **CEF compile-only stub**; separately, MSVC compiles the real new WebView2 native DLL and runs an export/invalid-input test WITHOUT a Unity Player. They verify strict backend mode selection and explicit errors plus CEF delegate signatures. The locally assembled source-only ZIP additionally compares source hashes and contains original CEF source under \`Assets/CompanyWebView\` plus WebView2 independent references. CI is not signed GA, not a Unity GPU performance test.

## Remaining P0 integration
1. Generic WebView2 product controller Navigate/Script/Events/Multiples + isolated Win32/Unity lifecycle.
2. Common cross-backend JS↔C# and async event protocol.
3. Unity Runner scene proving both modes in one project, Editor/Standalone and Mono/IL2CPP.
4. Protect CEF Texture Korean committed-text path and independently fix full composition and candidate positioning.
5. Reproduce long-run texture FPS/memory, DPI, resizing, processes, packaging and external signing.

### Preview limitations and regression safety

- `https://`, `http://`, and `about:blank` only. No arbitrary `file://`/`javascript:` navigation; HTML navigation exists at native level but is not promoted to public API yet.
- Overlay is still **single-view** and navigations/JS calls must wait for `IsReady`; COM completion is asynchronous, so queue acceptance is NOT navigation or JavaScript success.
- JS→C# sends from the page using `chrome.webview.postMessage('text')`, handled in `UnifiedWebView.MessageReceived` when the Unity main thread invokes `Pump()`. No JSON RPC yet.
- Browser native process and environment not executed in CI. Manual Windows Player test, multi-view ownership and independent shutdown audit remain required before integration acceptance.
