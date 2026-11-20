# Seoul road elevation profile — experimental RTX result and handoff

Date: 2026-11-20. Branch: `fix/seoul-road-elevation-profile-20261120`.
Base (preserved): `fix/seoul-road-dem-conformance-20261120`.
Do **NOT** merge this experiment into main; the visual quality gate has **NOT** passed.

## Problem and input limitations

The previous polygon-union/terrain-triangle alignment successfully stopped road
triangles from cutting across the Terrarium DEM, but the road surface became
corrugated because the DEM includes steep local ridges. OSM provides *2D
centerlines*, not surveyed paved-road elevations/crossfall/vertical curves or
carriageway boundaries. The test dataset uses AWS Mapzen Terrarium, **not NGII**.

## Implemented experiment

- `geobench/road_elevation_profile.mjs`: densified per-grade OSM centerline
  graph; one height per shared OSM junction; iterative Laplacian smoothing;
  exact graph Lipschitz-envelope cap at 12% longitudinal segment grade; a
  nearest-segment 3D road-surface height field designed to give approximately
  level cross-sections along straight roads.
- `geobench/road_geometry.mjs`, `geobench/road_polygon_union.mjs`: apply
  that field consistently to asphalt, edge and markings, behind
  `GEO_ROAD_PROFILE_SMOOTH=1`. Default behavior is unchanged if off.
- `geobench/terrain_road_cut.mjs`: experimental approximation to avoid
  hiding asphalt below the original DEM. For at-grade (`0||`) road-edge
  polygons, remove overlapping **subdivided** source terrain patches, using
  eight divisions per source DEM triangle edge. It is NOT continuous terrain
  earthwork modelling, and no clean shoulder/retaining-wall connection is
  generated.
- `geobench/test_road_profile.mjs`: noisy DEM, shared junction, grade
  limit, cross-section and terrain-mask unit tests.
- `geobench/validate_road_profile.mjs`: actual Seoul surface slope and
  original-DEM penetration report.
- `.github/workflows/geo-road-profile-visual.yml`: isolated unit, actual
  Seoul build, native 3D Tiles package, and RTX close/overview/low-angle
  screenshots.

## Evidence

Before road-grade projection, initial run
https://github.com/nssang00/chatgpt-write-test/actions/runs/44732320973
FAILED the real 12% grade assertion: actual max was 63.0%.
The exact graph Lipschitz correction then passed in
https://github.com/nssang00/chatgpt-write-test/actions/runs/44732747882 .

Final experimental terrain-mask GPU run:
https://github.com/nssang00/chatgpt-write-test/actions/runs/44734169828
(three GitHub Actions jobs succeeded technically; GPU hardware was
RTX 5060 Ti / Chromium D3D11 ANGLE, with no GLB loading errors).

Final actual-Seoul numerical audit:

| Metric | Latest experimental result |
| --- | ---: |
| OSM road ways | 502 |
| Profile nodes / segments | 12,885 / 13,259 |
| Raw DEM segment maximum slope | 75.84% |
| Smoothed centerline segment maximum slope | 12.00% |
| Road-surface area-weighted median slope | 5.30% |
| Road-surface area-weighted p95 slope | 15.65% |
| Road-surface area above 20% slope | 2.85% |
| Road area at least 10 cm below original DEM | **27.47%** |
| Worst road-to-source-DEM vertical mismatch | **about 26.6m below / 23.0m above** |
| Source DEM terrain triangles | 18,432 |
| Terrain triangles after approximate mask | 176,427 |
| High/low tile triangles | 2,263,736 / 657,698 |

The % slope of a road **triangle face** is not the centerline longitudinal
grade; they measure different quantities. Maximum triangle face slope values
are not reliable at extremely thin union-triangulation slivers, so use
area-weighted distributions and a separate sliver validator.

Original road DEM-conforming baseline visual CI:
https://github.com/nssang00/chatgpt-write-test/actions/runs/44723900653

## Three GPU visual states and verdict

1. **Baseline DEM-conforming:** Roads visible; road top is corrugated.
2. **Road profile without terrain adjustment** (`44732747882`):
   profile slope is smoother, but asphalt is hidden under the original DEM
   across substantial areas; worse visually.
3. **Road profile plus subtriangle terrain mask** (`44734169828`):
   asphalt visible again, but road-side ground forms sharply cut, serrated
   boundaries and exposed void/background areas. This is still worse than
   an engineered smooth road/earthwork surface.

Screenshot artifact for final run: `seoul-road-profile-rtx-visual`
(`native-3dtiles-roadview.png`, `native-3dtiles-lowview.png`,
`native-3dtiles-real-browser.png`). Artifacts are short-lived.

**Visual quality gate: FAIL.** A success icon for the workflow means that
tests and screenshot capture completed, not that the road looks correct.

## Correct next architecture

1. **Hold the prior DEM-conforming branch as the visual baseline.**
   Keep this branch as an opt-in experimental profile; do not merge.
2. Acquire better vertical data: a trustworthy higher-resolution city DEM
   and, where possible, surveyed street grade and bridge/tunnel elevations.
   OSM alone cannot recover true carriageway profiles.
3. Implement a coupled roadbed/terrain surface, not a disconnected DEM hole:
   fit road longitudinal grade + crossfall and solve adjacent terrain
   cut/fill with continuous shoulders, preserving building foundations.
   The road and its earthworks must be generated **before** placing buildings
   and vegetation, so their bases inherit modified elevation.
4. Use proper planar asphalt/junction polygons, removing existing miter
   spikes, sliver triangles and tile-centroid assignment discontinuities.
5. Assert actual visuals in CI with road-only side view + surface/terrain
   contact diagnostics, triangle slenderness, and A/B from a **frozen**
   OSM/DEM snapshot. Numeric limits alone are insufficient.

No production merge or PR was created.
