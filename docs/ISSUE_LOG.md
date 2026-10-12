# NativeWeb issue log (2026-10-13)

Issues should be appended, not silently discarded. A blocked task does not block independent work.

## NW-001 Release-only plugin regression failure — FIXED LOCALLY, NOT MERGED
- Priority: P1. Scope: `plugin.object_factory`, `plugin.webview_facade`.
- Reproduction: configure and build the browser-E2E ZIP in CMake Release with tests ON, then run `ctest --output-on-failure`.
- Failure: 19/21 pass; both failing tests throw `Plugin has live native objects or object calls`.
- Cause: `assert(...)` contained side-effecting `runtime.release` calls. `NDEBUG` removed the release entirely. In addition, `assert(waitUntil(...))` in `plugin.async_lifetime` skipped race synchronization.
- Local fix: shared `test_require.hpp` and unconditional `NW_REQUIRE(...)` checks in all three plugin regression sources. Retest: Linux GCC 14.2, Release 21/21 pass, Debug 21/21 pass; 3 targeted plugin tests repeated 10 times each.
- Next: port the fixed sources to GitHub integration branch, run Windows Release CTest.

## NW-002 Real browser E2E not run — BLOCKED ON ENGINE SDK / CI
- Priority: P1 release gate. The Linux workspace has no extracted CEF SDK, and it has no Windows WebView2 runtime.
- The existing E2E harness and workflow are not proof of a browser pass.
- Next: sync current sources/CI, run engine-specific CI, collect browser checkpoint/log evidence.

## NW-003 GitHub main behind ZIP — IN PROGRESS
- Priority: P1. `main` at `43639459c97044feed1d2f8020979f589c99ef96`; latest browser-E2E ZIP contains uncommitted plugin changes.
- `.github/workflows/browser-plugin-e2e.yml` absent from `main`.
- Next: integrate full source into `nativeweb/autonomous-integration`, open PR and verify CI. Do not merge into main without approval.

## NW-004 Container GitHub clone DNS failure — WORKAROUND
- Priority: P2 infrastructure. `git clone https://github.com/nssang00/chatgpt-write-test.git` failed: `Could not resolve host: github.com`.
- The connected GitHub integration can read/write branches and files. Local ZIP builds are not affected.
- Next: use a permitted source-sync transport or an environment with Git network access; continue independent tests.

## NW-005 Installed Core SDK packaging — IN PROGRESS
- Priority: P2 independent workstream; does not unblock NW-002 or NW-003.
- Source: CMake install/export, native C++11 consumer, Linux and Windows GitHub Actions in PR #7.
- Local evidence (latest ZIP): Linux Release 21/21, install success, installed consumer 1/1, relocated-prefix consumer 1/1.
- GitHub CI still uses the earlier main source snapshot until NW-003 is fixed. New SDK workflow verifies the packaging code path, not the missing plugin source.
- Next: verify both Linux and Windows installed-consumer CI jobs; promote packaging gate only after successful results.
