# NativeWeb autonomous execution plan — C/C++-first platform / Scope A
Updated 2026-10-13 after product-identity clarification

## Goal and developer stories

NativeWeb is in the Electron/Tauri product category, with a C/C++ native
backend, C++ DLL/SO plugin modules, bidirectional JS/native calls/callbacks,
official Python + C# wrappers, and a `dotnet`-like `xweb` CLI.

**Story 1 — New app:** `xweb new` → `xweb restore` → `xweb run` →
C++ plugin and JS callbacks → `xweb build`/`xweb publish` → standalone app.

**Story 2 — Existing app:** install SDK → embed Win32/GTK3 WebView →
use the *same* plugin/bridge from local UI → build/distribute.

**Story 3 — Other languages:** Python and C# basic wrappers load the
same runtime contract and demonstrate native calls, errors, lifetime and
callback behavior. Wrappers are not merely subprocess Sidecars.

See `PRODUCT_VISION.md`, `RELEASE_SCOPE_A.md`,
`RELEASE_TEST_MATRIX.md`, `ACCEPTANCE_CRITERIA.md`.

## A0 existing verified foundation

- Linux/Windows C++11 Core Regression: CI 38322632990 PASS.
- Linux CEF, Windows CEF, Windows WebView2 JS→plugin object E2E:
  CI 38322633033 PASS.
- Installed relocatable **Core-only** C++11 and C ABI consumer:
  CI 38322633018 PASS.
- Existing C++→JS `execute()`/Core events tests are **not** equivalent to
  full plugin-owned callback/event ABI coverage.

## Workstreams (independent tracks may run concurrently)

| Track | Planned work | Mandatory test gate | State |
| --- | --- | --- | --- |
| P0 Secure bridge | Trusted packaged UI; host-supplied frame/origin identity; per-method grants; navigation invalidation | A1-SEC-01–07 on 3 real engines | NOT STARTED |
| P1 Bidirectional plugin callbacks | Plugin→JS named invoke/event, async results, event subscription/unsubscribe, callback lifetimes across reload/destroy/unload | A1-CB-01–05 | NOT STARTED |
| P2 CLI and new-app workflow | xweb new/restore/run/build/test/publish/doctor + plugin new/build, versioned manifest, SDK download/cache | A1-CLI-01–05 | NOT STARTED |
| P3 Embeddable native hosts | Minimal Win32 HWND + Linux GTK3 host examples, real bridge/plugin | A1-HOST-01–03 | NOT STARTED |
| P4 Official language wrappers | Python & C# minimal stable-C-boundary calls, async/error/callback/lifetime example | A1-WRAP-01–03 | NOT STARTED |
| P5 Engine packaging | Portable SDK artifacts, CEF resources/ICU, WebView2 Evergreen diagnostics, third-party notices | A1-DIST-01–04 | CORE-ONLY BASELINE |
| P6 Release validation | Both stories from fresh machines, negative security, unload stress, reproducibility | All required release matrix cases | NOT STARTED |
| P7 Approval | Versioned deliverables / changelog / draft PR review | Explicit authorization to merge/publish | REQUIRES APPROVAL |

## Dependency-aware order

1. Start **secure native dispatch policy** and minimal **CLI manifest/
   command skeleton** in separate changes. Define failing security tests.
2. Implement **plugin→JS callback/event vertical slice** and C ABI lifetime
   rules without weakening unload/worker guarantees.
3. In parallel, implement Win32/GTK3 embedding and Python/C# wrapper
   proofs against the tested native Core.
4. Connect CLI restore/build/run to installable engine SDK packaging and
   plugin fixture; test both new-project and existing-host paths.
5. Gate release using actual Windows/Linux host/browser/plugin/CLI/wrapper
   CI, clean consumer and negative security tests, not only Core CTest.
6. Deliver a release candidate for approval; do not merge/publish unapproved.

CLI usability is a **core product requirement**, not a late optional add-on.
Extended CLI ecosystems/templates and full wrapper API parity remain future
milestones, but their *minimum working vertical slices* are release gates.

## Operating policy

- On failure, log reproduction, observed/expected, environment, impact,
  severity, and fix/CI evidence in `ISSUE_LOG.md`; keep independent tasks
  progressing.
- Follow: implement → focused regression → real browser/host/CLI smoke →
  full affected CI matrix → issue close with run URLs.
- Never claim mock/fixture-only success as real end-user functionality.
- Keep Draft PR #7, do not modify `main` or publish without approval.
- Request approval only for material breaking ABI/API, unsafe permission
  changes, material scope or expense, and final merge/release.
