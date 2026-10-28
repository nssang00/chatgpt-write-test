# Seoul region benchmark (Planetiler vs tilemaker)

The workflow [`.github/workflows/mbtiles-benchmark-seoul.yml`](../.github/workflows/mbtiles-benchmark-seoul.yml)
benchmarks dense urban OSM features without assuming Geofabrik publishes a Seoul-specific PBF.

## Reproducible study area

- Parent: `https://download.geofabrik.de/asia/south-korea-latest.osm.pbf`
- Longitude range: **126.75–127.19°E**, latitude: **37.42–37.72°N**
- **This rectangle includes Seoul and parts of surrounding Gyeonggi/Incheon. It is NOT Seoul's administrative polygon.**
- Extraction: `osmium extract --bbox 126.75,37.42,127.19,37.72 --strategy smart --set-bounds`.
- Smart extraction keeps multipolygon member geometries complete where possible; it may carry geometries extending beyond the bbox. Both converters read the same resulting `work/input.osm.pbf`.
- The workflow records the parent and extracted PBF SHA-256 and checks node/way references before benchmarking.
- Parent PBF download and extraction time are excluded from timed conversion.

## Experiments

1. **Controlled**: identical source, z14 only, highway lines and building polygons, same output layer names and attributes. See `benchmarks/roads-buildings-*.yml/json/lua`.
2. **Full**: the default OpenMapTiles-compatible engine profiles across z0–z14. Profiles are **not equal**. Planetiler processes some additional auxiliary sources.
3. Engines run in a balanced four-round ABBA sequence with fresh output MBTiles. Compilation and dependency/source downloads are excluded.
4. Report `/usr/bin/time` elapsed, user CPU, peak RSS, MBTiles size, tile count, MVT decoded per-layer entry counts; comparative summary warns if roads/buildings differ >5%.

## Interpretation

This test measures a **densely populated Seoul-area clip**, not full South Korea and not large-data scaling.
A greater number of per-tile features can result from clipping and buffers, not only more OSM objects.
Feature count similarity is not sufficient for exact geometry equivalence.

The 4-round workflow may use GitHub-hosted runner resources; a failure due to memory, disk or download
is a **capacity limitation**, not a demonstrated slower conversion. For rigorous area-by-area scaling,
compare several PBF extents on identical machine classes.
