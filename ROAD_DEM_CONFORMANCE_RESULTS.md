# Seoul road union — terrain conformance investigation and handoff

Date: 2026-11-20. Working branch: `fix/seoul-road-dem-conformance-20261120`.
Base: `fix/seoul-road-polygon-union-20261120` at `1a5d58af972dd6d1c8115c9b37b0e225ca2eb806`.

## Problem

Roads are constructed from OSM **2D highway way centerlines**, inferred/measured widths, bounded miter joins, and `polygon-clipping` union followed by `earcut`. Neither OSM carriageway polygons nor real lane geometry are supplied.

The polygon union fixes overlapping strips, but `earcut` may output very long, thin triangles across a nonplanar DEM. Previously only the road triangle's three vertices were draped. Their interiors could deviate from the DEM and intersect/float above the ground.

## Reproduced before changing the implementation

CI: https://github.com/nssang00/chatgpt-write-test/actions/runs/44723373085

Synthetic piecewise-linear 12x12 DEM (not a single plane) on a wide road:
- 18 road triangles; 72 interior/midpoint samples.
- Maximum absolute deviation from the prescribed 0.22m offset: **11.2576389806m**.
- The intended 0.01m test threshold FAILED.

This is a reproducible defect in terrain conformance, **not proof that all jagged appearance comes from this single defect**.

## Implemented fix

- `geobench/terrain_triangle_clip.mjs`: split each polygon-union road triangle against each intersecting DEM grid cell **and its two terrain triangles**.
- `geobench/road_polygon_union.mjs`: emit exactly terrain-aligned triangles when a terrain grid is provided; preserve former flat synthetic API as fallback.
- `geobench/road_geometry.mjs`, `geobench/enhance.mjs`: thread the exact 97x97 terrain-grid geometry to both asphalt and edge surfaces.
- `geobench/test_road_geometry.mjs`: nonlinear DEM interior-sampling regression.
- `geobench/validate_road_dem.mjs`: validate actual generated Seoul meshes at center and all edge midpoints; check triangle max edge and finite coordinates.
- `.github/workflows/geo-road-dem-conformance.yml`: unit test, real Seoul OSM/DEM rebuild, numeric validation, native GLB output, and hardware GPU screenshots.

Road geometry outside the source DEM extent is clipped to its valid terrain bounds in this mode (previously halo geometry could extend beyond the DEM).

## Verified synthetic CI

Run: https://github.com/nssang00/chatgpt-write-test/actions/runs/44723575328
- 438 output road triangles; 1,752 tested samples.
- Maximum absolute DEM error: **1.5348833315e-14m** (floating-point roundoff).
- Eight prior synthetic regression cases still pass.

## Verified actual Seoul geometry CI

Run: https://github.com/nssang00/chatgpt-write-test/actions/runs/44723900653
Validated area: [127.0310,37.4960,127.0450,37.5080].
Source: OSM + AWS/Mapzen Terrarium 97x97 terrain (visual smoothing explicitly enabled, **not NGII**).

Numeric report artifact: `seoul-road-dem-conformance-report`.

| Material | Triangles | Interior samples | Max abs DEM error | Max triangle edge |
| --- | ---: | ---: | ---: | ---: |
| road | 227,016 | 908,064 | 1.05705e-7 m | 18.9604 m |
| road-edge | 229,088 | 916,352 | 1.05705e-7 m | 18.9604 m |

All checked: invalid coordinates 0, degenerate triangles 0, out-of-bounds samples 0; 0.01m threshold passed.
The real OSM/DEM generation, custom tile packaging, and native 3D Tiles packaging jobs succeeded.

**Important cost:** high LOD total triangles rose from 1,685,892 to 2,105,741 and low LOD from 79,854 to 499,703. This fix trades mesh density for strict terrain conformance. Profile CPU, GPU, RAM, network bytes and low-LOD quality before considering it production-ready.

## Current unresolved items

1. **Actual RTX visual judgment**: run `44723900653` GPU job uses `[self-hosted, Windows, X64, m5-gpu]`; check current status and inspect the original `seoul-road-dem-conformance-rtx-visual` screenshot artifact after it completes. A successful geometry job alone does **not** validate appearance.
2. **2D road shape remains approximate**: OSM centerlines plus inferred width and miter joins still cause sharp or unrealistic junctions. The new clipping preserves the planar road footprint, rather than reconstructing measured carriageways.
3. **DEM provenance and grade**: visual smoothing is cosmetic; actual urban road grade and flyover/tunnel approaches remain unmeasured. A road surface following the DEM exactly might still look bumpy where DEM is wrong.
4. **3D Tiles border and LOD**: triangles are still assigned by centroid rather than clipped to exact 12x12 tile boundaries. Equal LOD/cache and transition testing is still required.
5. **Reproducibility**: the CI downloads live OSM/Terrarium and therefore should freeze both inputs before attributing small pixel differences exclusively to code changes.
6. **Performance**: low LOD now carries many terrain-aligned road triangles; proper LOD simplification needed.

## Next steps, in order

1. Capture and manually compare the **same roadview and overview RTX cameras** from the baseline and fixed branch, with matching input versions if possible.
2. Render a top-down, terrain-disabled view for a handful of problem junctions; isolate errors in the 2D centerline width/offset/union from terrain effects.
3. Improve road boundaries/intersection geometry using source widths, dedicated junction geometry and curvature constraints; do not auto-connect unrelated grade-separated ways.
4. Add tile-boundary clipping/shared-vertex tests and LOD transition QA.
5. Record screenshot judgments and relevant performance data before submitting a production merge.

Do not label road visual quality as passed on the basis of the numeric conformance checks.
