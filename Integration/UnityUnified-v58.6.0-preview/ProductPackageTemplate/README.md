# Company WebView for Windows — productization preview

**Not a production release.** This UPM package is assembled from prevalidated CEF v58.4.4 managed/native artifacts and WebView2 v58.5.2 preview DLL. It does not modify those validated originals.

Supported target in this milestone: Unity 2022.3 Windows x64 standalone D3D11. The Editor can create prefabs but cannot run the Win32 native previews in Play Mode. Other Unity versions, IL2CPP, HDRP/URP, multiple independent WebViews, browser input/IME and packaging behavior are **not yet verified**.

The package includes a `Tools > Company WebView > Create Preview Prefabs` Editor command. It generates Texture (CEF RawImage) and Overlay (WebView2 HWND) prefabs in the consuming project's `Assets/CompanyWebViewGenerated/Prefabs` folder. These are **preview component blueprints**, not released interactive controls.

* Texture: attach to a Unity Canvas; the CEF surface RawImage must be assigned. D3D11 texture rendering was demonstrated in the separate native 3D cube test. Mouse/keyboard/IME injection remains incomplete.
* Overlay: attach under a screen-space Canvas; the WebView2 HWND is drawn outside Unity render textures and may cover Unity UI. Normal Windows child HWND input path is under manual compatibility investigation.
* Backend facade: `UnifiedWebView` supports basic navigation, explicit render mode selection, and Overlay fire-and-forget JavaScript/messages. CEF JS/message parity, script results and multi-instance are not implemented.

You must build a Windows Standalone Player and test on a Windows desktop. No cloud CI result is evidence of a Unity GPU/IME Player run.

This package is created using `New-UnityProductPackage.ps1` and intentionally excludes OneClick tests, GPU readback fixtures, screenshots, or experimental manual proof classes.

Third-party Chromium/CEF/WebView2 redistribution notices, security update policy and license review are required before sale.
