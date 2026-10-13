# NativeWeb first usable SDK — Scope A (approved 2026-10-13)

## Decision and product promise

This scope is governed by [PRODUCT_VISION.md](PRODUCT_VISION.md).

**APPROVED: Scope A**, by the project owner in conversation on 2026-10-13.
This supersedes the earlier *Runtime + Plugin SDK only* first-release target.
The product is an **Electron/Tauri-category desktop application platform**
whose **primary native backend is C/C++**. It supports *both* creating new
desktop apps and embedding into existing C/C++ hosts. Electron's Node.js or
Tauri's Rust is **not** a required native backend. Official Python/C# wrappers
are first-class languages on the same underlying native runtime.

A first usable release must cover an executable, CLI-created Web UI + C/C++
native application **and** a thin native-host-embedding example, with a real
DLL/SO plugin and **bidirectional JS/native calls and callbacks**, packaged
so a developer can restore/build/run/publish without manually assembling
browser SDKs. See [product vision](PRODUCT_VISION.md).

No release number, `main` merge, or public distribution is authorized by
this scope decision alone.

## Required deliverables (Scope A1)

1. **Core and engines:** C++11 public API, unchanged `nativeweb::WebView`
   abstraction, Linux CEF, Windows WebView2 (default when available), optional
   Windows CEF. Keep `Engine::Auto`.
2. **Bridge and plugins:** `xytron.foo()` direct calls, `xytron.invoke()`
   compatibility, Promise/error mappings, typed C++ bindings, factory-returned
   native objects, stable versioned C ABI DLL/SO, conservative safe unload.
3. **Security:** trusted *packaged app content* only by default. Deny remote
   documents, non-trusted local files, arbitrary child frames, navigation
   to a new origin, and unauthorized native methods at the native dispatch
   boundary, regardless of injected JS wrappers. Explicit, narrow opt-ins
   must be available for applications that genuinely need them.
   Browser engine *feature capabilities* do **not** imply permission grants.
4. **Minimal host integration:** a small Win32 HWND embedding sample/control
   on Windows and GTK3 host embedding sample on Linux. Validate create,
   resize, focus, reload, destroy, and JS-native callback in a real host app.
   Adapters remain thin; no new app framework, message loop mandate, or
   engine-specific public types.
5. **Redistributable developer SDK:** headers, CMake exported target(s),
   appropriate engine libraries/resources, real plugin fixture, sample source
   and documented runtime prerequisites. Include pinned CEF ICU/locales and
   Windows WebView2 Evergreen detection/diagnostics. No source-tree reliance.
   Verify licensing notices and permitted redistribution before publishing
   engine binaries.
6. **A single reproducible vertical slice:** both Windows and Linux samples
   load local app HTML, invoke a C++ method, create/use/dispose an object
   from a real DLL/SO, reject an untrusted page, and exit/cleanup safely.
7. **.NET-like CLI:** a working `xweb` MVP with `new`, `restore`/
   dependency download, `run`, `build`, `test`, `publish`, `doctor` and
   `plugin new/build`. The same project manifest drives all commands;
   restore is reproducible. Include a freshly generated **new desktop app**.
8. **Bidirectional plugin callbacks:** plugin→JS named call/event/callback
   with Promise/typed results and error propagation, lifecycle-safe callback
   ownership and unsubscribe/unload, tested across all three browsers.
9. **Python/C# wrapper vertical slices:** official, tested minimal Python
   and C#/.NET calls through the stable native boundary, with representative
   async/callback/error and ownership behavior. Full feature parity can
   follow after the first usable release.
10. **Docs and verification:** quickstart, packaging/layout, examples,
    origin/capability model, troubleshooting, and Linux/Windows CI artifacts
    accompanied by logs.

## Intentional exclusions from Scope A1

- Formal MFC, WinForms, WPF, Qt, or other framework adapters beyond Win32/GTK3
- Electron-wide Desktop API parity, updater, shell-level installer, code signing
- Advanced CLI templates/registry services beyond the required xweb MVP,
  Sidecar runtime, TypeScript code generation
- TransferBuffer/SharedBuffer zero-copy/streaming, Code - OSS benchmark
- Dynamic plugin hot-reload guarantees beyond safe unload already specified
- Fully general arbitrary JS-function reference semantics beyond the
  required safe bidirectional plugin callback/event vertical slice.
  **The tested plugin→JS callback/event capability itself is mandatory.**

These remain planned features; do not remove existing code or compatibility
to enforce the first-release boundary.

## Scope A1 target platform matrix

- Windows x64: Win32 host, WebView2 primary; CEF optional explicit backend.
- Linux x64: GTK3 host with managed CEF.
- Other OS/CPU architectures, formal MFC/Qt/WinForms/WPF host adapters:
  later milestone. Core Python and C# wrappers are not host adapters.
- Deployment includes a versioned engine/runtime SDK artifact and the
  **xweb CLI** generated standalone desktop app + native host consumer;
  not necessarily a platform-wide system installer.

## Release policy

All required gates in `docs/ACCEPTANCE_CRITERIA.md` must be green.
`docs/RELEASE_TEST_MATRIX.md` defines reproducible positive and negative
test cases. Missing SDK/runtime/CI is a BLOCKED gate, never a PASS.

Only material API/ABI changes, unsafe permission defaults, scope changes,
financial commitments, destructive actions, or final merge/public release
require user approval. Report errors in `docs/ISSUE_LOG.md` and keep
independent workstreams moving.
