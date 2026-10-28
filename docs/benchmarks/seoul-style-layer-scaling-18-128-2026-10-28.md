# Seoul RTX 5060 Ti: scaling 18-128 vector style entries

## Evidence and validity

- GitHub Actions: https://github.com/nssang00/chatgpt-write-test/actions/runs/40644828280
- Raw ZIP: https://github.com/nssang00/chatgpt-write-test/actions/runs/40644828280/artifacts/12798035533
- Workflow: `.github/workflows/seoul-layer-scale-18-128-rtx.yml`
- Scripts: `bench/seoul-layer-scale/stress.js`, `bench/seoul-layer-scale/run-scale.mjs`
- **PASS: 224/224 scenes**, no browser/benchmark failures, no geographic viewport mismatch, nonblank screenshots at both 18 and 128 for each of 8 areas.
- GPU: **NVIDIA GeForce RTX 5060 Ti (D3D11 ANGLE)**, Chrome headless, 1280×720, DPR 1. Fail-closed hardware GL check.
- Real Planetiler 0.10.2 output with 5,212 Seoul MBTiles vector tiles, **18 distinct MVT source layers**. Both engines fetched the same local MVT endpoint.
- Regions: Gangnam, Jongno, Yeouido, Hongdae, Jamsil, Seongsu, Guro and Nowon.
- Zoom: MapLibre 16 / geographically equivalent OpenLayers 17; two runs per engine per area and count, reversed engine order per round and count order per area.
- Style counts: 18, 24, 32, 48, 64, 96, 128. Above 18, entries repeat the same original 18 MVT layers, so this is **synthetic style-layer and overdraw pressure, not 128 distinct feature datasets**.

## Full result

All measurements are **milliseconds**; each cell represents 16 engine samples (8 areas × 2 repetitions). Cold is from map construction to library completion event + two browser frames. Warm animation is an 850ms move-and-zoom plus settle. For frame columns, take the P95 render-callback interval of each sample, then the median of those 16 P95s.

| Style entries | MapLibre Cold P50 | OpenLayers Cold P50 | MapLibre Cold P95 | OpenLayers Cold P95 | MapLibre Warm render-gap P95 median | OpenLayers Warm render-gap P95 median |
|---:|---:|---:|---:|---:|---:|---:|
| 18 | 150.1 | 128.0 | 203.2 | 373.0 | 19.5 | 18.8 |
| 24 | 149.6 | 129.7 | 205.7 | 190.1 | 19.5 | 18.7 |
| 32 | 149.6 | 146.8 | 220.5 | 204.2 | 19.5 | 18.7 |
| 48 | 150.7 | 181.7 | 220.9 | 236.9 | 19.5 | 18.8 |
| 64 | 163.8 | 201.7 | 220.4 | 258.7 | 19.3 | 18.6 |
| 96 | 168.7 | 258.9 | 238.4 | 312.6 | 19.1 | 19.2 |
| 128 | 184.4 | 322.1 | 237.9 | 380.0 | 19.0 | 20.1 |

**Change 18→128**: MapLibre Cold +34.3ms (+22.9%), OpenLayers Cold +194.1ms (+151.6%). At 128 MapLibre reaches its own completion event 1.75x earlier than OL. At 32 the medians are approximately equal; the crossover is between 32 and 48 entries in this scenario.

Across all 8 areas, at **64**, **96**, and **128** style entries, the region-specific two-run Cold medians favored MapLibre. This strengthens the relative trend, despite each region having just two runs per engine.

## Correct interpretation

MapLibre has **N separate MapLibre style layers** pointing to a single vector source. OpenLayers has **one WebGLVectorTileLayer with N style/filter rules**. This compares practical architectures for applying many visual styles, **not N identical API layer objects** across both libraries. OL's internal style rule compilation/filtering is a plausible reason its Cold time rises faster, but the experiment does not directly profile that stage.

- The same 18 source layers and same tile file load even at 128 entries; tile HTTP count is generally unchanged with count (at 18 and 128 both engines have P50 12 tile HTTP 200s). The increase mainly measures synthetic repeat style/overdraw handling rather than data download scaling.
- `transition:{duration:0,delay:0}` is set for MapLibre, correcting the earlier 300ms artificial `idle` wait.
- The Cold timing still includes tile transfer, decoding, workers, GPU setup and library-specific completion events; **not pure GPU drawing duration**.
- Warm render event P95 gaps remain near 19-20ms; they are callbacks, not WebGL timer queries and do **not** prove equal GPU throughput or FPS in real workloads.
- The 18 count is 18 distinct MVT source layers; above 18, styles repeat, possibly drawing identical features on top of each other. For 24-128 genuinely distinct data layers, a separately generated Planetiler schema with additional nonempty layers must be tested.
- No labels, icons, 3D/terrain, hit testing, editing or live remote network are included.

## Recommended next step

For real-world service decisions, test a production style with matching labels/text and interactive map movement. For *true* unique-layer scaling, generate a separate 24/32/48/64-source-layer Planetiler profile and verify nonempty feature counts, tile bytes and per-layer display.
