# Seoul road intersection second-pass QA — actual browser images

Updated 2026-11-20.

## Status

**Terrain cliffs: corrected in the visualization-only urban DEM smoothing branch.**
**Road intersections: still NOT production-quality despite bounded intersection polygon patch.**

The source raster is AWS/Mapzen Terrarium, **not** an NGII bare-earth DTM.
This branch contains the earlier urban terrain median/Gaussian/slope repair and
a new OSM incident-road-width convex-hull polygon fan instead of the prior
circular intersection patches.

## Verified actual results

- Source OSM buildings: 2,085; roads: 502 ways.
- Terrain raw: max adjacent rise 25m over about 14m, max grade 1.86.
- Terrain corrected: max adjacent rise 3.48m, max grade 0.25, source raster adjustments up to 49.4m in some samples. This is an *estimated visual ground*, not surveyed topography.
- Old road mesh has 660 at-grade visual intersection patches, densification to 6m and miter joins. This branch replaces disk patches with polygons informed by each incident road direction and width.
- 8 synthetic road topology unit tests and geometry audits pass.
- Native Cesium3DTileset 1.1 GLB export passes, and real browser visual QA passes as a *software/code execution test*.
- Chrome road-view visual QA: https://github.com/nssang00/chatgpt-write-test/actions/runs/44688750203
- Earlier actual RTX screenshot from the unsmoothed ground: https://github.com/nssang00/chatgpt-write-test/actions/runs/44670492874

## Explicit perceptual QA verdict: NOT PASSED

Inspection of real, identical-camera Chrome screenshots:
- Previously dominant jagged, vertically raised terrain/road spikes disappeared after urban ground filtering.
- Switching the junction disk to an incident-road polygon changed the boundaries and removed some bulb-like intersection forms.
- **However broad merged asphalt patches, angular seams, odd verge strips, and intersection edges remain.** Screen-space comparisons show a relatively small visible change after only replacing the local intersection patch.
- A convex hull fan is NOT a mathematically exact polygon union of offset road corridors. It can over-cover the roadway and generate spurious asphalt areas. This result does not prove correct real-world road width, road markings or lane geometry.
- Ground-draped bridges/tunnels also remain physically incorrect. Fine urban DTM or surveyed road data is required to improve vertical geometry beyond a visualization approximation.

## Correct next engineering stage (avoid premature engine benchmarks)

1. Replace the mesh of **all roads in each at-grade connected region** with exact 2D polygon boolean unions of buffered OSM centerlines, preserving holes and intersections; triangulate correctly with clipping and appropriate buffer cap/join rules. Use `polygon-clipping` or equivalent robust geometric operations in preprocessing (not per browser frame).
2. Compute pavement and verge/curb polygons from the same unioned geometry; never layer separate overlapping asphalt polygons that fight for depth.
3. Treat grade-separated roads and ramps separately; classify bridge/tunnel/layer and avoid false at-grade unions.
4. Repair source DTM from NGII or credible high-resolution bare-earth data. For AWS visual fallback, explicitly record smoothing so users do not confuse it with surveyed elevations.
5. Add image-based before/after comparisons on multiple junction locations, including screenshots viewed close to ground and tile-seam traversals, not only aerial view.
6. Only after this visual QA passes, redo four/five-engine rendering comparisons on the updated shared city data.

Current work branch: `fix/seoul-road-junction-polygon-20261120`. This branch is an experimental validation branch; do not merge as fully corrected roads yet.
