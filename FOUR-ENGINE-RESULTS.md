# Four-engine detailed OSM + DEM city benchmark — 2026-11-20

**Action run:** https://github.com/nssang00/chatgpt-write-test/actions/runs/44641480412  
**Branch:** bench/four-engines-osm-dem-20261120  
**GPU:** NVIDIA GeForce RTX 5060 Ti, Chrome/ANGLE Direct3D11, WebGL2  
**Scene:** Daejeon OSM buildings 68, AWS Mapzen Terrarium DEM, approximately 124,976 triangles, synthetic architectural facades/21,210 window panels, OSM road segments, procedural roof furniture/trees.  
**Viewport:** 1280x720  
**Measurement:** per engine two repetitions, 189 sampled animation frames each; A-B-C-D-D-C-B-A order.  
**Rendering:** unlit color per material; no imagery, shadows, physically-based material, 3D Tiles, engine-level tile streaming. Same world geometry and camera track for all four; four independent graphics implementations.

| Engine | Effective render FPS (average 2 passes) | p50 frame ms | p95 frame ms |
| --- | ---: | ---: | ---: |
| CesiumJS | 56.9843 | 17.5 | 18.4 |
| PlayCanvas | 57.1075 | 17.4 | 18.2 |
| Three.js | 57.0189 | 17.4 | 18.2 |
| Babylon.js | 57.1319 | 17.4 | 18.2 |

**Interpretation:** All four engines rendered the same detailed scene on hardware acceleration, with no meaningful fps separation. Browser frame synchronization capped the throughput near 57 fps; do NOT infer equality in maximum GPU throughput or conclude that any engine is categorically faster. A separate stress and spatial-streaming benchmark is required for full-city workloads.

**Accuracy limitations:** 60 of 68 buildings lack OSM height tags; generated floor counts, facade colors, window locations, rooftop equipment and trees are illustrative, NOT surveyed. Surface is Terrain Terrarium Z13, which does not guarantee Z13 pixel-level accuracy.

**Artifacts:** GitHub Actions run contains screenshots for every engine and benchmark.json with each pass' GPU renderer and measured timings; artifacts expire based on retention policy (14 days). Source code and these summary metrics remain in the repository branch.
