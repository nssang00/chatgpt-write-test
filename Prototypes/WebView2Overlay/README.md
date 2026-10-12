# Phase1B WebView2 Overlay v58.5.0

**Isolated Windows x64 Win32 C++ prototype. Not Unity runtime, not a CEF replacement.**

The host uses a windowed WebView2 child HWND on an STA UI thread with bounds, parent-position, DPI, focus, lifecycle and JS message ping/pong. The pinned stable SDK is Microsoft.Web.WebView2 1.0.4258.31. Run the compiled EXE interactively on Windows with WebView2 Evergreen Runtime installed to check resize, Korean IME, message echo and clean close. CI checks compilation only, NOT runtime display.

Baseline: v58.4.4 GitHub Stage1 passed. Original Windows Stage2 8/8 passed earlier in time; official promotion remains blocked until the unchanged v58.4.4 OneClick Stage2 is rerun afterward. Existing v58.3 remains validated baseline.

https://learn.microsoft.com/en-us/microsoft-edge/hosting/webview2/gettingstarted
