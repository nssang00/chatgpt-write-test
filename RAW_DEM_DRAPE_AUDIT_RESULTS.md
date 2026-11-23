# Seoul Road Rendering: Raw OSM line + unmodified DEM triangle draping

Date: 2026-11-23 KST. **Experimental branch only**:
`fix/seoul-road-dem-drape-audit-20261123`.
Based on `fix/seoul-road-dem-conformance-20261120`; `main` unchanged.

## Goal

Return to **OSM road centerline + estimated width → per-grade planar
road union → actual DEM-grid triangle clipping → 3D road mesh**.
No roadbed, no 50m cut/fill, no synthetic elevation, no road-grade
projection, and no Gaussian terrain smoothing in this audit.

The DEM is AWS/Mapzen Terrarium, **not** an engineering road-height
survey. It must remain byte-equal in `fixture.json` and
`fixture-detailed.json`. It can have extremely steep cell-to-cell
heights; an exact drape is not necessarily a smooth real road.

## Changes

- `geobench/generate.mjs` records a **single frozen OSM XML**
  (`GEO_CAPTURE_OSM_SNAPSHOT=1`). An explicit diagnostic override
  `GEO_ALLOW_STEEP_RAW_DEM_DIAGNOSTIC=1` reports raw source DEM grade
  above 120% as a warning, instead of secretly modifying it.
  The source slope safety limit remains active outside this diagnostic.
- `geobench/enhance.mjs` reads the snapshot with
  `GEO_OSM_SNAPSHOT_PATH`; directly uses the source DEM mesh for
  roads, buildings and vegetation.
- `geobench/road_geometry.mjs`: while asphalt and shoulders already
  snapped to terrain-triangle boundaries, painted dashed lane lines
  previously used only four 3D corner heights and could interpolate
  through DEM triangles. The paint is now split along **exact terrain
  cell edges and diagonals** as well. Display-only offsets are 0.040m
  (asphalt), 0.025m (edge) and 0.054m (paint), replacing 0.22m/0.15m/
  0.285m. None of these changes physically alters the DEM.
- Extract actual at-grade OSM junction (in scene meters about
  x=2.005, z=0.167) to exactly reproduce three 200m diagnostics:
  source terrain only, road-only with wireframe triangles, and
  terrain+road. `extract_road_debug.mjs`,
  `road-debug-main.js`, `run-road-debug.mjs`.
- `test_raw_dem_drape.mjs` verifies all road materials on a synthetic
  nonplanar DEM, including **triangle interiors**.
- `validate_raw_dem_drape.mjs` ensures raw DEM is unfiltered and
  byte-for-byte SHA256 equal across source and display fixtures;
  validates asphalt/edge/paint at hundreds of thousands of
  interior/mid-edge contact points, rejecting degenerate triangles.
- Native 3D Tiles GLBs still render through Cesium; shared geometry
  can still be delivered to the four-engine benchmark.

## Actual Seoul reproducible measurements

Primary CI:
https://github.com/nssang00/chatgpt-write-test/actions/runs/45141523301

- Bounds: 127.031–127.045°E, 37.496–37.508°N;
  2,085 OSM building outlines, 502 OSM road ways.
- DEM grid: 97×97, 9,409 vertices and 18,432 triangles; original
  terrain positions and indices were **exactly identical** after
  enhancing (`changedTerrainVertices=0`, source SHA256
  `14ff9185fde7c47930c604fbe719c511c8a3ef8b736b1f290e9a98d85e5641e9`).
- Raw DEM max cardinal-adjacent slope: **154.45%**;
  largest adjacent rise **21.36m**, with **54** terrain-grid edges
  steeper than 100%. The actual sourced heights span ~25–152m.
  The raw-DEM input is **not suitable for claiming accurate road
  vertical geometry**.
- Asphalt: 227,016 triangles, 908,064 contact samples, maximum
  ground-offset residual **3.11×10⁻⁷m**, 0 failures and 0 degenerate
  triangles; **23.45%** asphalt area has >20% face grade and
  **7.47%** has >40% face grade.
- Road-edge: 229,088 triangles, 916,352 contact samples; maximum
  residual **3.11×10⁻⁷m**, 0 failures.
- Dashed paint: 10,674 triangles, 42,696 contact samples; maximum
  residual **3.11×10⁻⁷m**, 0 failures.
- **Conclusion:** contact/topology **PASS**; realistic road slope
  **FAIL / input-data limitation**. A passed contact test cannot
  certify natural appearance or surveyed street elevations.
- 144 nonempty native tiles; high 2,110,695 / low 499,703
  triangles (combined LOD inventory, not simultaneous workload),
  96,757,220 bytes of native GLB files.
