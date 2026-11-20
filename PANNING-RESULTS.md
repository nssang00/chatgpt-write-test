# Seoul Gangnam OSM/DEM — camera panning FPS (2026-11-20)

**Actual hardware test:** https://github.com/nssang00/chatgpt-write-test/actions/runs/44649357929  
**Source:** geobench/run-panning.mjs and geobench/main.js in this branch.

- Same Seoul Gangnam/Yeoksam OSM scene, 2,085 buildings and ~1,638,093 detailed procedural triangles, in **all four engines**.
- The terrain is **AWS/Mapzen Terrarium**; a genuine NGII DEM was NOT used for this run.
- 1280 x 720, Chrome WebGL2 ANGLE D3D11, self-hosted NVIDIA RTX 5060 Ti.
- Same fixed FOV, camera heading, altitude; camera eye and target **translate east together** by 840m during 260 measured frames (after 60 warmup rAF frames).
- Two passes per engine, ABCCDDCBA order. Static camera control and pan occur on the same page.
- Scene **fully loaded upfront**; no geography-aware streaming, no camera-triggered tile downloads or LOD refinement; unlit color shaders, no dynamic shadows.
- The frame timing is browser rAF cadence **affected by frame synchronization**, not GPU kernel-level drawing time.

| Engine | Stationary FPS | Panning FPS | Pan minus static | Pan p50 (ms) | Pan p95 (ms) | Pan p99 (ms) | >33ms intervals |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| CesiumJS | 56.98 | 56.76 | -0.22 | 17.4 | 18.3 | 18.9 | 0 |
| PlayCanvas | 57.02 | 56.98 | -0.05 | 17.5 | 18.3 | 18.4 | 0 |
| Three.js | 57.00 | 57.01 | +0.01 | 17.4 | 18.2 | 18.3 | 0 |
| Babylon.js | 56.93 | 56.97 | +0.04 | 17.4 | 18.2 | 18.4 | 0 |

**Conclusion:** No meaningful difference at this browser-vsync-constrained sample. All four complete the 840m pan without a frame interval >33ms in the measured samples. These numbers cannot rank unconstrained GPU throughput, and do not measure initial loading, geographic chunk/LOD streaming or geographic scalability.

Screenshots: GitHub Actions artifact `seoul-four-engine-panning-fps-results` stores the four raw 1280x720 snapshots at the **same panning midpoint** plus per-pass `pan-benchmark.json`. The 14-day artifact retention policy applies.

Remaining work for actionable scalability:
1. Camera pan with geographic tile streaming enabled in each engine; measure tile requests, time-to-first-view, resident CPU/GPU memory and LOD quality.
2. Browser without restrictive vsync or with calibrated GPU timing, and a heavier scene.
3. Mobile device test, where memory bandwidth, texture formats and draw calls can dominate.
