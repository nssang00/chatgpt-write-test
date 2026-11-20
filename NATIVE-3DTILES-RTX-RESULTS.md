# Native Cesium 3D Tiles vs four custom streaming implementations — RTX 5060 Ti

**Date**: 2026-11-20  
**SUCCESSFUL GPU run:** https://github.com/nssang00/chatgpt-write-test/actions/runs/44659438794  
**Dataset**: 2,085 OSM building footprints in Seoul Gangnam/Yeoksam, procedural facades/windows, AWS Mapzen Terrarium terrain (NOT NGII).  
**GPU**: NVIDIA GeForce RTX 5060 Ti, Chrome ANGLE Direct3D11 WebGL2.

## Implementations

1. **Cesium Native 3D Tiles**: `Cesium.Cesium3DTileset.fromUrl('/native-3dtiles/tileset.json')`. A REAL OGC 3D Tiles 1.1 tileset with 144 spatial cells and two REPLACE LOD levels, actual glTF 2.0 GLB `KHR_materials_unlit` content. SSE=16, cacheBytes=512MiB. ENU/WGS84/ECEF transform constructed from the same origin as source OSM fixture. The GLBs total 64.17MB **on disk**. Native Cesium owns tile selection, loading, cache and unload policy. 144 nonempty spatial cells.
2. **Cesium Custom Primitives**: previous per-tile/per-material, synchronous Cesium Primitive creation with common JS scheduler.
3. **PlayCanvas Custom JSON tiles**: common JS scheduler.
4. **Three.js Custom JSON tiles**: common JS scheduler.
5. **Babylon.js Custom JSON tiles**: common JS scheduler.

The custom JSON tile store contains ~1.66M high-detail triangles and ~49k low-detail triangles; GLB tiles contain the SAME source geometry at these two LODs. **However LOD selection differs:** native Cesium uses screen-space error and keeps a large 512MiB tile cache; custom JS uses fixed distance thresholds with aggressive eviction. Consequently the number of simultaneously resident tiles, visible scene completeness, transfers and warmed-cache behavior are NOT equal, and pure GPU throughput cannot be ranked directly from these results.

Measurement: 2 runs per method, 360 sampled animation frames per mode per run, 1280×720, same camera track, all hardware RTX renderer identities verified. Native measured in the same GitHub GPU run as the four custom loaders.

## Results

| Mode | Sweep FPS | Sweep P95 ms | Sweep frames >33ms / 720 | Fast scrub FPS | Fast scrub P95 ms | Scrub frames >33ms / 720 |
|---|---:|---:|---:|---:|---:|---:|
| Cesium **Native 3D Tiles** | 56.94 | 24.2 | 4 | **57.06** | **21.0** | **2** |
| Cesium custom Primitive | 54.53 | 36.2 | 51 | 47.44 | 49.9 | 107 |
| PlayCanvas custom | 57.07 | 24.3 | 2 | 56.12 | 33.0 | 34 |
| Three.js custom | 57.19 | 22.9 | 2 | 56.38 | 29.2 | 18 |
| Babylon.js custom | 56.89 | 26.3 | 2 | 54.70 | 31.3 | 34 |

Native Cesium had NO tile errors and NO 33ms stalls in either sweep pass beyond the 4 combined occurrences, and only 2 in fast scrub combined.

## Streaming behavior and source of the large advantage during scrubbing

Native 3D Tiles: each sweep pass made 105 GLB HTTP responses and transferred ~23.18MB DURING sweep (some GLBs had already loaded in the initial warmup). Native loaded 62 tile events during sweep; active residency peaked at 159 tile-level content objects including higher/lower LOD. During the subsequent rapid scrubbing phase it had **0 additional GLB response bytes** and **0 additional tile-load events**, as the relevant content remained cached. No tile unlinks (tileUnload) were observed. Actual on-screen city coverage was much wider than the 14 or so active, radius-limited custom tiles shown in screenshots at the camera midpoint.

Custom loaders: each sweep pass downloaded ~96.85MB in 164 tile requests; fast scrubbing ~216.28MB in 297 requests, because the custom eviction policy repeatedly dropped and re-fetched tiles. The comparison therefore demonstrates **native geographic cache and LOD utility**, not only renderer speed.

GLB payloads are binary, custom JSON payloads are text; bytes and parse costs are not directly comparable. Cesium GLB content is internally managed: per-tile CPU mesh construction time and actual loaded triangle counts were **not measured** in the native renderer.

## Browser initial startup caveat

First native Cesium measured coldStartMs 10,011ms, second 726ms; wide difference reflects first-start compilation/caching. Do not use their simple mean (5.37s) as a representative independent cold-start number. Use many clean-profile runs and navigation/resource timing to compare boot time fairly.

## Memory caveat

Sampled peak **JavaScript heap** during fast scrubbing (not GPU VRAM): native 121.9MB; custom Cesium 315.8MB; PlayCanvas 260.5MB; Three.js 243.6MB; Babylon.js 323.2MB. JS heap is only one component of memory and does not measure native engine textures, GPU buffers, caches, or CPU process RSS.

## Product decision

- Native Cesium 3D Tiles is **fully viable** for large geospatial city streaming and a much better evaluation than synchronous custom Primitives.
- Three.js remains a strong lightweight customizable renderer when a team is willing to own its chunking/LOD/caching architecture.
- Do NOT choose Cesium solely because its fast scrubbing performed better here without checking actual GPU VRAM, network pressure, mobile performance, building picking and game interaction.
- A next genuinely fair comparison needs common precomputed GLBs and a matched 3D Tiles loader (where supported), equivalent SSE/LOD, cache budget and camera-visible coverage. A real Android phone can expose different constraints.

## Source / reproduction

- `geobench/pack_native_3dtiles.mjs`: writes real GLB and OGC 3D Tiles 1.1 tileset with WGS84 ENU transform.
- `geobench/native-3dtiles-main.js`: native Cesium3DTileset.fromUrl implementation; does not call manual Cesium.Primitive.
- `geobench/run-native-smoke.mjs`: browser test verified 128 GLB HTTP requests, 105 Cesium tileLoad events, no errors: https://github.com/nssang00/chatgpt-write-test/actions/runs/44658526582 (hosted job succeeded, GPU job failed on a benchmark serializer syntax typo fixed in subsequent commit).
- `geobench/run-streaming.mjs`: five-mode benchmark and sampling methods.
- `.github/workflows/geo-native-3dtiles-gpu-only.yml`: successful stand-alone RTX run against versioned validated data artifacts; avoids repeating slow Linux Chromium installation.

Screenshots and full frame timing JSON are in the successful RTX GitHub Actions artifact (14 day retention). The actual source branch and report remain available.
