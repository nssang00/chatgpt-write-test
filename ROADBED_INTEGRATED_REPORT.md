# Seoul integrated roadbed — implementation, validation and handoff

Date: 2026-11-20.
Branch: `fix/seoul-road-roadbed-integrated-20261120`.
Based on the protected experimental profile branch `fix/seoul-road-elevation-profile-20261120`.

**Status:** Experimental. Geometry contact CI PASS; actual RTX visual QA and performance judgment are separate. Do NOT merge into `main` without review.

## Why

The previous terrain-draped polygon-union asphalt avoided buried triangles, but inherited sharp/noisy DEM slopes. Smoothing the OSM centerline grade independently then buried asphalt below the original DEM; removing ground under the road with approximate masks created serrated holes. We need a **single continuous road + ground heightfield**, built *before* buildings and vegetation.

OSM provides 2D highway centerlines and tags, not measured carriageway surface elevations. The DEM source here is AWS/Mapzen Terrarium with optional visual Gaussian smoothing, **not NGII**. This result must not be interpreted as a surveyed road-grade reconstruction.

## Implemented

- `geobench/road_elevation_profile.mjs`: shared OSM-node graph with grade cap and per-segment road width and nearest-road sample queries; bridge/tunnel/layer profiles remain distinct.
- `geobench/roadbed_terrain.mjs`: supersample terrain grid 97x97 -> 193x193; at-grade centerline profile is blended into terrain via a smoothstep shoulder (50m nominal). Bound large road miter edges inside the shared roadbed plateau. The source DEM is preserved in `fixture.json`.
- `geobench/enhance.mjs`: precollect roads; build integrated terrain before placing procedural building bases, trees, and the asphalt. `GEO_ROADBED_INTEGRATED=1` enables this experimental path; legacy modes remain available.
- `geobench/road_geometry.mjs`, `geobench/road_polygon_union.mjs`: asphalt, road edge and lane marking mesh triangles are split at the same terrain-grid diagonal, with the identical sampled heightfield. Preserve separate bridge/tunnel height profiles.
- `geobench/test_roadbed_integrated.mjs`: synthetic noisy DEM, polygon union, same-height road contact at triangle vertices/midpoints/centers, no terrain mask holes, known cut/fill.
- `geobench/validate_roadbed_integrated.mjs`: actual Seoul generated-data roadbed contact, mesh integrity, grade-aware handling of elevated roads, cuts/fills and slope statistics.
- `.github/workflows/geo-roadbed-integrated.yml`: unit CI -> actual Seoul geometry -> 3D Tiles package -> RTX close, overview and low-angle captures.

The approximate `terrain_road_cut.mjs` mask is **not used** in integrated mode.

## Grounded tests

Synthetic unit tests succeeded:
- Integrated test samples: **10,070**
- Max contact error: **1.76e-14m**; 2,048 source-sized test terrain triangles.
- Original DEM drape regression and smooth-profile synthetic tests continue passing.

Real Seoul geometry run:
https://github.com/nssang00/chatgpt-write-test/actions/runs/44746059903

- 502 OSM roads; original terrain grid 97x97; integrated 193x193.
- At-grade road, road-edge, lane markings: all contact tested at vertices, centers, and edge midpoints; tolerance **0.01m**.
- Closed continuous grid: **73,728 terrain triangles**, 0 mesh holes, 0 invalid positions.
- Head change: protected grades (bridge/tunnel/layer) retain their own profiles and are **correctly excluded from at-grade ground-contact assertions**, not declared defective for being elevated.
- Roadbed source height displacement: up to **31.15m cut / 25.07m fill**; 37,229 of 37,249 terrain vertices changed. This is substantial non-surveyed terrain distortion and a critical quality caveat.
- Last full tile build: high LOD about **2.60 million** triangles, low LOD about **0.98 million**, versus previous DEM-conforming baseline 2.11M high / 0.50M low. LOD is too costly without simplification.
- GPU screenshot and hardware timing are a separate final visual/performance gate. The GitHub workflow success flag only indicates smoke checks ran, not that a realistic road is proven.

## Visual QA acceptance criteria

Compare identical roadview / overview / low-angle cameras against
https://github.com/nssang00/chatgpt-write-test/actions/runs/44723900653 and
https://github.com/nssang00/chatgpt-write-test/actions/runs/44734169828 .

Checks: asphalt not buried; terrain not serrated / missing / sky-colored; adjoining ground is continuous; bridge/tunnel distinction; slopes/geometry visually plausible; no loading errors. Screenshot artifact `seoul-roadbed-integrated-rtx-visual` is transient (14-day retention).

## Unresolved / next

1. Real DEM vertical fidelity: cut/fill tens of metres is not production-acceptable; secure surveyed street grades and/or a more reliable high-resolution local elevation source before calling this accurate Seoul topography.
2. Reduce the 50m shoulder modification and preserve buildings / sites; nearly the entire 1.3km scene is deformed at current road density.
3. Implement a geometry-aware corridor-boundary earthwork with explicit design-constraints and building/parcel transitions; do not treat a broad kernel blend as an engineered roadbed.
4. Fix 2D OSM offset/miter spike geometry and actual carriageway junction outlines.
5. Optimize road and terrain meshes/LOD; investigate per-tile grid sharing and transitions.
6. Freeze OSM/DEM inputs for fair A/B camera comparisons.

No PR or merge to `main` was performed.
