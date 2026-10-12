# NativeWeb issue log (2026-10-13)

Issues should be appended, not silently discarded. A blocked task does not block independent work.

## NW-001 Release-only plugin regression failure — FIXED / IN GITHUB
- Priority: P1. Scope: `plugin.object_factory`, `plugin.webview_facade`.
- Reproduction: configure and build the browser-E2E ZIP in CMake Release with tests ON, then run `ctest --output-on-failure`.
- Failure: 19/21 pass; both failing tests throw `Plugin has live native objects or object calls`.
- Cause: `assert(...)` contained side-effecting `runtime.release` calls. `NDEBUG` removed the release entirely. In addition, `assert(waitUntil(...))` in `plugin.async_lifetime` skipped race synchronization.
- Local fix: shared `test_require.hpp` and unconditional `NW_REQUIRE(...)` checks in all three plugin regression sources. Retest: Linux GCC 14.2, Release 21/21 pass, Debug 21/21 pass; 3 targeted plugin tests repeated 30 times each after source import (90 repetitions).
- GitHub source import 377a5444; Linux and Windows Core Regression run 38314597138 PASS. No release gate blocked by this defect.

## NW-002 Browser E2E completion — PARTIAL, CEF PENDING
- Priority: P1 release gate. The Linux workspace has no extracted CEF SDK, and it has no Windows WebView2 runtime.
- Windows WebView2 actual-browser plugin E2E PASS on workflow 38314597431 and 38314779373. Linux CEF/Windows CEF still require successful actual engine tests.
- Next: inspect Linux/Windows CEF results from rerun 38314779373; preserve job logs and repair failures.

## NW-003 GitHub branch behind ZIP — RESOLVED
- Priority: P1. `main` at `43639459c97044feed1d2f8020979f589c99ef96`; latest browser-E2E ZIP contains uncommitted plugin changes.
- `.github/workflows/browser-plugin-e2e.yml` absent from `main`.
- Imported 33 changed/new files in 377a5444 plus 5 originally omitted baseline files in 5b8e75b2. All 125 ZIP paths exist on PR branch; 122 blob hashes match exactly. Three deliberate exceptions are PR-owned execution/issue/acceptance docs, kept at their newer revision. `main` remains unchanged; do not merge without approval.

## NW-004 Container GitHub clone DNS failure — WORKAROUND
- Priority: P2 infrastructure. `git clone https://github.com/nssang00/chatgpt-write-test.git` failed: `Could not resolve host: github.com`.
- The connected GitHub integration can read/write branches and files. Local ZIP builds are not affected.
- Next: use a permitted source-sync transport or an environment with Git network access; continue independent tests.

## NW-005 Installed Core SDK packaging — PASS (CORE ONLY)
- Priority: P2 independent workstream; does not unblock NW-002 or NW-003.
- Source: CMake install/export, native C++11 consumer, Linux and Windows GitHub Actions in PR #7.
- Local evidence (latest ZIP): Linux Release 21/21, install success, installed consumer 1/1, relocated-prefix consumer 1/1.
- On full plugin-integrated branch commit 377a5444: GitHub installed SDK consumer workflow 38314597217 PASSED Linux/Windows; Core Regression 38314597138 PASSED Linux/Windows. Separate engine distribution packaging remains out of scope and unverified.
- Next: separately define/install CEF/WebView2 distribution/package and security policy before release.

## NW-006 First browser CI lacked pinned CEF bootstrap scripts — FIXED, RERUN IN PROGRESS
- Priority: P1 (test infrastructure). Run 38314597431 Linux CEF and Windows CEF failed at bootstrap, before compile/browser execution, because `tools/bootstrap_linux.sh` and `tools/bootstrap_windows.ps1` were omitted from initial GitHub source import.
- Fix: restored both scripts, pin.env, probe_linux.sh, SNAPSHOT_SHA.txt in commit 5b8e75b2. Source-list and blob parity verified.
- Windows WebView2 passed independent of CEF bootstrap. Follow-up run 38314779373 started; both CEF jobs in progress at this checkpoint.
- Do not label CEF E2E passed until successful job/checkpoint evidence is available.

## NW-007 Linux CEF ICU startup crash — FIX IMPLEMENTED, BROWSER RETEST PENDING
- Priority: P1 runtime E2E. Runner 38314779373 compiled Linux CEF and plugin fixture successfully but the actual browser test exited 133 at startup: `Invalid file descriptor to ICU data received` (`base/i18n/icu_util.cc:232`); none of the four JS plugin checkpoints were reached.
- Comparison: previously passing CEF bridge CI starts the executable with its runtime bin directory as cwd and passes `--no-sandbox`. The new Python E2E runner omitted both.
- Hypothesis: different Chromium subprocess launch context caused ICU resource/FD handling failure; not confirmed until real-browser rerun.
- Fix in 0af8c271: pass `--no-sandbox`, launch from the CEF runtime bin directory. Python syntax passed; local fake executable smoke confirmed cwd, flag, and checkpoint parsing. Fake executable is NOT evidence of real browser functionality.
- Verification: actual SDK-backed browser rerun 38315301893 is in progress. If it still fails, collect the CEF job logs and investigate startup/ICU resource descriptors further. Do not mark PASS without job evidence.

## NW-008 Windows CEF SDK extraction stalls in tar.exe — FIX SUBMITTED / CI PENDING
- Priority: P1; Windows CEF actual-browser E2E blocked, while Linux CEF and Windows WebView2 succeeded.
- Runs 38315301893, 38315497991, 38315691707: pinned 144 MB archive downloaded and SHA1 ce9d951914e79f179e224f3ba9d55d9363696efe verified; tar.exe -xjf then stalled until 45-minute job timeout before build.
- Change: split bzip2 and tar extraction using installed 7-Zip; keep SHA1 checks, add offline fixture and a per-step 20-minute timeout.
- Pending evidence: fixture, archive extraction, Windows CEF compile, and real JS lifecycle E2E must all pass. Fixture success alone is not a browser pass.

## NW-009 Windows CEF CI concurrent runtime-file copy — FIX SUBMITTED / E2E PENDING
- Priority: P1; occurred after NW-008 extraction succeeded.
- Run 38321964829 Windows CEF compiled/linked two integration executables in parallel. Both CMake COPY_FILES post-build rules copy the same Resources/locales folder to build/cef/bin; cmake -E copy_directory on nativeweb_cef_multi_webview_integration returned exit code 1 (MSB3073).
- Root cause inference: concurrent post-build copies to the shared bin directory; source distribution layout was verified and bridge executable linked successfully.
- Fix: browser plugin E2E job explicitly builds only nativeweb_cef_bridge_integration and nativeweb_plugin_browser_fixture, sequentially. Multi-WebView executable is unrelated to this E2E; its separate existing CI remains unchanged.
- Next: rerun real Windows CEF browser and verify all JS checkpoints; full parallel-target build race remains worth a separate CMake fix if all-target builds are required.

## NW-009 Underlying CMake runtime staging race — FIX SUBMITTED / FULL BUILD CI PENDING
- In tests/integration/cef/CMakeLists.txt, primary bridge is sole owner of COPY_FILES and multi-WebView depends on it for resource ordering.
- Windows E2E now runs a full parallel CEF integration build (both executables + plugin fixture) to exercise the corrected dependency graph.
- Only a passing full Windows CEF compile and real browser JS E2E can close NW-009.
