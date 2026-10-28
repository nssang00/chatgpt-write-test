# Planetiler vs tilemaker: controlled and full-profile benchmark

This GitHub Actions workflow includes **two separate experiments** for the same Geofabrik .osm.pbf.

## Controlled: matched OSM-only roads/buildings (primary comparison)

* Same PBF SHA256, same spatial extent, and **z14 only**.
* Layer names: `roads` and `buildings`; output attributes `highway` / `building`.
* Roads: ways with `highway` tag, excluding explicit `area=yes`.
* Buildings: polygons tagged `building` except `building=no`; tilemaker uses closed ways and multipolygons.
* No auxiliary shapefiles, landcover, Natural Earth, translations or coastlines.
* Both gzip MVT and MBTiles.
* Custom profiles live in `benchmarks/roads-buildings-planetiler.yml`,
  `benchmarks/roads-buildings-tilemaker.lua`, and `benchmarks/roads-buildings-tilemaker.json`.

**Limitations**: this is not bit-for-bit output parity. OSM geometry classification,
multipolygon assembly, polygon simplification, tile clipping and handling of closed
roads may differ. MVT parsing records per-layer z14 feature counts to catch discrepancies.
If a layer differs by >5% the report warns that the test is **not equivalent-output throughput**.
Even differences below 5% do not demonstrate geometrical equality.

## Full default-profile test (out-of-box practical run, not apples-to-apples)

Each tool runs its own OpenMapTiles-compatible built-in configuration, including differing
auxiliary datasets and layer selection. This shows practical end-to-end speed only.
It **must not** be cited as a pure JTS-vs-Boost.Geometry speed measurement.

## Measurement rules

1. Download one Geofabrik PBF once and record SHA256.
2. Install Java/build C++, download coastline/Natural Earth outside timed sections.
3. Each measured run starts a new converter process with a new output MBTiles file.
4. Run order within each mode is ABBA for four rounds: PL→TM, TM→PL, TM→PL, PL→TM.
5. No engines run concurrently. `/usr/bin/time` records wall/user/system/peak RSS.
6. After timing, decode MVT geometry counts per layer; validate control has z14 roads + buildings.
7. Summaries use medians; the first-run cold-cache effect remains a limitation and is
   mitigated, not eliminated, by alternating order.
8. Full mode includes **processing** auxiliary data after download; therefore it is not
   a controlled OSM-only benchmark.

## How to run

* PR workflow changes trigger a **one-round smoke test** for both modes.
* Once the workflow exists on the repository default branch, manually select
  `Actions → Geofabrik PBF to MBTiles Benchmark → Run workflow`.
* Manual inputs: `geofabrik_path=europe/luxembourg`, `planetiler_area=luxembourg`,
  `repetitions=4` for a balanced ABBA run.
* For South Korea use `asia/south-korea`, `south-korea`; a larger self-hosted runner
  is likely necessary due to data size and resource constraints.

Outputs in `mbtiles-benchmark-report`: `metrics/comparison.md`,
`metrics/controlled/summary.md`, `metrics/full/summary.md`,
per-run timings, CSV zoom stats, MVT feature counts and SHA256.

The full MBTiles themselves are intentionally not uploaded. The reported feature
counts are **per-tile MVT feature entries**, not de-duplicated OSM features.
