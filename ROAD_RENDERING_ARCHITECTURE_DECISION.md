# Seoul road-rendering architecture decision — 2026-11-23

Branches are experimental. **Do not merge any of these tests into main by CI pass alone.**

## Problem and new decision

The four-renderer project benchmarks Cesium, Three.js, PlayCanvas and
Babylon.js with a shared OSM building and road geometry set. The OSM
roads are 2D centerlines with approximate widths. The current DEM is
AWS Mapzen Terrarium, not a surveyed roadbed. It should not be used as
if it contained carriageway heights and vertical alignments.

Repeated corner/miter/union edits fixed topological overlap but did
not visibly improve the road shape. More iterations on a 50m global
roadbed only changed the nature of the defect: flat roads caused
~31m cuts; preventing major cuts made roads unnaturally steep.
**The requirements are not jointly satisfiable from this input alone.**

We therefore maintain explicitly separate objectives:

1. **Source-faithful evaluation** uses existing OSM/Terrarium as
   approximate data and reports uncertainty, steep regions and height
   errors. Do not fabricate survey accuracy or mislabel an OSM tag.
2. **Controlled benchmark visualization** may deliberately use a
   synthetic, continuously smooth terrain to compare engines fairly.
   All engines consume the exact same shared 3D meshes. The display
   MUST say **SYNTHETIC BENCHMARK TERRAIN**, not Seoul 3D accuracy.
3. **Actual 3D road reconstruction** waits for licensed, documented
   3D surveyed lane edges/curbs and terrain elevations, datum and
   coverage. No guess about the physical height of bridges from
   OSM `layer` values.

## Experiment A: exact polygon boundary with 3m elevation budget

Branch: `experiment/seoul-local-road-corridor-20261123`.
CI: https://github.com/nssang00/chatgpt-write-test/actions/runs/45111537470

- `road_geometry.mjs` exports `buildAtGradeRoadFootprint()`:
  all at-grade OSM asphalt polygons are unioned, preserving holes;
  17 protected grade-separated ways cannot deform source terrain.
- `road_corridor_terrain.mjs`: exact even-odd polygon scanline
  for road interior, spatial hash for distance to actual asphalt
  edge; narrow 12m smoothstep ground transition; maximum 3m
  change at every terrain mesh vertex. Road, buildings and terrain
  still use one consistent surface to avoid buried roads.
- Frozen Seoul OSM and DEM comparison passed source integrity and
  exact road/ground contact (4.98e-9m).
- Baseline: 50m transition, 37,229 terrain vertices changed;
  cut max **31.15m** / fill max **25.07m**;
  asphalt slope >20% = **2.3906%**, >40% = **0.4160%**.
- Exact-boundary variant: **28.19%** of grid vertices untouched,
  **26,749** changed, cut/fill <=**3.00m**;
  asphalt slope >20% **9.9096%**, >40% **3.0719%**.
- At **2,506 pavement vertices**, the smoothed road elevation exceeds
  the allowed 3m discrepancy; full 3D reconstruction is impossible
  without either severe local road waviness or significant earthworks.
- **Result: PASS on terrain preservation, FAIL on road flatness.**
  This is the expected tradeoff, not an implementation regression.
- Same-OSM/DEM fixed-camera screenshot CI:
  https://github.com/nssang00/chatgpt-write-test/actions/runs/45111733611

## Experiment B: explicitly synthetic visual benchmark

Branch: `experiment/seoul-benchmark-presentation-20261123`.
CI: https://github.com/nssang00/chatgpt-write-test/actions/runs/45112099821

- `benchmark_presentation_terrain.mjs` derives the broad DEM plane,
  caps base horizontal slope at 3.5%, and overlays a gentle 1.2m
  long-wavelength mathematical surface. It does **not** use the raw
  DEM elevations as the final rendering ground.
- Output remains the same 193x193 grid, OSM ways, 2,085 buildings,
  502 road ways, 144 tiled Cesium assets and equal materials.
- Generated Seoul asphalt area with slope >20% was
  **8.64e-7%**; >40% was **6.35e-7%**; worst surface contact was
  ~**8.1e-10m**; real-scene geometry CI passed.
- At the same time, the synthetic surface differs from original
  source DEM by as much as **81.27m**. This is **not suitable** for
  showing real Seoul ground elevation or claiming surveyed roads.
- `enhance.mjs` marks `demSource` and `groundTruthAccuracy`
  explicitly; `pack_native_3dtiles.mjs` propagates provenance to
  asset metadata and the build report in subsequent builds.
- Fixed-camera software rendering:
  https://github.com/nssang00/chatgpt-write-test/actions/runs/45112250923
- This mode is a potential benchmark visualization dataset **only**.

## Recommendation

Use separate application modes, not a single fraudulent “best of both”:

- `GEO_BENCHMARK_SYNTHETIC_TERRAIN=1`: benchmark/demo only;
  *must display prominent synthetic provenance* and preserve source.
- `GEO_ROAD_LOCAL_CORRIDOR=1`: exploratory constrained
  approximate map, not a smooth-road solution.
- The previous Roadbed and DEM-conforming branches stay available
  for debugging and real-data ingestion.

Before merging or making a product claim, independently verify visual
screenshots, shader/GPU FPS/bytes per tile, triangulation topology,
height datum and source licenses. No RTX signoff is implied by
SwiftShader previews.

For actual street geometries, first acquire and inspect NGII 3D
precision road map and local DEM from the official portal. The public
catalog advertises SHP/3D road infrastructure, with portal login
and large-file transfer software; no raw NGII survey SHP has been
provided or ingested into this repo. Check horizontal/vertical CRS,
benchmark road boundaries and license terms before using it.

Official catalog:
- https://www.data.go.kr/data/15059912/fileData.do
- https://www.data.go.kr/data/15059920/fileData.do
- https://openlab.eseoul.go.kr/ (Seoul S-Map OpenLab)
