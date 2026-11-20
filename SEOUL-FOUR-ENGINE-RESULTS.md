# Seoul Gangnam / Yeoksam — four-engine real-GPU comparison

## Result and provenance

- **GitHub Actions run:** https://github.com/nssang00/chatgpt-write-test/actions/runs/44647440796
- **Date:** 2026-11-20 (KST)
- **Git branch:** bench/seoul-gangnam-four-engines-20261120
- **Bounding box [west,south,east,north]:** [127.0310, 37.4960, 127.0450, 37.5080]
- **Region:** Gangnam-gu / Yeoksam-dong / Teheran-ro, Seoul, Republic of Korea; roughly 1.7 square kilometers
- **Input building shapes and roads:** live OpenStreetMap raw-data API (OSM data attribution required)
- **Actual test DEM:** AWS/Mapzen Terrarium Z13; NOT NGII. Native NGII Seoul raster was **not available**; never mislabel these measurements as NGII.
- **Buildings:** 2,085 OSM footprint-derived buildings; of these, 1,813 lacked height tags and used **procedurally inferred heights**.
- **Procedurally generated detail:** 302,427 facade window panels, 1,628 trees, 2,085 modeled rooftop units; these are **not surveyed real buildings**.
- **Detailed material meshes:** 1,638,093 triangles (terrain mesh additionally 18,432 triangles)
- **Fixture:** about 215 MB uncompressed JSON; all engines receive **identical** terrain and facade mesh arrays
- **Camera:** same close-up orbit and 60-degree vertical FOV converted to the proper engine convention
- **Viewport:** 1280 × 720
- **GPU:** NVIDIA GeForce RTX 5060 Ti; Chromium WebGL2 / ANGLE Direct3D11 hardware renderer (not SwiftShader)
- **Order:** CesiumJS, PlayCanvas, Three.js, Babylon.js, Babylon.js, Three.js, PlayCanvas, CesiumJS
- **Sampling:** 2 rounds per engine; 189 measured post-warmup animation intervals each
- **Graphics conditions:** same unlit color materials, no shadows, IBL, textures, 3D Tiles, city-chunk streaming, tiled DEM LOD, or physical simulation.

## Raw summary

| Engine | Mean effective rendered FPS (two runs) | p50 frame interval (ms) | p95 frame interval (ms) |
| --- | ---: | ---: | ---: |
| CesiumJS | 57.0326 | 17.4 | 18.4 |
| PlayCanvas | 57.1093 | 17.4 | 18.2 |
| Three.js | 56.9767 | 17.4 | 18.2 |
| Babylon.js | 56.8054 | 17.5 | 18.3 |

The difference between highest and lowest mean FPS is 0.304 FPS (about 0.5%). This is **not a reliable engine performance ranking**, because browser frame synchronization caps the observed frame rate near 57 FPS and hides true maximum throughput. Load-to-first-frame and peak RAM/VRAM were **not measured**, and the huge 215 MB fixture is preloaded rather than spatially streamed.

## Observations and limitations

- All 4 engines rendered the same dense OSM-derived city successfully on an actual GPU. Compared with the previous Daejeon scene (~68 buildings), this is a more representative city geometry load, but not a scalable whole-country workload.
- Appearance differences arise from renderer handling of identical unlit meshes. Buildings have invented facades, window patterns, rooftop objects and heights where OSM tags were absent; therefore the screenshot must **not** be described as a precise reconstruction of Seoul.
- Roads are still approximated as separate segments and junctions have not been properly meshed. Changing the DEM does not fix road connectivity or overpass/underpass modeling.
- The test explicitly *excludes* Cesium's native 3D Tiles and PlayCanvas/Three.js/Babylon.js spatial streaming; it therefore cannot establish which engine is more scalable for Korea-wide city data.
- Save GPU screenshots and round-by-round JSON from the linked Actions artifact while it is available (retention policy 14 days).
- For NGII terrain, use the importer on this branch and provide actual authentic NGII raster coverage for this new Seoul bbox. Source data is required. The previous KST synthetic importer test is not a real NGII render.

## Reproduce

    cd geobench
    npm install
    npm run data
    GEO_TEST_KIND=hardware npm run bench

The screenshots and benchmark.json are available in the Actions artifact **seoul-dense-four-engine-gpu-results**. Preserve them locally if needed beyond artifact retention.
