# WebView2 v58.5.2 Windows OneClick — r3 shutdown lifecycle gate (EXPERIMENTAL)

**r3 fix:** r2 Unity Player now successfully builds and WebView2 JS ↔ native roundtrips PASS (4/4), but r2 logs show three shutdown timeouts (-30). r3 requests shutdown while the Unity Player is running and polls for native STA thread termination before emitting PASS_AUTO. Failure to join is a strict FAIL_AUTO. R1 JSONSerialize and r2 RectInt compatibility fixes are retained. No runtime fix is claimed until the new Windows result passes.

**Disk space:** The first log warned the Unity project drive had less than 1 GB available. Free at least 10 GB on the extraction/project drive before retrying, or extract this ZIP to another drive with sufficient free space. Use a fresh folder; do not overwrite the old generated UnityProject cache.

1. Download the complete GitHub Actions artifact webview2-v58-5-2-windows-oneclick-r3. It includes the native x64 DLL.
2. Extract to a NEW folder such as C:\wv2-v58.5.2\. Do not overwrite/copy into validated CEF v58.4.4 oneclick_bundle.
3. Install Unity Editor 2022.3.62f3 with Windows Build Support (Mono backend), activate its license, and install Microsoft WebView2 Evergreen Runtime.
4. Double click Run-All.cmd. It checks all package SHA256 hashes, builds a temporary Unity Windows Player, runs visible Player for 35 seconds, writes automatic evidence and exits.
5. Upload results/webview2-v58.5.2-YYYYMMDD-HHMMSS.zip and complete MANUAL_CHECKLIST.md.

Optional Windows command line: Run-All.cmd -UnityExe "C:\Path\Unity.exe" -AutoSeconds 55.

A result of PENDING_MANUAL means Unity built, native controller was ready and JS-to-native-to-JS ack was received, but Korean IME, focus, visual placement, multi-monitor DPI and cleanup are NOT certified. Github hosted CI cannot run licensed Unity 2022.3 or interactive IME tests and only proves MSVC build, native ABI, static source contracts and file checksum preflight. This is NOT an official backend or signed GA. CEF v58.4.4 internal baseline is untouched.

### Privacy and diagnostics

The r2 result ZIP included Player executables and an EBWebView browser profile, potentially containing session/history data. **Do not redistribute that ZIP publicly.** r3 result archives only summary.json, Unity editor/player logs and JSON runtime evidence; Unity logs can still contain local paths and network adapter details. Review logs before sharing.

PASS_AUTO in r3 requires WebView2 native STA thread join with `shutdownPhase==7`, zero error and successful JS roundtrip. A failed cleanup is FAIL_AUTO, not PENDING_MANUAL. Manual focus/IME/DPI checks still remain.
