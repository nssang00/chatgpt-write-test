# Orbit Explorer 0.3 CI — user-supplied ES Lite APK audit

Independent implementation inspired by feature-level examination of ES Lite v4.4.0.2.1 (versionCode 15175, targetSdk 27).

Base 0.1 + 0.2 deltas are restored unchanged; 0.3 delta has SHA-256 `e12a3dbe760095ca0039f778d581538c04cf284a856f2da6e3c07db6e0dea98e`.

The 0.3 source bundle adds: light file manager home UI, storage shortcuts, bounded media/doc/APK/archive categories, favorites, up to 10 independently navigable tabs and swipe switching, breadcrumb navigation and legacy Android 8/9 permissions.

Workflow runs JVM regression, static audit and `:app:assembleDebug`. A second job attempts an Android 15 emulator launch + UI hierarchy assertion and a screenshot. Check each job's independent conclusion; one successful job does not establish full completion. Real device, NAS/SMB, FTP/SFTP, media preview, cloud, app manager, and pixel parity remain unverified or unimplemented.

Analysis: `OrbitFiles/docs/ES_APK_AUDIT.md` after restoring source.
