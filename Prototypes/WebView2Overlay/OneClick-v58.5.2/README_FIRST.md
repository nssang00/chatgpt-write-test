# WebView2 v58.5.2 Windows OneClick — r2 Unity RectInt comparison fix (EXPERIMENTAL)

**r2 fix:** replaces unsupported Unity 2022.3 `RectInt != RectInt` comparison with explicit x/y/width/height checks. Retains r1 `com.unity.modules.jsonserialize` for `JsonUtility`. Both were found by Windows Unity builds; CI checks source contracts, but does NOT build Unity Player.

**Disk space:** The first log warned the Unity project drive had less than 1 GB available. Free at least 10 GB on the extraction/project drive before retrying, or extract this ZIP to another drive with sufficient free space. Use a fresh folder; do not overwrite the old generated UnityProject cache.

1. Download the complete GitHub Actions artifact webview2-v58-5-2-windows-oneclick-r2. It includes the native x64 DLL.
2. Extract to a NEW folder such as C:\wv2-v58.5.2\. Do not overwrite/copy into validated CEF v58.4.4 oneclick_bundle.
3. Install Unity Editor 2022.3.62f3 with Windows Build Support (Mono backend), activate its license, and install Microsoft WebView2 Evergreen Runtime.
4. Double click Run-All.cmd. It checks all package SHA256 hashes, builds a temporary Unity Windows Player, runs visible Player for 35 seconds, writes automatic evidence and exits.
5. Upload results/webview2-v58.5.2-YYYYMMDD-HHMMSS.zip and complete MANUAL_CHECKLIST.md.

Optional Windows command line: Run-All.cmd -UnityExe "C:\Path\Unity.exe" -AutoSeconds 55.

A result of PENDING_MANUAL means Unity built, native controller was ready and JS-to-native-to-JS ack was received, but Korean IME, focus, visual placement, multi-monitor DPI and cleanup are NOT certified. Github hosted CI cannot run licensed Unity 2022.3 or interactive IME tests and only proves MSVC build, native ABI, static source contracts and file checksum preflight. This is NOT an official backend or signed GA. CEF v58.4.4 internal baseline is untouched.
