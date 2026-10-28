# Seoul RTX 5060 Ti: actual GPU elapsed times (2026-10-28)

## Evidence and validation

- [Successful GPU timer Actions run #40658539240](https://github.com/nssang00/chatgpt-write-test/actions/runs/40658539240)
- [Raw JSON, input hashes, screenshots artifact #12803342375](https://github.com/nssang00/chatgpt-write-test/actions/runs/40658539240/artifacts/12803342375)
- Workflow: .github/workflows/seoul-gpu-timer-rtx.yml
- Source: bench/seoul-gpu-timer/timer.js; scene.js; run-gpu-timer.mjs
- **PASS: 128/128 maps and 640/640 asynchronous timer queries, zero disjoint events, zero failures, zero viewport mismatches.**
- Physical NVIDIA GeForce RTX 5060 Ti, Windows self-hosted GitHub Actions, Chrome 156.0.8078.35, ANGLE D3D11, 1280×720 DPR1.
- MapLibre GL JS 5.9.0: WebGL2 and EXT_disjoint_timer_query_webgl2.
- OpenLayers 10.10.0: WebGL1 and EXT_disjoint_timer_query.
- Both read the same Planetiler-generated real Seoul OSM MVT, containing 18 distinct vector source layers. Eight Seoul regions, MapLibre zoom 16 / geographically matched OpenLayers zoom 17.
- Each engine/count: 8 areas × 2 independently initialized map scenes × 5 GPU queries per scene = 80 actual GPU timing queries. Before measuring, three untimed redraws warm shaders and buffers.
- MapLibre style transition duration is explicitly 0ms.

## Results: stationary single-redraw GPU elapsed time

All times in **milliseconds**, nearest-rank pooled P50/P95 across 80 hardware timer queries per engine/count.

| Style count | MapLibre GPU P50 | MapLibre GPU P95 | OpenLayers GPU P50 | OpenLayers GPU P95 | OL/ML P50 |
|---:|---:|---:|---:|---:|---:|
| 18 | **0.16** | 0.47 | 3.24 | 8.55 | 20.3× |
| 32 | **0.31** | 0.93 | 5.06 | 12.71 | 16.3× |
| 64 | **0.85** | 5.56 | 7.97 | 23.51 | 9.4× |
| 128 | **1.58** | 7.37 | 13.72 | 44.69 | 8.7× |

Independent-scene robustness check: median of the 16 within-scene medians per engine/count:

| Style count | MapLibre GPU ms | OpenLayers GPU ms |
|---:|---:|---:|
| 18 | 0.145 | 3.150 |
| 32 | 0.265 | 5.090 |
| 64 | 0.870 | 7.365 |
| 128 | 1.580 | 13.715 |

## Measurement methodology

WebGL timer queries bracket a single forced stationary redraw: query begin immediately before initiating redraw, query end after MapLibre render callback or OpenLayers synchronous renderSync return. The GPU result is queried asynchronously only after QUERY_RESULT_AVAILABLE is true. GPU_DISJOINT_EXT is checked before and after each query. Query results are in GPU nanoseconds and converted to milliseconds.

The relevant specs are Khronos WebGL EXT_disjoint_timer_query and EXT_disjoint_timer_query_webgl2. These queries measure GPU execution of commands submitted within the scope, not JavaScript wall time, loading latency, FPS, display scanning/compositing, or whole scene creation.

## Checks

- Full valid 640 queries across 128 maps, with one actual NVIDIA hardware context for each map: 64 MapLibre WebGL2 + 64 OpenLayers WebGL1, timer extensions available.
- All 64 engine/region/count/round paired geographic extents passed.
- At 18 and 128 style entries both engines have identical HTTP 200 tile request-count distribution.
- Screenshot parity examples (exact pixel ratio): Gangnam 18 = 91.49%; Gangnam 128 = 92.56%; Nowon 128 = 92.13%. Similar coverage and styling, **not pixel-identical output**.
- Previous [WebGL call audit](https://github.com/nssang00/chatgpt-write-test/actions/runs/40653129393) counted stationary redraw draw calls: at 128 entries MapLibre 636 vs OpenLayers 1033; shader program creations during cold: ML 5 vs OL 130.

## Valid interpretation and remaining limits

For this exact synthetic style-stress workload, MapLibre submits WebGL GPU work that executes much faster on this machine, by about 9–20× on the stationary redraw P50 metric. The evidence does **not** establish a universally similar difference for every OpenLayers renderer or application.

Above 18 style entries the same 18 real source layers are deliberately repeated. It is **not** a comparison using 128 distinct MVT datasets. The libraries differ structurally: MapLibre N style layers vs OpenLayers one WebGLVectorTileLayer with N style/filter rules, WebGL2 vs WebGL1. Thus per-pass pixel/GPU work is not guaranteed identical even though the geographical view and tile source are matched.

This scope excludes actual loading, Worker parsing, shader preparation before warmed redraws, browser compositor/presentation, labels, icons, 3D, user interactions and continuous camera motion. Per-draw attribution would require PIX/RenderDoc or equivalent GPU captures; same-GL-version and pixel-identical tests would be required for closer apples-to-apples rendering pipeline comparison.
