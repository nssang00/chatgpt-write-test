# KiteFiles ES Lite-inspired Android build

This folder overlays the original KiteFiles source archive with the new source patch. Both binary tar.xz inputs are SHA-256 pinned by the Android Actions workflow. Existing root CMake code is untouched.

See `kitefiles/README.md` after extracting the patch for the exact behavior/limitations and `kitefiles/docs/ES_LITE_APK_ANALYSIS.md` for the user-provided APK static feature analysis.

The GitHub Action builds a **debug** APK (not production-signed), tests core file operations, real files, local storage security and checks the Android manifest/cryptographic APK signature. A successful APK build does NOT prove NAS compatibility until tested against an actual SMB server.

## Navigation validation

Build validation for the 2.1 drawer (top-left hamburger, storage and network shortcuts) and swipe-transition update is performed by the isolated Android GitHub Actions workflow. The existing CMake application is unaffected.
