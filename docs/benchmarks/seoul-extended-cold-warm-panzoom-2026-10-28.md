# Seoul MVT MapLibre vs OpenLayers — cold, warm and camera benchmark

**Final verified workflow:** https://github.com/nssang00/chatgpt-write-test/actions/runs/40638887857

**Raw measurements, screenshots, hardware info and SHA256 input hashes:** https://github.com/nssang00/chatgpt-write-test/actions/runs/40638887857/artifacts/12795076897

**Source:** `bench/seoul-extended/extended.js`, `bench/seoul-extended/run-extended.mjs`; workflow `.github/workflows/seoul-extended-rtx.yml`.

## Validity checks

- **192/192 complete**, `valid: true`, 0 errors, 0 geospatial viewport mismatches, no software WebGL fallback.
- Eight urban areas: Gangnam, Jongno, Yeouido, Hongdae, Jamsil, Seongsu, Guro and Nowon.
- 18 source layers from the same Planetiler v0.10.2 custom Seoul OSM MBTiles served by the same localhost HTTP server. Zoom 16 on MapLibre and zoom 17 on OL to account for 512px vs 256px convention. 1280x720 pixels, DPR1.
- NVIDIA GeForce RTX 5060 Ti / ANGLE D3D11 / installed Chrome, Windows self-hosted GitHub Actions.
- Engine versions pinned: MapLibre GL JS 5.9.0, OpenLayers 10.10.0, Playwright 1.55.0.
- Six style counts: 1, 4, 8, 16, 18 distinct source layers; 32 style entries = **18 distinct + 14 duplicate styles**, not 32 distinct source layers.
- Two rounds per area and count, alternating renderer order, fresh browser context per case, 16 samples per engine per style-count.
- Camera move: 850ms pan by +0.006 lon/+0.002 lat and +0.3 zoom, followed by a return to the original view in the **same map instance**.
- Both renderers use opaque polygon fill, matched colors, 2D line and circle styles, no text/icon/3D symbols. The screenshot pixel parity for eight areas was 87.86–94.05% exactly equal pixels (minor antialias/color-compositing differences remain). This is not full semantic equivalence.
- Inputs SHA256: Seoul OSM extract `B7C887FEFF4B12B8E16D0481AE247B1246B45DF06A05FB98D431270A299EDD27`, Planetiler JAR `F310BD0413E2E4512B27F4046D418664E8E1D3BF31603C2A70E23DE06C167E4D`, MBTiles `2D0F5747720B771B859C738FC32E0FB0A03B6F5B8AFDCCEBDF6B3AEF570D833F`.

## Verified timing results

**Metric definitions:** Cold = creation to MapLibre `idle` or OL `rendercomplete` plus two RAF. Warm = return animation to same center/zoom on an already created map, including the *850ms scripted animation*, completion event and two RAF. Frame metric = per-sample 95th percentile of intervals between MapLibre `render` or OL `postrender` callbacks, summarized by the P50 across 16 samples. No column below is GPU command time.

| Styles | ML cold P50 ms | OL cold P50 ms | ML warm return P50 ms | OL warm return P50 ms | ML render-frame P95 median ms | OL render-frame P95 median ms |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 369.6 | 93.3 | 898.8 | 909.5 | 19.5 | 19.3 |
| 4 | 370.4 | 94.6 | 896.2 | 912.5 | 19.5 | 19.3 |
| 8 | 370.0 | 103.1 | 894.5 | 913.8 | 19.3 | 19.3 |
| 16 | 368.0 | 127.0 | 894.1 | 916.6 | 19.5 | 19.1 |
| 18 | 369.8 | 112.8 | 892.4 | 912.2 | 19.5 | 19.2 |
| 32* | 368.4 | 148.4 | 890.3 | 912.0 | 19.5 | 18.7 |

`32*` denotes duplicate-style stress; no 32 distinct MVT layers were produced.

