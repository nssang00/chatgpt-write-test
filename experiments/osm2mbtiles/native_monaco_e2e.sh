#!/usr/bin/env bash
# REAL native E2E: Geofabrik PBF -> osm2pgsql flex/PostGIS -> upstream OSM Carto
# -> Mapnik 2x2 metatile -> PNG raster MBTiles. No Docker or mocked binaries.
set -euo pipefail

ROOT="$(pwd)"
OUT="$ROOT/experiments/osm2mbtiles/output"
mkdir -p "$OUT"
WORK="$(mktemp -d)"
mkdir -m 700 "$WORK/socket"
printf '%s\n' "$(openssl rand -hex 24)" > "$WORK/pw"
chmod 600 "$WORK/pw"
export PGUSER=osm2mbtiles PGDATABASE=gis PGHOST="$WORK/socket" PGPORT=55432
export PGPASSWORD="$(cat "$WORK/pw")"
cleanup() {
  status="$?"
  pg_ctl -D "$WORK/pgdata" -m immediate -w stop >/dev/null 2>&1 || true
  if [ -f "$WORK/postgres.log" ]; then
    cp "$WORK/postgres.log" "$OUT/postgres.log" || true
  fi
  echo "E2E finished with status=$status"
}
trap cleanup EXIT

initdb -D "$WORK/pgdata" -U "$PGUSER" --auth-local=scram-sha-256 --auth-host=scram-sha-256 --pwfile="$WORK/pw"
pg_ctl -D "$WORK/pgdata" -l "$WORK/postgres.log" -w -o "-c listen_addresses='' -c unix_socket_directories=$WORK/socket -c port=$PGPORT -c jit=off" start
createdb "$PGDATABASE"
psql -X -v ON_ERROR_STOP=1 -c "CREATE EXTENSION postgis; CREATE EXTENSION hstore;"
psql -XAtc "SELECT postgis_full_version()" > "$OUT/postgis_version.txt"

echo "Getting Geofabrik Monaco data..."
curl --fail --location --retry 3 --silent --show-error \
  "https://download.geofabrik.de/europe/monaco-latest.osm.pbf" -o "$WORK/monaco.osm.pbf"
test -s "$WORK/monaco.osm.pbf"
sha256sum "$WORK/monaco.osm.pbf" > "$OUT/input_sha256.txt"
echo "Getting pinned OSM Carto stylesheets..."
git clone -q --depth 1 --branch v6.0.0 \
  https://github.com/openstreetmap-carto/openstreetmap-carto.git "$WORK/openstreetmap-carto"
cd "$WORK/openstreetmap-carto"
carto -a 3.0.22 project.mml > project.xml
test -s project.xml
sha256sum project.xml > "$OUT/style_sha256.txt"

echo "Importing Geofabrik PBF into isolated PostgreSQL/PostGIS..."
osm2pgsql -O flex -S openstreetmap-carto-flex.lua -d gis "$WORK/monaco.osm.pbf"
psql -X -v ON_ERROR_STOP=1 -d gis -f indexes.sql
psql -X -v ON_ERROR_STOP=1 -d gis -f functions.sql
psql -X -v ON_ERROR_STOP=1 -d gis -f common-values.sql
echo "Fetching and installing upstream OSM Carto external data and fonts..."
# The upstream importer downloads >1 GB and can fail on transient network errors.
# --cache --no-update preserves successful downloads and already loaded tables.
external_loaded=0
for retry in 1 2 3 4; do
  if /usr/bin/python3 scripts/get-external-data.py --cache --no-update; then
    external_loaded=1
    break
  fi
  echo "External data import attempt $retry failed; retrying from local cache..."
  sleep 5
