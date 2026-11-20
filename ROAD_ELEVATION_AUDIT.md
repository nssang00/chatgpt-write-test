# Seoul road geometry second review — heightfield artifacts, 2026-11-20

## Result

**Numeric geometry quality validation: PASS. Visual appearance validation: PENDING actual RTX screenshot inspection.** Do not merge or advertise as final road geometry yet.

Successful hosted build + geometry tests in GitHub Actions run https://github.com/nssang00/chatgpt-write-test/actions/runs/44688017139. In that same run, the self-hosted RTX screenshot job was queued at report-writing time.

Source region: Seoul Yeoksam/Gangnam, building footprints and OSM road ways unchanged. Original raster is AWS Mapzen Terrarium — no NGII survey DEM raster was obtained.

## Evidence: real OGC GLB dataset from preceding failed visual build

The previous native 3D Tiles GLBs were parsed directly: glTF accessor POSITION float32 arrays for road, shoulder and terrain, all 144 geographic cells.

- Prior terrain triangle had **up to 38.0m vertical drop** in **~19m horizontal width**.
- Prior road triangle had **18.03m vertical variation**; road-edge triangle **21.76m**.
- Thousands of triangles had more than 4m height change. This is why simply joining road segment polygons and overlaying junction patches did not repair the giant broken foreground polygons.
- Source pipeline `generate.mjs` used `Math.floor` to pick one Terrarium source elevation pixel, causing discontinuous pixel steps, followed by road-edge offsets sampling from sharp triangles.
- At-grade junction circles can still overlap, and the OSM maps are not lane-accurate. Those are distinct outstanding problems.

## Corrective changes

- `generate.mjs`: replace nearest raster-pixel lookup with bilinear interpolation across Terrarium pixel centers, including neighboring tiles.
- Apply and audit a **visual-only maximum 18% neighborhood terrain gradient** with conservative iterative pairwise redistribution; this makes the map usable as a stylized city scene, but it is NOT the original DEM and must not be treated as a surveyed terrain height.
- Plain building elevations follow the updated same triangulated terrain, and detailed buildings/roads follow a matching barycentric height function.
- `test_road_elevation.mjs`: calculate max per-triangle height variation / slope in the real Seoul fixture, and fail when 8m+ cliffs remain.
- `run-native-smoke.mjs`: record exact HTTP 404 response URLs and ignore only actual favicon requests; preserve strict failure for real GLB resource errors.

## Numeric regression result (all material geometries from actual Seoul fixture)

| Actual mesh | Maximum vertical change in one triangle before | After |
|---|---:|---:|
| Terrain | 38.00m | **3.41m** |
| Road asphalt | 18.03m | **3.04m** |
| Road-edge shoulder | 21.76m | **3.82m** |
| Road marking | 5.76m | **1.05m** |

0 terrain/road/shoulder triangles had an 8m-or-more vertical variation after correction.

Terrain numerical verification: `ROAD_ELEVATION_TRIANGLE_QA_PASS`. Rendered DEM gradient max 18.00004%. 770 projection iterations. Affected vertices: 3,291. **Largest original-to-display height adjustment: 53.76m**.

**Critical caveat**: A 53.76m local height adjustment demonstrates that the base raster is not suitable for trustworthy fine urban road elevations. This slope limiter is a *visual approximation* ONLY, and should ultimately be replaced by verified bare-earth national survey DTM/DEM and real road grade metadata. It is not safe for routing slope or road engineering.

## Remaining before visual PASS

1. Inspect new real RTX close-range roadway screenshot; reject giant spikes, gaps, flicker, road undershoots and wrong bridge elevation.
2. Replace circular road-junction overlays with robust polygon union and proper planar vertex merging where overlapping polygons remain.
3. Sample roads on a proper road-grade profile; grade separation requires bridge/tunnel elevations and no false shared-node intersection.
4. Review road clipping across 3D Tiles content boundaries and camera transitions. The GLB exporter currently assigns full triangles to cells by centroid, which can create inconsistent tile-level visibility and seams.
5. Repeat the identical fixed camera screenshot, not an AI illustration.

This branch deliberately does **not** rewrite engine-specific rendering: all Cesium, Three.js, PlayCanvas and Babylon.js still consume the same corrected geometry.