- Software Chromium SwiftShader test succeeded, captured three
  debug images and close roadview with no HTTP or console errors.
  Report recorded 89 GLB requests and 88 successful responses
  at measurement time; do not claim all requests had finished.

## Visual findings

The combined scene shows roads following the raw DEM without the
previous roadbed's terrain masking holes. The road-only wireframe
reveals numerous narrow/elongated triangles from the unioned OSM
polygons, especially around intersections. Some of these are
necessarily created when slicing large union polygons across many DEM
triangle boundaries. The single-color terrain-only preview does
**not** expose height gradients clearly; use the raw DEM slope heatmap
for elevation diagnosis as well.

The actual-source map includes sharply varying DEM patches near
the center shared OSM junction. The raw drape cannot eliminate that
without either visual-only filtering or better street elevations.
The old integrated roadbed corrects the appearance at the price of
large artificial terrain deformation.

## Controlled before/after and hardware gates

- Independent same-frozen-OSM/DEM compare against old integrated
  roadbed **PASSED**:
  https://github.com/nssang00/chatgpt-write-test/actions/runs/45142901576
  Artifact: `seoul-frozen-raw-dem-vs-roadbed-debug-screenshots`.
  Both sides use the same saved source fixture/OSM XML, same local
  junction target, identical viewer and camera; left = old Roadbed,
  right = raw DEM drape. The screenshots are actual software WebGL,
  not RTX hardware.
- A first full-city old-Roadbed software GLB screenshot attempt timed
  out in the browser screenshot stage (not a mesh/geometry failure).
  The 200m light-weight fixed-camera comparison succeeded.
- A real RTX 5060 Ti run uses the original raw-DEM native 3D Tiles
  and can be queued on the self-hosted Windows runner. **Do not**
  report RTX success until its actual job and screenshot complete.

## Recommendation / no merge

Keep this branch as the **ground-truth-to-input** meshing baseline
for renderer parity. Its roads are mathematically accurate overlays
of the supplied DEM but the raw DEM has severe road-slope anomalies;
they do **not** constitute realistic road engineering. Keep the
Integrated Roadbed as the separately labelled visually smoother
experiment; do not merge either into `main` as an accurate Seoul
digital twin. Future actual-road work requires verified 3D carriageway
edges/elevations and vertical datum/rights; do not iterate arbitrary
DEM smoothing indefinitely.

## Final controlled before/after metrics: 2026-11-23

The old integrated Roadbed was rebuilt in CI by checking out the
original `fix/seoul-road-roadbed-integrated-20261120` code. Its
OSM network fetch was explicitly replaced with this run's exact
saved OSM XML; its input `public/fixture.json` was the SAME
unfiltered DEM and building geometry. Both branches' output road
triangles were extracted in the same 200m OSM junction area and
rendered using the exact same Three.js viewer and camera pose.

| Metric | Old integrated Roadbed | Raw DEM drape |
| --- | ---: | ---: |
| Terrain vertex heights changed | 37,229 | **0** |
| Max artificial cut into source DEM | **43.6756m** | **0m** |
| Max artificial fill above source DEM | **36.4481m** | **0m** |
| Asphalt surface area >20% grade | **3.761%** | **23.447%** |
| Asphalt surface area >40% grade | **0.859%** | **7.474%** |
| At-grade road/terrain contact residual | ~8.84e-9m | ~3.11e-7m |

Old Roadbed differs in cut/fill here from previous visual-smoothed
baselines (31m cut / 25m fill) because this A/B deliberately uses
an UNSMOOTHED raw Terrarium DEM for both.

Actual pixel comparison on a 0..255 RGB scale:

| 1280×720 paired shot | Mean abs RGB | Pixels changed >15 |
| --- | ---: | ---: |
| Terrain only | 8.823 | 6.789% |
| Road wireframe only | 29.737 | 29.810% |
| Terrain + road | 15.296 | 27.258% |

**Visual result:** The old integrated Roadbed makes the road alignment
comparatively smoother but causes large-scale unnatural cut/fill and
jagged terrain silhouettes. The raw DEM drape gives correct geometric
contact and unmodified topography, but the road visibly undulates
where the source DEM heightfield has implausible slopes.

This confirms the input-adequacy issue rather than just a road
triangulation bug. The plain single-color terrain debug screenshot is
not a good slope visualization; an independent height-gradient raster
was generated from the unchanged source grid to locate the hotspots.

**Decision:** Retain raw DEM draping as the truthful-to-input mesh
baseline, not as an accurate Seoul road reconstruction. Retain old
Roadbed only as a separately marked illustrative comparison. Neither
is merged to main or declared production visual quality. Surveyed
carriageway elevation/boundary data remains a precondition for
satisfying both targets.
