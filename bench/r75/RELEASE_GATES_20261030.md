# R75 pinned release-gate evidence — 2026-10-30

**Candidate SHA (unchanged):** `5bbc2c1080db759f2bbc03a5d241dbc8cec7a91d` in `rydolabs/ol-vt-gl-boost` (draft PR #11).
**Hardware:** physical NVIDIA GeForce RTX 5060 Ti, Windows self-hosted `DESKTOP-F97I399`, Chromium ANGLE D3D11, OL 10.10.0, Worker OFF.

## P0 correctness (existing evidence)
- [Cross-repository physical accuracy run 40978282389](https://github.com/nssang00/chatgpt-write-test/actions/runs/40978282389): completed SUCCESS.
- CPU/Worker 17/17, R73/R75 source contracts, 12/12 raw RGBA8 *raced-versus-clean Boost* and exact tile-ID cases; 9/9 real stock-OL fallback checks.
- The 12/12 matrix is **not** a newly performed Boost-versus-stock-OL direct pixel oracle.

## P0 context loss and ABBA benchmark (new evidence)
- [Workflow run 41061631270](https://github.com/nssang00/chatgpt-write-test/actions/runs/41061631270): completed SUCCESS.
- [Raw evidence ZIP artifact 12980750375](https://github.com/nssang00/chatgpt-write-test/actions/runs/41061631270/artifacts/12980750375).
- Two real `WEBGL_lose_context` and `webglcontextrestored` cycles: 2/2 PASS. Both restored 32 retained tile packets, RGBA8 layer FBO and fullscreen quad, GL errors zero, output nonblank and normal exclusive rendering. Host explicitly calls `ResourceManager.handleContextLost()`, backend `restoreContext()`, and boost `restoreAfterContextLoss()`.
- Raw ABBA measurements: 5 measured cold samples per arm/phase, OL-A/Boost-A/Boost-B/OL-B, source counts 8/16/32, 60 raw samples plus warm-ups, fixture data preloaded in both arms.
- Stock OL vs R75 first-complete-frame, ms median:
  - 8 sources: 83.95 vs 40.80 = **51.40%** lower.
  - 16 sources: 147.30 vs 58.80 = **60.08%** lower.
  - 32 sources: 264.75 vs 83.85 = **68.33%** lower.
- Both ABBA positions favor R75; no assertion of sustained FPS, network-load speed or fleet-wide improvement.

## Bounded interaction and host rollback (new evidence)
- [Workflow run 41062103050](https://github.com/nssang00/chatgpt-write-test/actions/runs/41062103050): completed SUCCESS.
- [Raw telemetry artifact 12980960674](https://github.com/nssang00/chatgpt-write-test/actions/runs/41062103050/artifacts/12980960674).
- 150 synthetic viewport pan/zoom/resize cycles, 150 additional frames, zero GL errors, FBO quad reusable; tested viewport dimensions 480,496,504,512 pixels.
- `map.renderSync()` CPU submission durations: median 2.8 ms, p95 3.8 ms, p99 4.1 ms, max 5.7 ms. **These are not user-visible frame latency or sustained FPS.**
- Tracked GPU buffer/texture total remained 2,097,152 bytes during this bounded run. Browser JS heap was 16,214,158 bytes initially and 16,494,985 bytes finally; these are observations, not proof of absence of long-term leaks.
- Host-initiated `boost.stop()` and overlay hide restored stock-OL canvas visibility while preserving center/resolution, but an actual centrally managed production kill-switch policy remains unimplemented.

## Gate decision and remaining blockers
- **P0 physical correctness, real context restoration, exact R75 first-frame benchmark: PASS.**
- **Bounded 150-interaction smoke: PASS.**
- **Production release: NO-GO.** The project remains experimental; OpenLayers `layer.render()` interception uses an unsupported integration seam, app-wide kill switch/telemetry/canary contract is missing, hours-long memory/FPS/p95-pan-tail soak is not proved, external packaging/license terms are undefined, npm package has `private: true` and separate dependency security audit is unverified.
- Preserve candidate SHA and provenance; do not present validation-harness branch SHA as a replacement build.
- `rydolabs/ol-vt-gl-boost` main and R75 candidate were not modified by these tests.
