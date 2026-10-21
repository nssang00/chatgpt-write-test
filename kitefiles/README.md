# KiteFiles Android APK build

This directory contains KiteFiles's Android production sources packaged as `kitefiles.tar.xz` (11 source and Gradle/resource files).

The archive is unpacked in CI without modifying the repository's existing CMake project. SHA-256: `dd378dbd9dd679c78f19058d4aadb1397f4c413d758dc23c1a7e0c4b04c595ba`.

Workflow: [KiteFiles Android Debug APK](../.github/workflows/kitefiles-debug-apk.yml). The GitHub Actions artifact `KiteFiles-debug-apk` contains a signed **debug** APK, not a production release signature.

Source code is also available in the separately delivered KiteFiles v1.0.1 source archive. This CI folder is intentionally scoped to this test build and does not modify existing root project configuration.