done
test "$external_loaded" -eq 1
# The upstream Hanazono font mirror can disappear; Monaco's Latin glyphs
# render with OS-provided Noto fonts. Keep this smoke check independent
# of a remote optional font server. Pixel-parity CI must pin font files.
echo "Downloading pinned OSM Carto Noto font files (omit unreachable optional Hanazono mirror)..."
/usr/bin/python3 - <<'PYFONTFIX'
from pathlib import Path
script = Path("scripts/get-fonts.py")
s = script.read_text(encoding="utf-8")
start = s.index('downloadToFile(\n    ["https://mirrors.dotsrc.org/osdn/hanazono-font/')
end = s.index("# clean up tmp directories", start)
script.write_text(s[:start] + "# Hanazono mirror unavailable in GitHub CI; other upstream fonts unchanged\n" + s[end:], encoding="utf-8")
print("Skipping only optional Hanazono font mirror; preserving upstream Noto/Emoji download")
PYFONTFIX
/usr/bin/python3 scripts/get-fonts.py
# OSM Carto FontSet validates Hanazono family names at map-load time.
# Ubuntu package fonts-hanazono contains the exact HanaMinA/B 20170904 fonts.
ln -sf /usr/share/fonts/truetype/hanazono/HanaMinA.ttf fonts/HanaMinA.ttf
ln -sf /usr/share/fonts/truetype/hanazono/HanaMinB.ttf fonts/HanaMinB.ttf
test -s fonts/HanaMinA.ttf
test -s fonts/HanaMinB.ttf
fc-cache -f fonts

echo "Rendering a real 2x2 Mapnik metatile and writing MBTiles..."
/usr/bin/python3 - "$OUT" <<'PY'
import hashlib, io, json, math, sqlite3, sys
from pathlib import Path
import mapnik
from PIL import Image as PILImage, ImageStat

out = Path(sys.argv[1])
# Monaco central map coordinate in WebMercator.
z = 14
lat, lon = 43.735, 7.423
n = 1 << z
x = int((lon + 180.0) / 360.0 * n)
y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) * n / 2)
mx, my = x - x % 2, y - y % 2
R = 20037508.342789244
step = 2 * R / n
bounds = mapnik.Box2d(-R + mx * step, R - (my + 2) * step,
                       -R + (mx + 2) * step, R - my * step)
m = mapnik.Map(512, 512)
mapnik.load_map(m, "project.xml", True)
m.buffer_size = 128
m.zoom_to_box(bounds)
bitmap = mapnik.Image(512, 512)
mapnik.render(m, bitmap)
output = out / "monaco.mbtiles"
with sqlite3.connect(output) as db:
    db.execute("CREATE TABLE metadata(name TEXT PRIMARY KEY, value TEXT)")
    db.execute("CREATE TABLE tiles(zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB NOT NULL, PRIMARY KEY(zoom_level,tile_column,tile_row))")
    db.executemany("INSERT INTO metadata VALUES (?,?)",
                   [("name", "Monaco native smoke"), ("format","png"), ("type","baselayer"),
                    ("minzoom","14"), ("maxzoom","14"), ("version","1.3"),
                    ("bounds","7.40,43.71,7.45,43.75"),
                    ("attribution","© OpenStreetMap contributors")])
    digests = []
    variances = []
    for dy in range(2):
        for dx in range(2):
            png = bitmap.view(dx * 256, dy * 256, 256, 256).tostring("png")
            image = PILImage.open(io.BytesIO(png)).convert("RGB")
            assert image.size == (256, 256)
            variances.append(max(ImageStat.Stat(image).var))
            tile_x, tile_y = mx+dx, my+dy
            db.execute("INSERT INTO tiles VALUES (?,?,?,?)",
                       (z, tile_x, n-1-tile_y, png))
            digests.append(hashlib.sha256(png).hexdigest())
    db.commit()
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert db.execute("SELECT COUNT(*) FROM tiles").fetchone()[0] == 4
    assert db.execute("SELECT value FROM metadata WHERE name='format'").fetchone()[0] == "png"
    # Guard against creating only empty/flat-colour tiles.
    assert any(value > 50 for value in variances), f"all generated tiles appear blank, variances={variances}"
    (out / "evidence.json").write_text(json.dumps({
        "input": "Geofabrik Monaco PBF", "db": "temporary PostgreSQL/PostGIS",
        "style": "OSM Carto v6.0.0", "zoom": z,
        "metatile": {"x": mx, "y": my, "width": 2, "height": 2},
        "tile_count": 4, "pixel_variances": variances, "tile_sha256": digests,
        "mbtiles_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "sqlite_integrity_check": "ok", "format": "png", "mocked": False
    }, indent=2), encoding="utf-8")
    print("REAL_E2E_SUCCESS", (out / "evidence.json").read_text())
PY
sha256sum "$OUT/monaco.mbtiles" > "$OUT/mbtiles_sha256.txt"
