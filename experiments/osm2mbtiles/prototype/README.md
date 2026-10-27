> **Experimental detailed vector PBF MBTiles:** Default `run.bat` still produces the existing PNG raster map. Run `run.bat vector` for detailed vector MBTiles or `run.bat both` for separate raster/vector files. See [VECTOR-UPDATE.ko.md](VECTOR-UPDATE.ko.md) for coverage, validation and limitations.

Windows one-click launcher: double-click **`run.bat`** to download the Geofabrik South Korea extract and write **`south-korea-latest.mbtiles`** next to the launcher. Requires an existing Ubuntu/Debian WSL installation (no Docker or Windows Python). The PBF is cached within WSL; see [WINDOWS-ONECLICK.md](WINDOWS-ONECLICK.md). Windows-native runtime is not bundled; end-to-end Windows conversion is not yet validated.

# osm2mbtiles-local (prototype)

Docker-free command-line orchestration for **OpenStreetMap Carto / Mapnik raster MBTiles**. The **intended** end-user experience, once the native runtime is bundled into a release, is:

```bash
osm2mbtiles south-korea-latest.osm.pbf -z 0-15 -o korea.mbtiles
```

This is an **engineering prototype, not a prebuilt ready-to-run release**. The orchestration, PBF header parser, tile enumeration, local DB lifecycle, Mapnik worker, and MBTiles validation are implemented. **A distributable native PostgreSQL + PostGIS + osm2pgsql + Mapnik + Python/Mapnik runtime has NOT been packaged**, and an actual Carto map render has NOT yet been executed or pixel-compared. The one-line experience is thus a design target, not a proven end-user deliverable.

## Architecture

```
CLI (Python)
  -> read Geofabrik PBF HeaderBBox (or --bbox)
  -> native runtime inside release (NO Docker)
     -> initdb local PG cluster (SCRAM password; socket-only on Unix)
     -> pg_ctl start (private; no OS service registration)
     -> createdb; PostGIS / hstore
     -> osm2pgsql flex with pinned openstreetmap-carto-flex.lua
     -> indexes.sql; functions.sql; common-values.sql
     -> upstream external-data and font scripts
     -> Mapnik style project.xml, 8x8 metatiles, buffer=128 px if style has none
     -> PNG 256x256 XYZ tiles converted to TMS rows in SQLite MBTiles
     -> checkpoint, SQLite integrity_check, atomic final rename
     -> pg_ctl stop; optionally keep workdir to reuse import
```

No tile server, Apache, renderd, or Docker is required by the design. **PostgreSQL still runs temporarily as a local, private process.**

## Current usage (after preparing a runtime)

```bash
python -m pip install -e .
python -m osm2mbtiles doctor --runtime ./runtime
python -m osm2mbtiles korea.osm.pbf -z 0-15 -o korea.mbtiles --runtime ./runtime
python -m osm2mbtiles korea.osm.pbf -z 0-15 -o korea.mbtiles --runtime ./runtime --workdir ./private-job
python -m osm2mbtiles korea.osm.pbf -z 0-15 -o korea.mbtiles --dry-run
python -m osm2mbtiles verify korea.mbtiles
python -m osm2mbtiles compare reference.mbtiles korea.mbtiles --pixels
```

`--bbox west,south,east,north` overrides the OSM PBF header bounding box, e.g. for PBF files missing a bounding box. `--max-tiles` is a safety guard (default 2 million). Existing output files cannot be overwritten without `--force`. A partial output is kept as `<name>.partial` if rendering fails; on rerun the worker skips previously committed tiles if the job fingerprint matches.

## Runtime bundle contract

The app looks for a runtime next to a packaged executable (or `./runtime` under the source tree), can use `OSM2MBTILES_RUNTIME`, or accepts `--runtime`:

```
runtime/
  bin/{initdb,pg_ctl,createdb,psql,osm2pgsql,ogr2ogr}
  lib/...
  python/bin/python3         # Python including mapnik, PyYAML, requests, psycopg2
  styles/osm-carto/
    project.xml              # CartoCSS compiled to Mapnik XML
    openstreetmap-carto-flex.lua
    indexes.sql
    functions.sql
    common-values.sql
    external-data.yml
    scripts/get-external-data.py
    scripts/get-fonts.py
    style/...                # complete pinned upstream style assets
```

The `runtime` must include matched native dependencies, PostGIS extension files under PostgreSQL's expected extension path, Mapnik input plugins, font resources, and GDAL/PROJ data. **Do not just copy a few executables from Linux and expect the bundle to be portable.** A release packager must link/test PostgreSQL/PostGIS/Mapnik against the target OS and architecture and honor third-party redistribution licenses.

Developer-only helper to stage *already-installed* Linux packages (not suitable for distributing):

```bash
# Prepare pinned OpenStreetMap Carto checkout, then compile XML:
# carto -a '3.0.22' project.mml > project.xml
python tools/stage_from_system.py --style-src /path/to/openstreetmap-carto --dest runtime
```

The official OSM Carto 6.1.x tree expects flex import, `common-values.sql`, extra datasets, and Noto fonts. The source checkout does not always contain a compiled `project.xml`; provide one pinned to the version. First-run asset downloading requires a network connection unless the release pre-bundles assets. For truly hands-off operation, ship pre-downloaded fonts and external data with the runtime.

## Tests and limits

```bash
python -m pytest -q
```

Tests create synthetic OSM PBF headers, execute the pipeline through fake native PostgreSQL tools and fake Mapnik that emits real 256x256 PNG tiles, inspect MBTiles SQLite structure, check TMS row flips and DB reuse, verify PNG headers, and compare outputs. These tests **do not** prove that a real PostgreSQL/PostGIS runtime starts, a Geofabrik PBF imports, the upstream data/fonts download succeeds, or pixels match OpenStreetMap's website.

Minimum requirements for a true visual parity test:
1. Build a native runtime on Linux x86-64 including the exact PostGIS/Mapnik/Carto dependencies.
2. Load a pinned, real Geofabrik PBF with bundled external datasets and fonts.
3. Render the same bbox/zoom using existing `renderd` and the exporter with the **same dataset and style/config versions**.
4. Run `osm2mbtiles compare reference.mbtiles candidate.mbtiles --pixels` and investigate mismatches (Mapnik version, font fallback, metatile buffer, scale factor, external data, crop coordinates).
5. Repeat on Windows-native separately if a native Windows runtime is intended; WSL-only support would not satisfy that goal.

## Safety and scope

- Source and binary dependencies are pinned by the runtime builder (not yet implemented); external downloads must be verified before a public release.
- Private postgres cluster uses SCRAM authentication; Linux disables TCP listening. Windows binds only loopback during the job, with a random available port and SCRAM credentials.
- `--workdir` refuses nonempty unowned directories; its app-specific data remains on disk for reuse. A default temporary directory is removed on exit.
- Large area/high zoom rasters can require enormous disk space and processing time. Initial worker is single-process; resume skips completed tiles.
- MBTiles is a **raster tile container** here; it cannot reconstruct the global website with global-planet features outside the extract.
- OpenStreetMap attribution and the database's ODbL obligations still apply to downstream distribution.

License of the current prototype code: MIT (see LICENSE). Third-party tools/fonts/data are subject to their original licenses and are NOT shipped in this archive.


> **2026-10-27 compatibility fix:** `run.bat` checks osm2pgsql >= 1.8.0 for OSM Carto 6 flex style and builds a cached private 1.11.0 copy when Ubuntu/WSL supplies an older binary. Existing PBF cache is reused. See WINDOWS-ONECLICK.md.