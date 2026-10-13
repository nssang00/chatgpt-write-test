# M5 / OL 10.10.0 Actions setup

Two workflows are registered on the default branch:

1. [M5 Basic Render and OL 10.10.0 CPU](../workflows/m5-basic-render-ol1010.yml) — hosted Ubuntu software WebGL, sequential correctness -> uninstrumented CPU/load -> OL WebGL comparison, with screenshot and JSON artifacts.
2. [M5 GPU Layer Feature Bench](../workflows/m5-hardware-gpu.yml) — manual hardware GPU tests on a **self-hosted interactive Windows runner** with labels `self-hosted`, `Windows`, `X64`, `m5-gpu`. It must have an installed Chrome/Edge and a real GPU. This is not equivalent to an ordinary `windows-latest` runner.

## Required project bundle

The default branch currently contains a separate NativeWeb project, **not the M5 renderer + four Seoul PBF files**. CI must not report a success without those sources.

To enable a run, take the complete `project.zip` prepared in ChatGPT (same bytes as the 4-stage ZIP, filename adapted for GitHub) and either:

- Commit the exact binary ZIP into this repository at `m5-ci/project.zip` (4.8 MB), or
- Upload it to a trusted GitHub release/HTTPS location and paste that publicly retrievable HTTPS direct-download URL into the workflow's `project_archive_url` field. The URL is not a ChatGPT sandbox link.

Both workflows stop with an explicit error if the package is absent. The package includes `our-renderer`, `baseline-our-renderer`, OL 10.10.0 runtime, and offline MVT fixtures. Each run prints the input ZIP SHA-256.

## Coverage and interpretation

- Stage 0: source regression tests, including geometry clipping and offline PBF decode.
- Stage 1: OL WebGL and M5 real *nonblank* screenshot pixels and M5 framebuffer readback. Any blank or GL error fails the gate. A nonblank result does not imply pixel-perfect parity.
- Stage 2: no profiler and no `readPixels()` in the timing run. Cold wall, warm `renderSync()`, pan/pan-back, main-thread long tasks, and JS heap. Warm renderSync is **not** GPU frame-complete latency.
- Stage 3: M5/OL 10.10.0 speed ratio is reported only when decoded feature counts and loaded tile counts match. Baseline source/style/resolution must stay fixed. Cold p50 M5/OL ratio defaults to a strict <=1.0 target; slower runs fail the performance stage.
- Stage 4: hardware GPU feature-cap 1, 8, 32/all; Road/Building/Water/Point (place_label); style 1,4,8; 4/8-layer mixed tests. A separate same-context pixel-determinism probe is diagnostic, not a timing score.

Known issue from previous RTX runs: alpha-blended redraws can differ by 1 channel level even within one M5 version. Strict cross-version pixel-diff=0 is **not** proven by these checks. This Actions setup does not alter renderer source.

**Do not use a performance result from a failed render gate.** A GitHub workflow file existing is not evidence that tests passed.

## Pinned input artifact (2026-10-13)

Exact archive to upload: `M5_OL1010_4Stage_CI_Project_20261013.zip` (4,810,330 bytes).

SHA-256: `62c906b8b00bf9cf91752378e0b637aba728500198ec616ca109d62af79a9b88`

Steps in GitHub UI: open the `m5-ci` folder on `main` -> **Add file** -> **Upload files** -> choose the downloaded file named `project.zip` -> Commit to `main`. The resulting path must be exactly `m5-ci/project.zip`. A push touching `m5-ci/project.zip` launches the general CI. Alternatively start Actions -> M5 Basic Render and OL 10.10.0 CPU -> Run workflow with a trusted direct HTTPS ZIP link. The job validates the exact SHA-256 and **fails closed** if it differs.

The ChatGPT GitHub connector can write text files but cannot push the binary ZIP. CI has **not yet run** with this archive; there are no real M5 screenshots from hosted Actions yet.

After the general run, review the uploaded `m5-basic-render-and-ol1010-*` artifact. The CPU hotspot profiler still runs after the smoke gate passes even if the performance comparison fails, to diagnose excessive costs. An unsuccessful render gate always blocks performance measurements.

For real RTX results, register a Windows x64 self-hosted runner with custom label `m5-gpu`, installed Chrome/Edge, current GPU driver, and an interactive user session (headful Chrome). Then manually run **M5 GPU Layer Feature Bench**. No hosted software rasterizer result is a substitute for a real NVIDIA benchmark.
