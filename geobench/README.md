# CesiumJS vs PlayCanvas: OSM + DEM experiment

This is an engine-isolation benchmark, not a Cesium 3D Tiles / terrain-provider benchmark.

## Comparable scene

- Area: Daejeon, South Korea, bbox 127.3810,36.3450 to 127.3900,36.3520.
- OSM: small raw-map request (buildings only; closed ways; building relations omitted).
- DEM: AWS Terrain Tiles / Terrarium at Z13; RGB height decoded.
- Common fixture: identical triangle indices, vertices, per-building heights, camera orbit, viewport (1280×720).
- Terrain: 65×65 grid; buildings: OSM footprints extruded using height tag, building levels × 3m, or inferred 12m if unavailable. The inferred-height count is recorded.
- Color-only, unlit meshes; no shadows, imagery, photogrammetry, Cesium terrain/3D Tiles streaming, texture differences or game physics.
- Local coordinates ENU: east/up/north meters. Cesium gets a WGS84 ENU transform; PlayCanvas stays local.
- Results: browser RAF frame delta p50/p95, frames rendered per second, GPU renderer identifier, screenshots and input metadata.
- Browser vsync imposes a ceiling on observed FPS. This is not a GPU kernel-level timing comparison.

## Run locally

    cd geobench
    npm install
    npx playwright install chromium
    npm run data
    GEO_TEST_KIND=software npm run bench

Both GitHub Actions jobs use the same generated fixture. The Linux hosted job is a software renderer sanity check, not a hardware comparison. The Windows self-hosted, Windows, X64, m5-gpu job is a hardware GPU benchmark and fails if it detects SwiftShader or llvmpipe.

The GitHub Action saves results/benchmark.json plus Cesium and PlayCanvas screenshots. See .github/workflows/geo-renderer-bench.yml.

## Limits

- This isolates straightforward city triangle rendering. It does not measure Cesium globe and 3D Tiles advantages.
- OSM geometry may have holes/relations omitted. For visual fidelity, use a GIS-aware extrusion pipeline.
- Terrarium Z13 pixel interval is not guaranteed source survey resolution.
- Real engine performance depends on material complexity, GPU, LOD, tile caching, platform and scene density.
- Attribution: © OpenStreetMap contributors (ODbL), AWS Terrain Tiles / Mapzen and underlying sources; check upstream attribution for redistribution.
