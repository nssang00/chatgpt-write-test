# NativeWeb / Xytron — Product vision (confirmed 2026-10-13)

## Identity and competitor category

**NativeWeb is a cross-platform desktop application framework/platform in the
same product category as Electron and Tauri, with C/C++ as the primary native
backend.** It is *not* merely an embeddable WebView, an Electron clone, or a
GUI widget toolkit. The browser is a frontend runtime, not the backend
language. JavaScript/TypeScript is used for UI; users retain native C/C++
application logic, SDKs and shared libraries.

Working names: **NativeWeb** for C++ runtime/repository, **Xytron/xytron**
for JS developer-facing API, and **xweb** for CLI. Final branding is undecided;
do not initiate a sweeping rename solely from these examples.

## Three equally important workflows

1. **New desktop application:** `xweb new` creates an executable Web UI +
   C/C++ backend project with a ready development loop. No preexisting
   host application required.
2. **Embedding/migration:** a native C/C++ Win32, MFC, Qt, GTK or .NET host
   can embed the same WebView/bridge and preserve its lifecycle and backend.
3. **Native extension:** author a small C++ plugin exporting a stable,
   versioned C ABI; deploy as DLL/SO and call it from JS without manually
   wiring Chromium IPC, C++ addon code, or per-method glue.

## First-class backend and bindings

- **Primary implementation:** C/C++ runtime + C++11 SDK, both static bindings
  and dynamic versioned C ABI plugins. No mandatory Node.js or Rust backend.
- **Official wrappers:** Python and C#/.NET as first-class developer languages
  calling the same underlying C API/runtime, not merely Sidecar substitutes.
  Their high-level APIs, async mapping, object lifetimes and callbacks must
  be specified and tested. The wrappers may internally use FFI/PInvoke.
- **Sidecar:** separate opt-in process model for services and other languages;
  it complements but does not replace in-process Python/C# wrappers.
- **Web frontend:** HTML/CSS/JS, React/Vue/Svelte; a frontend Node-based tool
  may be optional, but is not required to implement the native backend.

## Bidirectional plugin bridge contract

```text
JavaScript / TypeScript UI
    ↕ Promise call, callback / event, object handles, binary
NativeWeb bridge (request ID, thread dispatch, lifetime, security)
    ↕
C/C++ Core and native service registry
    ↔ C++ Plugin (DLL/SO, versioned C ABI)
    ↔ Python wrapper / C# wrapper
    ↔ optional Sidecar
```

The intended API must cover:
- JS → C/C++ plugin: functions, typed arguments, factory-created objects.
- C/C++ plugin → JS: invoke named JS handlers, receive async result/error;
  subscribe/emit events or call explicit registered callbacks.
- JS → plugin callbacks: a callback/reference token can be supplied where
  supported, without unsafe raw JS pointers crossing C ABI boundaries.
- Cancellation/destroy/reload/unload: invalidate callback references,
  unsubscribe listeners, preserve code/object lifetime and avoid calling
  destroyed renderer contexts; allow safe conservative unload.
- Callback execution may originate on worker threads; marshal through
  backend dispatch queues and never block the UI thread. Handle errors,
  permissions, ordering and backpressure deterministically.

The existing real-browser plugin function/object and C++→JS `execute()`
tests are a **foundation**, not proof of plugin-owned callback/event ABI.

## .NET-like CLI is a product feature, not optional documentation

Candidate command UX (targets, NOT implemented syntax guarantees):

```sh
xweb new desktop myapp --backend cpp
cd myapp
xweb restore              # acquire pinned SDK/engines/dependencies
xweb run                  # build + launch with hot/dev workflow as supported
xweb build --configuration release
xweb test
xweb publish --runtime win-x64
xweb plugin new camera --language cpp
xweb plugin build camera
xweb doctor               # runtime/compiler/SDK diagnostics
```

CLI principles: one project manifest, reproducible lock/pins, transparent
diagnostics, no manual SDK archive juggling, meaningful error messages,
release packaging based on the same manifest. Offline/cache behavior must
be tested. `xweb` is a working CLI name; finalized naming remains open.

## First usable release and longer platform

**Scope A1** includes two real app experiences (new CLI-generated app and
embedded Win32/GTK3 app), default-deny native security, actual bidirectional
plugin callback/event tests, managed engine distribution, and an initial
Python/C# wrapper vertical slice with tested ownership/async semantics.
Complete wrapper parity, full Desktop API breadth, designer tooling,
advanced language integrations, hot-reload and Code-OSS compatibility remain
later phases.

The scope must be validated by clean-machine CLI workflows and actual
Windows/Linux host/browser/plugin end-to-end tests. See
`RELEASE_SCOPE_A.md`, `RELEASE_TEST_MATRIX.md`, `EXECUTION_PLAN.md`.

## Positioning shorthand

**Electron/Tauri category · C/C++-first backend · DLL/SO plugin bridge ·
bidirectional JS/native calls · official Python/C# wrappers ·
`dotnet`-like development CLI.**
