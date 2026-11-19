# Detailed procedural 3D city: CesiumJS vs PlayCanvas

This is a revised benchmark for the same Daejeon OSM and AWS Terrarium area as the previous flat building comparison.

- Genuine data: 68-ish OSM footprints depending on live OSM state; real DEM sampled from AWS Mapzen Terrarium Z13, OSM streets.
- Generated (NOT actual building appearance): multi-story exterior windows, reflective glass color patches, facade palette, roof equipment, landscaping/trees, building height estimates when OSM tags are unavailable.
- Flat geometry plus thousands of colored window/wall panels; **not photogrammetry, not actual building textures or HDR physically based lighting**.
- Both engines get exactly the same vertices, indices and per-material colors. Cesium and PlayCanvas do not use ground imagery or automatic 3D Tiles here.
- 1280×720, same close-up focus and 60 degree vertical FOV, hardware run ABBA order on the same self-hosted GPU.
- Browser screenshots and time results are written to results/.

Local steps:

    cd geobench
    npm install
    npx playwright install chromium
    npm run data
    npm run bench

The previous benchmark can still be displayed using "?engine=cesium&style=plain". The default view on this branch is detailed.

**Visual fidelity is illustrative only.** OSM and DEM do NOT provide the precise walls, window positions, building finishes, roof profiles or real shadows; real-world-identical buildings need high quality 3D models with georeferencing and authentic facade textures. This fixture is designed to compare engine behavior on a more realistic-looking polygon workload, not to claim surveyed appearance.
