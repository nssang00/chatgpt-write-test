# Orbit Files 0.2.0 — source delta and Actions build

This project builds on the original Orbit Files 0.1.0 package in `android/orbit-files-source`, and only patches the independent `OrbitFiles/` application. It does not change any existing CMake source or CI configuration.

The v0.2 archive is stored as base64 at `android/orbit-files-v02/delta.b64`. The v0.2 Actions workflow verifies its SHA-256 before applying it to the base source, then executes the original Java core tests, a static audit and Android `:app:assembleDebug`.

Delta SHA-256 (XZ TAR): `49b0fffb6923760691214aaefb7191edbab65341a0beee9caf6373e58c5bb735`.

The changes include opt-in broad shared-storage access on Android 11+, SAF fallback, SMB2/3 manual shares, in-memory credentials, and portrait swipe between workspaces A/B. The Google Play All Files Access declaration/review is required before store publication; building an APK does not constitute a grant or device/network integration test.

See `OrbitFiles/README.md` and `OrbitFiles/docs/PRIVACY.md` inside the extracted build workspace. Android 8-10 remain SAF-first rather than silently accessing their entire shared storage.
