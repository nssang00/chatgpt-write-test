# WebView2 v58.5.2 Windows OneClick — r5 Native Echo, wrapper hotfix (EXPERIMENTAL)

**r3 shutdown fix (carried forward): r2 Unity Player now successfully builds and WebView2 JS ↔ native roundtrips PASS (4/4), but r2 logs show three shutdown timeouts (-30). r3 requests shutdown while the Unity Player is running and polls for native STA thread termination before emitting PASS_AUTO. Failure to join is a strict FAIL_AUTO. R1 JSONSerialize and r2 RectInt compatibility fixes are retained. No runtime fix is claimed until the new Windows result passes.

**r4 fix:** r3 Windows Unity Editor compilation failed with CS0103 for Windows-only P/Invoke declarations referenced by shutdown helpers. Guarded the shutdown helpers using the same `UNITY_STANDALONE_WIN && !UNITY_EDITOR` condition as their DllImport declarations. Added real C# compilation tests for BOTH Editor and Windows Standalone preprocessor configurations in GitHub CI.

**Disk space:** The first log warned the Unity project drive had less than 1 GB available. Free at least 10 GB on the extraction/project drive before retrying, or extract this ZIP to another drive with sufficient free space. Use a fresh folder; do not overwrite the old generated UnityProject cache.

1. Download the complete GitHub Actions artifact webview2-v58-5-2-windows-oneclick-r5-wrapper-fix. It includes the native x64 DLL.
2. Extract to a NEW folder such as C:\wv2-v58.5.2\. Do not overwrite/copy into validated CEF v58.4.4 oneclick_bundle.
3. Install Unity Editor 2022.3.62f3 with Windows Build Support (Mono backend), activate its license, and install Microsoft WebView2 Evergreen Runtime.
4. Double click Run-All.cmd. It checks all package SHA256 hashes, builds a temporary Unity Windows Player, runs visible Player for 35 seconds, writes automatic evidence and exits.
5. Upload results/webview2-v58.5.2-YYYYMMDD-HHMMSS.zip and complete MANUAL_CHECKLIST.md.

Optional Windows command line: Run-All.cmd -UnityExe "C:\Path\Unity.exe" -AutoSeconds 55.

A result of PENDING_MANUAL means Unity built, native controller was ready and JS-to-native-to-JS ack was received, but Korean IME, focus, visual placement, multi-monitor DPI and cleanup are NOT certified. Github hosted CI cannot run licensed Unity 2022.3 or interactive IME tests and only proves MSVC build, native ABI, static source contracts and file checksum preflight. This is NOT an official backend or signed GA. CEF v58.4.4 internal baseline is untouched.

### Privacy and diagnostics

The r2 result ZIP included Player executables and an EBWebView browser profile, potentially containing session/history data. **Do not redistribute that ZIP publicly.** r3 result archives only summary.json, Unity editor/player logs and JSON runtime evidence; Unity logs can still contain local paths and network adapter details. Review logs before sharing.

PASS_AUTO in r3 requires WebView2 native STA thread join with `shutdownPhase==7`, zero error and successful JS roundtrip. A failed cleanup is FAIL_AUTO, not PENDING_MANUAL. Manual focus/IME/DPI checks still remain.

### r5 Native Echo
- `Native ping` is a fixed `probe-ping` -> `probe-pong` connectivity check; it NEVER transmits the text entered in the input.
- `Send to Native Echo` transmits the actual input string as UTF-16 across WebView2's string bridge. C++ returns precisely the same value. JavaScript displays it and reports exact `===` equality.
- An automatic fixture `안녕하세요 WebView2 한글 😀` is sent at page load. The native code checks the pinned fixture and accepts an acknowledgment only if it matches the value echoed back; `fixtureUnicodeEchoAckCount > 0` and zero protocol rejections are strict r5 `PASS_AUTO` conditions alongside prior shutdown gates.
- Manually entered Hangul IME and focus/candidate-window behavior remain **PENDING_MANUAL** even if the automatic Unicode fixture passes.
- Result ZIP stores echo **counts/status only**; it does NOT store the user's entered Korean text. As before, Unity logs may still reveal local environment information.


### r5 result-wrapper correction (2026-10-13)
The first r5 Windows Player report passed the native/Unity gates: automatic Unicode fixture echo acknowledgment, ping/pong, zero rejected frames, and STA shutdown join. Its outer Run-All.ps1 falsely returned FAIL with "Wrong player telemetry revision" because it still expected r3 rather than r5. This hotfix reads the expected revision from the SHA-256-validated packaged C# telemetry source instead of duplicating a stale literal. It does not change the DLL, page, Native Echo, or Player runtime semantics. Re-running Unity is **not required to reinterpret the already-uploaded 20261013-225056 result**; manual Hangul IME and typed text Echo remain pending.

### Stage2 Korean manual reviewer (separate validated source branch)

Stage2 review kit (no native or Unity C# changes). Double-click Review-Stage2.cmd, read STAGE2_MANUAL_GUIDE_KO.md, type START, use the visible Unity Player for 180 seconds to perform R01-R09, then record each P/F/N answer in the console. The tool saves results/stage2-review-*.zip with the user-reported checklist plus minimal logs. It does not record input text/screenshots/browser profile and never emits a formal Stage2 PASS. Upload the review ZIP plus 2-4 redacted screenshots and repeated-shutdown evidence.