For the full 18-layer case, MapLibre/OL cold ratio is **3.28x** (369.8/112.8). Warm return difference is **19.8ms** (892.4 vs 912.2) and its direction cannot be attributed to GPU speed; differences in completion-event semantics are likely material. The full 18-layer render event interval P95 medians differ by **0.3ms** (19.5 vs 19.2).

Across 96 matched paired cases, MapLibre had longer cold initialization in 95, shorter warm return settle in 96, and longer render-frame P95 in 70 (median paired P95 gap ~0.3ms). This is best described as **similar interactive frame cadence**, not a proven GPU throughput win for either engine.

## Per region — 18 source layers only

| Region | ML cold ms | OL cold ms | ML warm return ms | OL warm return ms | ML render-frame P95 ms | OL render-frame P95 ms |
|---|---:|---:|---:|---:|---:|---:|
| Gangnam | 364.6 | 129.1 | 892.6 | 914.8 | 19.4 | 19.4 |
| Jongno | 369.5 | 147.5 | 890.9 | 905.6 | 19.3 | 18.3 |
| Yeouido | 370.4 | 111.4 | 888.0 | 903.5 | 19.0 | 19.1 |
| Hongdae | 367.9 | 178.2 | 892.4 | 912.2 | 19.2 | 18.5 |
| Jamsil | 369.2 | 111.3 | 888.3 | 913.5 | 19.1 | 19.1 |
| Seongsu | 371.6 | 130.9 | 889.3 | 918.0 | 19.6 | 19.3 |
| Guro | 370.4 | 111.1 | 891.5 | 904.2 | 19.3 | 18.9 |
| Nowon | 363.8 | 110.7 | 891.9 | 904.8 | 19.2 | 19.2 |

## Conclusions (bounded by measurement design)

1. **Confirmed:** OpenLayers reaches its initial completion event materially faster than MapLibre on this specific hardware and configuration.
2. **Confirmed:** With the same map reused for animated Pan/Zoom, both engines have close render callback cadence (~19ms P95 per sample) and ~48 render callbacks over each 850ms movement. In practice this does **not** reproduce the 3.28x startup gap during continuous interaction.
3. **Inference, not proven cause:** MapLibre's near-constant ~370ms cold startup across 1–32 styled entries suggests a large fixed pipeline/idle-event component. Median `load` event occurs ~115ms after creation; remaining time is not isolated into CPU/GPU stages.
4. **Cannot conclude:** OL GPU shader throughput is 3.28x MapLibre, or that MapLibre wins on a dedicated GPU draw-time benchmark. Neither GPU timestamp queries nor Chrome tracing are included.
5. **Limitations:** Completion-event semantics differ; the timed warm motion includes fixed animation duration; on-screen anti-aliasing is not pixel-identical; text labels, symbols, 3D and interactions are excluded. Each specific region has only two samples per engine per layer count. Distinct 32-layer source profiles were not constructed.

## Version history / mistakes caught by validation

- Early cold-run `40632933445` used unequal zoom extents; excluded from final conclusions.
- `40633682239` fixed zoom extents but only measured cold startup.
- Initial extended trial failed because MapLibre uses `off()` rather than OL `un()` to unsubscribe render events; fixed.
- Second extended trial discovered `reducedMotion: 'reduce'` caused MapLibre's 850ms movement to finish immediately; switched to `no-preference`.
- Valid pre-style-parity run `40637683809` was replaced as the canonical result after fixing MapLibre polygon opacity 0.88 to 1. This illustrates environmental frame-cadence variability; all conclusions above are based on **final run 40638887857 only**.

### Reproduction

Run the workflow from branch `bench/seoul-planetiler-ol-maplibre-20261028` on a Windows RTX self-hosted runner with installed Chrome. The workflow downloads hashed inputs, generates local MBTiles, copies `bench/seoul-extended/*.js` and `run-extended.mjs` into the Vite app `bench/seoul-render/`, and uploads the `summary.json`, `raw.json`, screenshot PNGs and SHA256 evidence. Inspect GitHub Actions for exact job logs and versions. No benchmark's result can be called complete unless the summary says `valid: true` and `observed: 192`.
