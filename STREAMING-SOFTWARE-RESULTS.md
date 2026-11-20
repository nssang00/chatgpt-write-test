# Seoul city streaming benchmark — four-engine measured results

## Verified comparison (2026-11-20)

**Important**: Results below are CPU/software WebGL results from ANGLE SwiftShader, **not** NVIDIA GPU results and **not** a native Cesium 3D Tiles test. The effect of implementation details is significant.

- Genuine OSM Seoul Gangnam buildings: 2,085; synthetic window/wall details and road geometry.
- Terrain: AWS Mapzen Terrarium; NGII imagery/DEM not yet acquired.
- Shared source: 144 grid tiles, two visual-detail tiers, 1,656,525 high triangles and 49,355 low triangles.
- Each renderer requests 87 tiles, approximately 45.0MB transferred in the sweep.
- Identical JS scheduler, same 120 sampled frames per pass; software Chromium SwiftShader; symmetrical execution ordering: Cesium/PlayCanvas/Three/Babylon/Babylon/Three/PlayCanvas/Cesium.
- Each engine gets 2 repetitions. No streaming errors.

| Engine | Pass A FPS | Pass B FPS | Two-pass mean FPS | P95 frame time (ms; summary) | Frames over 33ms in both passes |
|---|---:|---:|---:|---:|---:|
| CesiumJS | 11.67 | 11.78 | **11.73** | 178.9 | 180 |
| PlayCanvas | 30.34 | 33.55 | **31.95** | 83.0 | 72 |
| Three.js | 44.60 | 45.99 | **45.30** | 47.0 | 40 |
| Babylon.js | 39.57 | 38.87 | **39.22** | 57.2 | 57 |

Results run: https://github.com/nssang00/chatgpt-write-test/actions/runs/44653417427

Earlier single-pass validation (different runner load): https://github.com/nssang00/chatgpt-write-test/actions/runs/44652718023

## What this establishes

The CPU/geometry-streaming implementation shows a reproducible large gap (about 3.9x Three.js vs CesiumJS on the software renderer). Frame-time stalls also differ. This is an engineering comparison of *these four implemented paths*.

## What it does NOT establish

- **Do not conclude** CesiumJS is intrinsically 3.9x slower, or Three.js will be faster on a hardware GPU.
- In this prototype, Cesium creates one synchronous primitive PER tile/material and does not use Cesium's actual 3D Tiles terrain/LOD/cache stack.
- Three.js uses a shared material cache and simple unindexed BufferGeometry; PlayCanvas and Babylon.js have different mesh upload paths. These are not equivalent engine-native optimizations.
- A cold-start figure for the very first Cesium pass is inflated by first-run browser/application bundling caches. Do not treat it as a stable library startup penalty.
- The local Vite server has no real mobile-network delay and the viewport may be vsync-capped.
- The software validation tests only a short sweep, not a truly nationwide dataset or a representative smartphone.

## Hardware comparison status

RTX self-hosted GPU workflow: https://github.com/nssang00/chatgpt-write-test/actions/runs/44652269785

Tile preparation and artifact staging succeeded, but the hardware job was **still queued** at report preparation time. A real GPU ranking is **not available**.

## Next conclusive test

1. Run the waiting RTX GPU job in the same code; verify GPU identity and compare sweep + scrub, P95/P99, tile load, memory, and geometry-upload metrics.
2. Compare Cesium's actual Cesium3DTileset against appropriately integrated 3D Tiles streaming on the other engines using the SAME set of ready-made tiles. This is necessary to judge geospatial infrastructure costs and performance.
3. Run on an actual mid-range phone with the same tiles to measure memory pressure, slow load, and thermal throttling.

No engine selection should be based solely on this preliminary SwiftShader result.
