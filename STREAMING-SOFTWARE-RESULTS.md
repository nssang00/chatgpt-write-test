# Seoul OSM streaming: four-engine first comparison (2026-11-20)

## Interpretation first

There is a **meaningful performance difference in this specific, shared-tile software-rendering implementation**, but NOT yet a fair GPU ranking or proof about 3D Tiles engines.

- Source region: Seoul Gangnam / Yeoksam, OSM buildings 2,085, AWS/Mapzen Terrarium DEM (NOT NGII).
- Generated 144 local grid tiles from the same 1,656,525 original high-detail and 49,355 low-detail triangles.
- Identical tile URLs, same JS nearest-first tile scheduler, data request count 87, bytes 45.009MB, tile errors 0.
- Linux hosted Chrome WebGL2 ANGLE **SwiftShader** software renderer; only one 120-frame sweep pass per engine. Initial scene uses the same camera.
- Each engine uses native geometry upload/destruction API. Cesium uses a Primitive per material per tile, not its native 3D Tiles streaming. Performance strongly depends on this implementation choice.
- 33ms stall counts reflect rAF frame intervals, not isolated GPU execution times.

| Engine | Sweep FPS | P95 frame ms | P99 frame ms | Frames >33ms / 120 | Boot to 2 tiles ms |
|:--|--:|--:|--:|--:|--:|
| CesiumJS | 14.14 | 179.0 | 215.1 | 85 | 10,181 |
| PlayCanvas | 40.88 | 54.1 | 80.4 | 25 | 1,225 |
| Three.js | 51.42 | 36.6 | 49.2 | 10 | 962 |
| Babylon.js | 49.58 | 37.8 | 51.8 | 11 | 1,048 |

Actual run: https://github.com/nssang00/chatgpt-write-test/actions/runs/44652718023

## GPU follow-up

RTX self-hosted GPU streaming run was submitted:
https://github.com/nssang00/chatgpt-write-test/actions/runs/44652269785

The geometry packaging stage completed, but at the time of writing the GPU job was still **queued**. Do not publish a hardware-GPU streaming performance claim until that job actually runs.

## Engineering implications

1. For *this implementation on a software renderer*, Three.js and Babylon.js stream per-tile geometry with less frame disruption than Cesium's manually generated Primitive-per-material path; PlayCanvas is in between.
2. This **does not justify** selecting Three.js over Cesium for nationwide GIS because native 3D Tiles, imagery/terrain handling, geographic precision, metadata and tile scheduling were not compared.
3. Next necessary tests: (a) real GPU with the same code, (b) native Cesium3DTileset versus 3DTilesRendererJS or equivalent tools on other engines with identical 3D Tiles, and (c) real midrange Android hardware and memory ceilings.
4. 144 tile bounding cells are not a general-purpose production 3D Tiles pipeline; roads at joins and fabricated facades remain approximations.
