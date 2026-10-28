# Seoul RTX WebGL command audit: MapLibre vs OpenLayers, 2026-10-28

## Verified evidence
- **GitHub Actions:** https://github.com/nssang00/chatgpt-write-test/actions/runs/40653129393
- **Raw JSON and screenshots:** https://github.com/nssang00/chatgpt-write-test/actions/runs/40653129393/artifacts/12801355228
- **Result:** `valid: true`, **128/128** matched scenarios, no benchmark failures, no viewport-mismatch failures.
- **Hardware:** Windows self-hosted runner, physical NVIDIA GeForce RTX 5060 Ti, ANGLE D3D11, Chrome headless, viewport 1280×720 / DPR1. One instrumented GL context per scenario.
- **Scene:** same local Planetiler Seoul MVT tile data, 18 distinct source layers, all 8 Seoul areas, zoom MapLibre16 / OpenLayers17 equivalent ground scale, 2 samples per engine/area/style count (16 measurements per cell).
- **Style entries:** 18, 32, 64, 128. Styles beyond 18 repeat original feature data; they do NOT represent 128 distinct geographic source layers.
- **Style transition:** disabled in MapLibre (`transition: {duration:0,delay:0}`).
- **Architecture:** MapLibre N style layers; OpenLayers one WebGLVectorTileLayer with N style/filter rules. This is practical style architecture comparison, not N identical library-layer objects.

## Actual WebGL command counts

All numbers below are **P50 nearest-rank** across 16 engine measurements per style count. Draw-call counts are taken from a **single forced redraw of the settled map** (MapLibre `triggerRepaint`, OL `renderSync`), avoiding comparisons of arbitrary Cold startup frame counts. Program creation, shader compilation and buffer uploads are from map creation through initial-completion event + 2 requestAnimationFrames.

| Style entries | ML redraw GL draws | OL redraw GL draws | ML cold `createProgram` | OL cold `createProgram` | ML cold shader compiles | OL cold shader compiles |
|---:|---:|---:|---:|---:|---:|---:|
| 18 | 104 | 153 | 5 | 20 | 10 | 40 |
| 32 | 180 | 265 | 5 | 34 | 10 | 68 |
| 64 | 341 | 521 | 5 | 66 | 10 | 132 |
| 128 | 636 | 1,033 | 5 | 130 | 10 | 260 |

**Critical observations:**
1. Draw calls grow markedly for *both* libraries. MapLibre does **not** render all style layers in one GPU draw. Its GL draw-call count rises 104→636 when style entries rise 18→128.
2. MapLibre's GL program creation is stable at **5**, while OpenLayers increases almost one-to-one with style count: **N+2** programs and **2×(N+2)** shader compile calls. This is direct evidence for substantially greater program/shader creation work for OL in this particular N-rule setup.
3. OL emits ~**1.62×** as many draw calls for the 128-entry settled redraw (1,033 vs 636). This is a command-count ratio, **not** proven GPU execution time.
4. The **number of raw vertex-buffer upload bytes does not scale with style count** in either engine. Median first-startup `bufferDataBytes`: ML **210,974 bytes** and OL **893,008 bytes** for all four counts. Buffer submission counts likewise are nearly flat by count within each engine. OpenLayers is *not* reuploading the full geometry once per style rule in this test.
5. Cold completion with instrumentation included: ML **183.9, 188.0, 192.6, 205.3ms** and OL **147.4, 177.8, 238.1, 338.6ms**, respectively. **Do not** compare these absolute values to uninstrumented benchmark times; JS method interception itself changes timing.

## Important limitations and what is still unproved

- These are CPU-side **WebGL API call counts**, not GPU execution-time measurements, exact render-pass counts, full browser resource residency, total tile-worker CPU time or independent shader compilation latency. `compileShader` and `linkProgram` count submissions; the driver may defer actual work.
- MapLibre uses **WebGL2**, whereas OpenLayers in these measured scenes uses **WebGL1**. Both expose timer query extensions, but this experiment did not actually run GPU timer queries. Differences in GL generation and program caching can contribute to the result.
- This A/B deliberately stresses repeated style entries on the same 18 original data layers. Different style expressions, symbol labels, text, icons, 3D, hit detection and distinct 24-128 source layers may produce different scaling.
- The source files `bench/seoul-gl-audit/gl-audit.js`, `bench/seoul-gl-audit/stress-audit.js`, and `bench/seoul-gl-audit/run-gl-audit.mjs` implement the measurement. The isolated single redraw is after the warm back-to-origin animation.
- Comparing client command counts is useful to reject a false explanation. To prove actual GPU execution time use asynchronous `EXT_disjoint_timer_query_webgl2` (ML) and `EXT_disjoint_timer_query` (OL), check `GPU_DISJOINT_EXT`, and read results **later**. Driver tracing such as PIX or RenderDoc can characterize program compilation and draw time further.

## Updated conclusion

**The old idea that MapLibre is insensitive to layer count because it renders all layers in one draw is false.** It sends more draw calls as layers are added. The measurements instead show:

- reusable shader program count for MapLibre in this simple style set,
- one-new-program-per-style-rule growth in OpenLayers,
- more OpenLayers draw commands at all tested style counts,
- and essentially fixed geometry upload bytes in both engines.

This supports **shader program reuse and comparatively fewer draw calls** as important architectural differences under this synthetic benchmark. It does **not isolate** the exact causal shares of CPU shader setup vs GPU draw duration. The latter requires GPU timer experiments.
