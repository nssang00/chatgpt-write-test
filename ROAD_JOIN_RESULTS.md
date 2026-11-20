# Seoul road topology and join preprocessing — completed first iteration

## RTX visual QA outcome (updated after GPU screenshot inspection)

**VISUAL QUALITY: NOT PASSED.**

Run: https://github.com/nssang00/chatgpt-write-test/actions/runs/44670492874  
Its RTX 5060 Ti screenshot artifact: `seoul-native-road-joins-rtx-visual`, including `native-3dtiles-roadview.png`.

- Genuine RTX Cesium3DTileset rendered the new geometry, with 89 tile load events, 0 native tile loader errors and 91 rendered frames.
- The GitHub Action ended in FAILURE because a generic browser console 404 was recorded; its URL was not captured, so the source of the 404 remains unknown. Do NOT assert that it was a favicon or an ignorable error.
- **Manual pixel inspection of the actual screenshot found large jagged grey polygonal road/ground fragments and irregular overlaps at the foreground.** This is not the natural road topology target. The 8 synthetic unit tests and successful GLB export test the code path, not perceptual/geometry quality.
- Do **not** merge this into the production branch or declare the city roads visually fixed on the strength of the numerical topology counters.
- Next actions: (a) log exact failing HTTP resource URL, (b) isolate road / road-edge / junction surface overlays in fixed-camera screenshots, (c) inspect false miter/width/degenerate triangles and intersection-patch overlaps, (d) use planar polygon clipping and union for robust crossing geometry where needed, (e) rebuild native 3D Tiles and manually compare before/after screenshots.


**Date**: 2026-11-20.  
**Successful CI**: https://github.com/nssang00/chatgpt-write-test/actions/runs/44670068132  
**Original region**: Seoul Gangnam / Yeoksam OSM bbox [127.0310,37.4960,127.0450,37.5080].  
**Terrain**: AWS Mapzen Terrarium; **not** authentic NGII DEM.

## Motivation

The previous four-engine and Cesium3DTileset tests consumed the exact same discontinuous segment-wise road rectangles. This was an **input geometry limitation, not an engine problem**. Fix upstream preprocessing so all five render modes benefit without architecture-specific patches.

## Implemented

- `road_geometry.mjs`: pure shared geographic road mesher with no engine dependency.
- Adjacent OSM polyline segments are now joined by **shared cross-section vertices** and **bounded-miter joins**. Tight turns cap miter extension at 2.3 half-widths and detect reversals. No per-segment butt-end gaps on ordinary bends.
- 2D Liang-Barsky clipping, with 12m halo, keeps segments that cross the bbox even when **both endpoints lie outside**. Previous test omitted some of these.
- Road path densification to **6m maximum spacing**, using each offset vertex's ground elevation. The `enhance.mjs` ground sampler was updated from bilinear interpolation to **barycentric interpolation on the exact two triangles** used by the drawn DEM mesh, reducing z-fighting/road burial.
- OSM shared-node graph controls **approximate intersection fans** at ground-level three-way+ junctions and sharp split-way two-way corners. Patch materials cover centerline seams.
- OSM `layer`, `bridge`, `tunnel` tags prevent a false *topological connection* across levels. They do **not** provide surveyed 3D road vertical profiles; the bridge/tunnel surfaces are still ground-draped for this first iteration.
- Continuous dashed centerline phase across OSM way segments, skipped near recognized junctions and on explicit one-way / single-lane roads.
- Wider supported OSM `highway` categories, including principal link roads and trunk/motorways. Parsed `width` tag when present. Widths are otherwise approximations.
- Outputs the same scene geometry through the common four-engine mesh fixture and Cesium native 3D Tiles / GLB, so differences in terrain and intersections are **not renderer-specific**.

## Verified on real Seoul dataset

GitHub Actions `ROAD_TOPOLOGY_UNIT_TEST_PASS` — eight independent synthetic topology scenarios.

| Detail | Result |
|:--|--:|
| OSM buildings retained | 2,085 |
| Road ways with geometry | 502 |
| Original OSM road segments considered | 1,772 |
| Road subsegments in final joined mesh | 10,196 |
| Mitered segment boundary joints | 9,694 |
| Intersection patches (not surveyed polygon intersections) | 660 |
| Road marking dashes | 2,860 |
| Grade-separated ways recognized | 17 |
| Procedural windows retained | 302,427 |
| OGC 3D Tiles 1.1 source spatial cells | 144 |
| GLB bytes across both LOD levels | 68,169,924 |

3D Tiles exporter finished with 144 nonempty spatial cells, high LOD 1,711,541 triangles and low LOD 105,503 triangles.

## Limitations and next work

**Not yet a lane-accurate roadway reconstruction.** Real road intersection polygon-union, kerb/sidewalk topology, offset road polygons, islands, lane splitting, traffic markings/crosswalks, bridge/tunnel elevation ramps and geometric vertical clearance require further work.

Important: Some disconnected roads may be missing from OSM coverage or inaccurate tags. Do not connect geometric line crossings just because they look close: bridge or tunnel crossings must be topologically separated. OSM explicitly models true at-grade intersections using shared nodes. OSM node/way data and the `layer` key are used for this distinction.

The CI success validates geometry construction, regression tests, and native GLB export, **not** a pixel-level visual quality review. A new screenshot capture and GPU comparison with identical before/after camera positions should be done before asserting all city roads look natural. Existing old-geometry GPU FPS must not be relabeled as new-road GPU results.

## Priorities for choosing the production engine (separate benchmark lane)

1. Use the same 3D Tiles GLBs and matched SSE / LOD / tile cache budgets across native Cesium and official 3DTilesRendererJS integrations for Three.js / PlayCanvas / Babylon.js. Measure visible coverage and peak memory, not just FPS.
2. Stress-test longer geospatial paths / 10km2 / 50km2, cold-start, download volume, p95/p99 and GPU VRAM.
3. Test actual midrange Android Chrome and measure thermal stability / memory crashes over 15min.
4. Interaction workload: building picking/highlighting from tens of thousands of entities, metadata lookup, moving traffic and optional collisions.
5. Visual quality: real texture atlases/PBR/shadows plus genuinely licensed DTM/DEM, and detailed road intersection semantics.

Summary: road joints are an upstream shared data issue; they should not determine library selection. Continue engine choice with the native 3D Tiles renderer interoperability test.
