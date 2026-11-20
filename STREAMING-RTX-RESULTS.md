# Verified Seoul 4-engine streaming benchmark on self-hosted RTX 5060 Ti

**Date:** 2026-11-20  
**Successful GitHub Actions run:** https://github.com/nssang00/chatgpt-write-test/actions/runs/44656208400  
**GPU renderer:** ANGLE (NVIDIA GeForce RTX 5060 Ti Direct3D11 vs_5_0 ps_5_0), Chrome WebGL2.  
**Code:** this branch, geobench/pack_stream_tiles.mjs, streaming-main.js, run-streaming.mjs.

## Test specification

- Seoul Gangnam / Yeoksam, 2,085 authentic OSM building footprints, procedurally fabricated facades.
- Terrain: AWS Mapzen Terrarium, **not** NGII high-resolution DEM.
- 144 geographic grid tiles, common JSON tile geometry and TWO tiered levels of detail for every engine; 1,656,525 full-detail total triangles and 49,355 low-detail total triangles.
- All four engines share the exact same request priority scheduler, tile requests and data, but construct/dispose their own scene meshes. This does **not** test Cesium's native `Cesium3DTileset`.
- Two complete hardware passes per engine, reverse symmetric order (Cesium / PlayCanvas / Three / Babylon / Babylon / Three / PlayCanvas / Cesium).
- 1280×720, unlit materials; fixed camera heading, initial geometry NOT preloaded; 360 samples per pass and mode. Browser rAF pacing near 57 FPS masks peak throughput differences.
- Sweeping camera crosses 1080 meters, fast scrubbing alternates 480m east/west every 45 frames.

## RTX 5060 Ti measurements

| Engine | Sweep FPS | Sweep P95 ms | Sweep >33ms / 720 | Scrub FPS | Scrub P95 ms | Scrub >33ms / 720 |
|---|---:|---:|---:|---:|---:|---:|
| CesiumJS | 54.74 | 36.2 | 52 | 47.04 | 48.2 | 112 |
| PlayCanvas | 57.00 | 23.9 | 2 | 54.52 | 31.9 | 35 |
| **Three.js** | **57.24** | **22.4** | **2** | **56.60** | **29.0** | **21** |
| Babylon.js | 56.74 | 25.8 | 2 | 55.13 | 31.0 | 30 |

Sweep data load per engine per pass: 164 tiles and 96.85 MB; 0 errors.
Scrub data load per engine per pass: 297 tiles and 216.28 MB; 0 errors.

### Direct scene-upload preparation time (main-thread only; not necessarily GPU completed)

| Engine | Mean sweep tile-mesh construction total | Mean fast-scrub construction total |
|---|---:|---:|
| CesiumJS | 171.05 ms | 388.30 ms |
| PlayCanvas | 290.35 ms | 537.60 ms |
| Three.js | **32.90 ms** | **68.50 ms** |
| Babylon.js | 386.70 ms | 826.40 ms |

This timing is measured around each tile material-to-mesh creation call; GPU driver allocation can be deferred. It is not GPU profiler time. It does not by itself explain all frame-time differences.

Peak JS heap (sampled, not GPU VRAM):
- Sweep: Cesium 243.1MB, PlayCanvas 197.4MB, Three.js 156.7MB, Babylon.js 267.9MB.
- Scrub: Cesium 294.1MB, PlayCanvas 309.7MB, Three.js 213.0MB, Babylon.js 318.0MB.

## Important interpretation

**Three.js is the best performer among these particular custom tile renderer integrations on this RTX machine**, especially during rapid direction changes.

**Do not conclude** that Cesium is intrinsically slower for geospatial streaming. This custom implementation creates a synchronous, separate `Cesium.Primitive` for each material/tile and deliberately bypasses its highly optimized `Cesium3DTileset` / 3D Tiles cache/LOD stack. The "fair" same-geometry test is not the "fair" same-native-optimization test. Also, meshes are loaded on a local Vite server without mobile-network latency and the geometry includes manually generated approximation windows.

The first Cesium boot in the run was 8,120ms, second boot 1,240ms, consistent with one-time initialization/cache differences. Do not treat the average as a stable cold-start fact.

## Reproduction

Run under GitHub Actions: `.github/workflows/geo-seoul-streaming-stress.yml`. To reproduce on self-hosted RTX, push this branch or manually dispatch the workflow. The workflow generates a clean Seoul tile set from OSM/Terrarium (the source may change), builds 144 common tiles, runs the hardware GPU path, and publishes screenshots and `streaming-benchmark.json`.

Raw capture artifact is attached to run #44656208400 (14-day retention). Source remains in this branch.

## Next differentiating comparison

Prepare a real 3D Tiles dataset with Cesium-native loading versus 3DTilesRendererJS for other engines, and test 30–50km2 plus a representative midrange Android device. Compare non-vsync render latency, VRAM as reported by reliable GPU profiling, full-tile startup, network throttling, and sustained 10-minute camera tours before making a long-term architectural decision.
