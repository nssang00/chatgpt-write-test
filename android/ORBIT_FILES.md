# Orbit Files — Android APK CI

This is an independent Android project added without modifying the repository's preexisting CMake application.

The original native Android sources are contained in six base64 chunks in `android/orbit-files-source/`. GitHub Actions concatenates the parts in filename order, decodes an xz-compressed TAR archive, checks its SHA-256, and extracts the `OrbitFiles/` Gradle project. This package representation is used to preserve the complete existing files with the available GitHub connector.

Build: GitHub Actions > **Orbit Files Android APK** > run on `feat/orbit-files-apk`, or let a push/pull request run it. The build uses JDK 17, SDK 35, Gradle 8.9 and Android Gradle Plugin 8.7.3, then uploads `app-debug.apk` as an artifact.

SHA-256 of `orbit-files-source.tar.xz`:

```
b60b69d8949d4b5209109fac740cba971db4f117d92653a56775e943b1bd3254
```

**Scope:** The project is an early version of Orbit Files; it is not a fully featured ES File Explorer replacement. Build success does not equal real-device testing. No release signing credentials are included.

For local extraction:

```bash
cat android/orbit-files-source/part-*.b64 | base64 -d > orbit-files-source.tar.xz
sha256sum -c <<< 'b60b69d8949d4b5209109fac740cba971db4f117d92653a56775e943b1bd3254  orbit-files-source.tar.xz'
tar -xJf orbit-files-source.tar.xz
cd OrbitFiles
gradle :app:assembleDebug
```
