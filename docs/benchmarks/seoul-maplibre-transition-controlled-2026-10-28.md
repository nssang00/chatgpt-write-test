# Seoul MapLibre vs OpenLayers — controlled transition retest (2026-10-28)

## Corrected conclusion

The large MapLibre initial-settle deficit was primarily caused by the **default MapLibre style transition delay**, rather than by intrinsic vector GPU rendering throughput. In an A/B test on the physical RTX 5060 Ti, a MapLibre style with **zero style layers** still took 331.3 ms (P50) to reach idle by default, while declaring `transition: { duration: 0, delay: 0 }` reduced it to 33.2 ms. In contrast, the MapLibre `load` event was 36.3 ms default versus 33.2 ms zero-transition.

Only MapLibre's global style transition settings were changed for the full 8-region retest. No OpenLayers code, tile schema, camera, viewport or animation setting was changed.

## Reproducible evidence

- Isolated 48-sample A/B: https://github.com/nssang00/chatgpt-write-test/actions/runs/40640449121 (all 48 valid)
- Full preceding 192-sample benchmark: https://github.com/nssang00/chatgpt-write-test/actions/runs/40640339672 (all 192 valid)
- Full transition-disabled 192-sample benchmark: https://github.com/nssang00/chatgpt-write-test/actions/runs/40641540522 (all 192 valid)
- A/B raw ZIP: https://github.com/nssang00/chatgpt-write-test/actions/runs/40640449121/artifacts/12795956552
- Before raw ZIP: https://github.com/nssang00/chatgpt-write-test/actions/runs/40640339672/artifacts/12795627279
- After raw ZIP: https://github.com/nssang00/chatgpt-write-test/actions/runs/40641540522/artifacts/12796048450

All three runs used the same real Planetiler-generated Seoul MVT dataset schema on the Windows self-hosted NVIDIA RTX 5060 Ti GPU, hardware D3D11 ANGLE, 1280×720, DPR1, camera zoom16 MapLibre / equivalent zoom17 OpenLayers.

**Important:** These are not isolated GPU draw times. Cold is map creation until MapLibre `idle` / OpenLayers `rendercomplete` + 2 RAF, with different API semantics. Warm settle includes the 850ms scripted animation. All counts are *style entries*: 32 duplicates 18 source layers and is not 32 unique geographic source layers. No text labels/icons/3D.

## Isolated MapLibre A/B (8 samples per cell)

| Style entries | Default load P50 | Default idle P50 | Zero-transition load P50 | Zero-transition idle P50 | Final after RAF |
|---|---:|---:|---:|---:|---|
| 0 | 36.3 | 331.3 | 33.2 | 33.2 | 367.5 vs 68.3 |
| 1 | 108.4 | 330.7 | 110.3 | 110.3 | 366.4 vs 144.1 |
| 18 | 155.3 | 330.5 | 140.0 | 140.0 | 365.4 vs 173.4 |

Note especially that even **zero style entries** display ~300ms artificial `idle` delay without zero-transition override; this strongly isolates the completion-wait bias from geometric drawing costs.

## Full eight-region results, 16 samples per engine/count (P50 ms)

| Style entries | MapLibre default Cold | OL previous Cold | ML zero-transition Cold | OL retest Cold | ML/OL before | ML/OL after |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 369.5 | 92.7 | 128.5 | 79.1 | 3.99x | 1.62x |
| 4 | 368.5 | 92.3 | 147.2 | 95.2 | 3.99x | 1.55x |
| 8 | 369.3 | 112.5 | 132.3 | 111.6 | 3.28x | 1.19x |
| 16 | 368.3 | 129.5 | 149.4 | 113.2 | 2.84x | 1.32x |
| 18 | 366.3 | 113.3 | 149.4 | 129.9 | 3.23x | 1.15x |
| 32* | 369.1 | 148.6 | 149.3 | 147.1 | 2.48x | 1.01x |

*32 style entries reuse source layers. Each Cold score is median of 16 sample results. Variations in medians across the two runs (including OL) exist and must not be interpreted as causal effects of the MapLibre style setting.

## Warm (18 styles, P50) and frame intervals

| Metric | Default-transition run | Zero-transition run |
|---|---:|---:|
| ML warm back-to-origin settle | 891.0 ms | 892.9 ms |
| OL warm back-to-origin settle | 915.9 ms | 910.3 ms |
| ML median of per-sample warm render frame P95 | 19.3 ms | 19.6 ms |
| OL median of per-sample warm render frame P95 | 19.0 ms | 19.0 ms |

Warm times include the identical 850 ms animation and cannot be interpreted as GPU frame time. The rendering event gaps are not GPU timer queries; similarities don't prove GPU work is identical.

## Next benchmark hygiene

- Keep `transition: {duration:0,delay:0}` in MapLibre style in cold comparisons.
- Report `style.load`, `load`, `idle` separately when diagnosing MapLibre startup.
- Report video/frame results independently from initial-settle latency; use GPU profiling if concluding raw draw throughput.
- A/B groups must be balanced and separated from shader/style equivalence tests.
- Do not claim 'OpenLayers 3x GPU faster' based on old uncorrected first-idle timing.
