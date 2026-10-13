# WebView2 Overlay v58.5.1 — Unity HWND pilot (NOT RELEASE-READY)

This experimental plugin uses its own Win32 STA thread, attaches a child window to the parent HWND of the **same process**, and hosts one windowed WebView2 controller. Unity C# adapter is opt-in, Windows Standalone Player only, and converts RectTransform screen-space coordinates to parent HWND client pixels. No CEF product sources or existing public API are changed.

## Testing

1. Windows x64 CI checks compilation, exported native C ABI and static managed contract.
2. Download the compiled DLL from the GitHub Actions artifact; place at `Assets/Plugins/x86_64/CompanyWebView2OverlayPilot.dll`. Restrict the plugin platform to Windows x86_64 in Unity plugin inspector.
3. Copy `Unity/WebView2OverlayUnityPilot.cs` into a scratch Unity 2022.3 Player project under `Assets/Scripts/`. Add to a GameObject, assign an overlay `RectTransform` and Canvas, explicitly set `enablePilot=true`.
4. Make a **standalone Windows x64 development build**. Unity Editor Play is intentionally disabled.
5. Verify spawned WebView2 child HWND, correct bounds and DPI during resize and movement, typing Korean IME, clicking Ping gives `probe-pong`, and clean exit / no new persistent browser process. Record results; DO NOT mark runtime PASS from CI compilation alone.

## Known limitations and precautions

- Singleton, one view only, no general plugin lifetime/hot reload protection. `WV2Pilot_Close` returns -30 on timeout; stop the application rather than unloading a DLL with a live worker thread.
- Native child HWND is layered **above** Unity's rendering; Unity UGUI does not automatically appear over it.
- No browser navigation policy, permissions, download handling, profiles, comprehensive JS bridge, cross-process reparenting or fullscreen coverage. The page is a constant local sample only.
- WebView2 Runtime presence is required at Windows execution. SDK pinned to `Microsoft.Web.WebView2 1.0.4258.31` is a build dependency, not a shipping runtime.
- HWND discovery with `GetActiveWindow` may fail when the player is not active at `Start()`; this is an intentional fail-closed experimental limitation.
- `SetProcessDpiAwarenessContext` is not called by the DLL. The host application owns process DPI awareness.
- Avoid calling WebView2 COM objects from Unity's main thread. All COM calls are executed on the dedicated STA window thread.

## Acceptance boundary

Native Windows CI PASS permits a **Windows Unity player interactive trial**, not production promotion. v58.4.4 CEF validated baseline remains separate and unchanged. Signed GA requires a separate release gate.

Microsoft references: https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environment
Unity 2022.3 plugin docs: https://docs.unity3d.com/2022.3/Documentation/Manual/PluginInspector.html
