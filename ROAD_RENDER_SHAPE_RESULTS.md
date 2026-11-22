# Seoul road rendering: rounded joins, visible curb difference, low-LOD cost

Date: 2026-11-23 KST.
Branch: `fix/seoul-road-render-shape-20261123`.
Base: `fix/seoul-osm-3d-tags-20261123`.
Do **not merge this branch into main** solely based on numerical tests; visual QA and real RTX FPS are separate acceptance gates.

## Problem

The Seoul OSM data gives 2D road centerlines and approximate widths; the
old 3D generator used bounded miter joins and built its grey road-edge
surface as a second full-width polygon *under* the asphalt, separated by
a 7cm visual offset. This created potential protruding grey wedges and
needless planar overlap at intersections.

The previous roadbed fix shares terrain heights with asphalt and avoids
buried road faces, but contains large DEM-estimated earthworks (31.15m
cut / 25.07m fill), not measured road grades. **This branch does not
claim to fix road vertical accuracy.**

## Implementation, opt-in

- `geobench/road_offset_corridor.mjs`: rounded exterior corners and
  capped interior miter joins for each OSM polyline.
- `geobench/road_polygon_union.mjs`: per-grade planar asphalt and
  roadside unions, then polygon-clipping `difference(outer,asphalt)`.
  The curb/edge material is a real *border*, rather than a second
  overlapping road-shaped surface.
- `geobench/road_geometry.mjs`: `roadRenderSmooth` selects the new
  corridor geometry and records per-grade ring areas. Preserve
  bridge/tunnel separation and previous terrain-conforming heights.
- `geobench/enhance.mjs`: enable with
  `GEO_ROAD_RENDER_SMOOTH=1`.
- `geobench/pack_stream_tiles.mjs`: with
  `GEO_LOW_LOD_NO_ROAD_EDGE=1`, omit thin 1.65m curb strips from
  distant low-LOD tiles. Keep full borders in high LOD.
- `geobench/test_road_render_shape.mjs`: rectilinear, T, acute,
  hairpin, grade-separated cases; assert zero planar asphalt-edge
  overlap. The old geometry and integrated roadbed regression tests
  also pass.
- `geobench/validate_road_render_shape.mjs` and
  `geobench/validate_low_road_edge_lod.mjs`: check actual Seoul mesh
  contact, 144 distant tiles, border ring area and valid coordinates.
- `geobench/native-3dtiles-main.js`, `run-native-smoke.mjs`: add
  explicit `junctionview` / `junctiontop` diagnostic camera modes.
  Choose an actual central OSM at-grade junction (debug target
  x=2.00472m, source roadbed y=88.48149m, z=0.16698m).
- `.github/workflows/geo-road-junction-ab.yml`: same browser/camera
  before/after render against the old OSM-tag native tiles,
  independent of GPU-runner availability.

## Evidence / hard numbers

Current primary numerical CI:
https://github.com/nssang00/chatgpt-write-test/actions/runs/45081313847

Previous OSM-tag baseline CI:
https://github.com/nssang00/chatgpt-write-test/actions/runs/45068245995

Actual Seoul (502 source OSM road ways):
- 299 outside bends rounded (1,333 arc vertices).
- Plan asphalt area 377,638.62 m².
- Outer-edge plan area 531,784.10 m².
- Visible border area 154,145.55 m².
- Overlapping grey road-edge area removed: **377,638.54 m²**.
- At-grade asphalt/edge max absolute roadbed contact error about
  **5.0×10⁻⁹m** in tests.
- The separate, thinner border requires more near triangles:
  `road-edge` **638,892**, vs old **448,178**; full high LOD
  baseline **2,507,757**, after **2,706,380** (+7.9%).
- Far curb omission reduces low LOD from **984,531** to **544,262**
  (-44.7%), validated across all **144 tiles**.
- Total native triangles from 3,492,288 to 3,250,642 (-6.9%).
- Native 3D Tiles bytes from 128,511,052 to 119,740,132 (-6.8%).
- Actual native GLB tiles 144/144 produced without geometry CI failures.

## Visual verification caveat

Previous representative roadview and first new roadview rendered on the
same SwiftShader browser are **visually nearly identical** (mean absolute
RGB pixel difference ~0.017 on a 0..255 scale). That particular building-
centric camera scarcely shows the geometries being changed. Do not
advertise visible improvement based only on the planar geometry math.

Controlled same-OSM-junction A/B screenshot CI:
https://github.com/nssang00/chatgpt-write-test/actions/runs/45081507006
(software Chromium/SwiftShader; compare true top-down and oblique).

A separate real-RTX smoke job on self-hosted
`[self-hosted, Windows, X64, m5-gpu]` is queued by the primary CI.
Software renders show appearance but are **not real RTX benchmarks**.
Current visual judgment should be based on the dedicated junction
comparison; if inconclusive, retain the prior rendering as the preferred
baseline until targeted visual tests pass.

## Remaining limitations / next

1. OSM centerline + default width cannot reconstruct legal pavement,
   sidewalks, curb cuts, lane geometries or surveyed intersection shapes.
2. Large terrain deformation remains from the previous Terrarium-based
   integrated roadbed and is untouched here; measured higher-resolution
   DEM/street elevations are required for credible grade.
3. `pack_stream_tiles.mjs` still uses triangle centroids for 12x12 tile
   assignment; exact boundary clipping/LOD seam tests remain.
4. Fewer far triangles do not imply faster RTX FPS, and nearer triangles
   increased. Re-run fixed RTX camera sweep before any production merge.
5. Inputs are fetched live from OSM/Terrarium in CI. Freeze both for a
   rigorous source-identical A/B; current debug A/B holds browser and
   camera identical but uses nearby live-source snapshots.

Possible authoritative data: NGII public DEM catalogs/standards and
Seoul S-Map. They have not been ingested in this branch; verify licensing,
availability and vertical datum before using them.

No PR or merge to main was performed.
