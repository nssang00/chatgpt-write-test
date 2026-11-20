# NGII DEM → Four-engine 3D city benchmark

This branch extends the CesiumJS, PlayCanvas, Three.js, and Babylon.js Daejeon test to accept an AUTHENTIC raster exported by the National Geographic Information Institute (NGII / 국토지리정보원).

## Data acquisition (mandatory)

Official dataset listing: https://www.data.go.kr/data/15059920/fileData.do
NGII map/data platform: https://map.ngii.go.kr/

The dataset listing describes IMG format, but obtaining actual raster bytes may require NGII portal login, a Windows large-file transfer application, and sometimes dataset-specific approval. We have NOT acquired any NGII DEM file; the repository does NOT include NGII terrain bytes.

1. Download original NGII DEM raster data (.img / .tif / .tiff / .vrt and relevant sidecars) covering the complete geographic bbox: west 127.3810, south 36.3450, east 127.3900, north 36.3520.
2. Verify the selected product's data licence and redistribution rights, especially for higher resolution / access-restricted products.
3. Place NGII files in a directory on the self-hosted RTX Windows runner, for example D:/NGII/Daejeon. This path is an example, not an assertion that these files currently exist.
4. GitHub → Actions → "NGII DEM four-engine verification" → Run workflow. Select branch bench/ngii-dem-four-engines-20261120 and enter that absolute directory under the ngii_dem_dir input.
5. Actions runs the source CRS conversion, NGII terrain integration, and a four-engine GPU comparison. Outputs screenshot PNGs and numerical JSON only, not the raster or the derived mesh.

## Strict data-source provenance

- Missing / invalid NGII input means FAILED test. No fallback to AWS/Mapzen.
- Supports Erdas Imagine IMG and GeoTIFF through GDAL/rasterio. Automatically transforms Korean projected coordinates, such as EPSG:5186, into WGS84.
- Source must cover the FULL test geographic bounding box; partial NGII sheets cause a failure instead of filling missing values with AWS.
- The output terrain mesh targets nominal 5m grid spacing, but this does NOT improve the resolution of a coarse DEM. Recorded source native pixel sizes must be inspected before any quality claim.
- All road, window, facade, roof and building Y coordinates are rebased against NGII ground elevations. This does not fix missing OSM road intersections, terrain artifacts, or unsurveyed facade details.
- NGII source vertical datum must be confirmed before mixing elevations from different providers.
- Source raster and high-resolution derived fixture remain on the self-hosted runner. GitHub artifacts include ONLY screenshots and frame-time metadata.
- The push-triggered CI test uses a temporary, synthetic constant-height raster in Korean EPSG:5186. It validates the converter and missing-source protection, and is NOT a real NGII benchmark.

## Run locally

    cd geobench
    npm install
    npm run data
    python -m pip install rasterio numpy
    python ngii_rebase.py --dem-dir /path/to/authentic/ngii/rasters --grid-step 5
    GEO_DEM_SOURCE=ngii GEO_TEST_KIND=hardware npm run bench

GitHub workflow: .github/workflows/ngii-four-engine.yml

The previous AWS Terrarium-based performance data remain in FOUR-ENGINE-RESULTS.md and MUST NOT be relabeled as NGII results.

## Scaling reminder

Four similar FPS figures at browser-vsync do not prove the engines are equally performant when streaming hundreds of thousands of buildings. A proper country-scale comparison must include spatial chunking, memory ceilings, geodetic transforms, per-LOD data and camera-tour loads. CesiumJS has native geographic data/3D Tiles infrastructure, while the other three need additional data/streaming architecture.
