# Seoul Planetiler vector tile renderer benchmark

This is a **real browser GPU benchmark**, not a Planetiler tile generation benchmark.

- Source: same pinned Seoul OSM PBF fetched once, custom Planetiler schema in schema.yml (18 layers)
- Renderer A: MapLibre GL JS, one vector source and one style layer per selected source layer
- Renderer B: OpenLayers WebGLVectorTileLayer, one vector tile source and a rule per selected source layer
- Regions: Gangnam, Jongno, Yeouido, Hongdae, Jamsil, Seongsu, Guro, Nowon
- Zooms: 14, 16; viewport 1280x720; DPR 1
- Suites: polygons (7), lines (7), points (4), all (18)
- Order per region, zoom, suite: MapLibre/OpenLayers/OpenLayers/MapLibre (ABBA); fresh browser context on every sample
- Metric: create-to-idle / rendercomplete + two animation frames, not raw GPU command time
- Two independent context samples per engine per scenario; no result is invented when the run is queued or fails
- Evidence: raw.json, summary.json, gpu.json, screenshots of each engine for each area, Planetiler/PBF hashes, runtime versions

**Important comparability caveats:** different engines use different style pipelines and MapLibre has separate style layers while OpenLayers uses rules in one WebGLVectorTileLayer. Text labels/icons and interaction FPS are deliberately excluded: they cannot be compared with the same flat styling in these APIs. Renderer times include tile transfer, parse, processing and draw. OS file cache may be warm even though browser contexts are cold. If GPU is unavailable or screenshots are blank, fail the job instead of publishing a valid performance ranking.

The CI workflow is in .github/workflows/seoul-planetiler-render-compare.yml and runs on an existing Windows GPU self-hosted runner. It never requires a service account or exposes secret data. Downloaded Planetiler and OSM files are untrusted upstream inputs; only use the configured pinned HTTPS sources.
