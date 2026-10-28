#!/usr/bin/env bash
# Controlled, isolated PostGIS: identical Monaco input for split vs unified flex.
set -euo pipefail
PROJECT="$GITHUB_WORKSPACE/experiments/osm2mbtiles/prototype"
WORK="$RUNNER_TEMP/shared-import-ci"
mkdir -p "$WORK/socket" "$GITHUB_WORKSPACE/shared-import-artifacts"
export PATH="/usr/lib/postgresql/16/bin:$PATH"
export PYTHONPATH="$PROJECT/src"
export PGHOST="$WORK/socket" PGPORT=55473 PGUSER=sharedci PGDATABASE=gis
initdb -D "$WORK/pgdata" -U "$PGUSER" --auth-local=trust --auth-host=trust
pg_ctl -D "$WORK/pgdata" -l "$WORK/pg.log" -w \
  -o "-c listen_addresses='' -c unix_socket_directories=$PGHOST -c port=$PGPORT -c jit=off -c shared_buffers=64MB -c work_mem=4MB -c max_parallel_maintenance_workers=0" start
trap 'pg_ctl -D "$WORK/pgdata" -m immediate -w stop || true; tail -n 80 "$WORK/pg.log" || true' EXIT
curl -fL --retry 3 --connect-timeout 30 --silent --show-error \
 https://download.geofabrik.de/europe/monaco-latest.osm.pbf -o "$WORK/monaco.osm.pbf"
sha256sum "$WORK/monaco.osm.pbf" > "$WORK/input.sha256"
git clone --depth 1 --branch v6.0.0 -q https://github.com/openstreetmap-carto/openstreetmap-carto.git "$WORK/carto"
cd "$WORK/carto"
carto -a 3.0.22 project.mml > project.xml
test -s project.xml
# Our raster style requires an external dataset. Cache upstream downloads on disk
# so the second DB can load *the same* Natural Earth/OSM water polygons.
/usr/bin/python3 - <<'PY'
from pathlib import Path
p=Path('scripts/get-fonts.py');s=p.read_text()
needle='downloadToFile(\n    ["https://mirrors.dotsrc.org/osdn/hanazono-font/'
if needle in s:
    start=s.index(needle);end=s.index('# clean up tmp directories',start)
    p.write_text(s[:start]+'# CI skip unavailable optional Hanazono mirror\n'+s[end:])
PY
/usr/bin/python3 scripts/get-fonts.py
ln -sf /usr/share/fonts/truetype/hanazono/HanaMinA.ttf fonts/HanaMinA.ttf
ln -sf /usr/share/fonts/truetype/hanazono/HanaMinB.ttf fonts/HanaMinB.ttf
fc-cache -f fonts

reset_database() {
 dropdb --if-exists gis
 createdb gis
 psql -X -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION postgis; CREATE EXTENSION hstore;'
}
render_mvt() {
 local name="$1"
 python3 - "$WORK/$name.job.json" "$WORK/$name.vector.mbtiles" "$WORK/monaco.osm.pbf" <<'PY'
import json,sys,pathlib
pathlib.Path(sys.argv[1]).write_text(json.dumps({'pbf':sys.argv[3],'output':sys.argv[2],'bbox':[7.40,43.71,7.46,43.75],'minzoom':12,'maxzoom':15,'processes':2}))
PY
 /usr/bin/python3 "$PROJECT/src/osm2mbtiles/vector_worker.py" "$WORK/$name.job.json"
 /usr/bin/python3 -m osm2mbtiles verify-vector "$WORK/$name.vector.mbtiles"
}
external_carto() {
 local retries=0
 while ! /usr/bin/python3 scripts/get-external-data.py --cache --no-update; do
   retries=$((retries+1));if [[ "$retries" -ge 3 ]]; then return 1; fi
 done
}
snapshot() {
 local name="$1"
 /usr/bin/python3 "$PROJECT/benchmarks/shared_parity.py" record-tables --work "$WORK/$name"
 cp "$WORK/$name/tables.json" "$WORK/$name.tables.json"
}
render_png() {
 local name="$1"
 /usr/bin/python3 "$PROJECT/benchmarks/render_carto_parity.py" --style "$WORK/carto" --out "$WORK/$name.png.mbtiles"
}
cd "$WORK/carto"
reset_database
/usr/bin/time -f 'WALL=%e\nMAX_RSS_KB=%M' -o "$WORK/baseline-carto.time" \
 osm2pgsql --slim --drop --cache=256 --number-processes=1 --disable-parallel-indexing -O flex -S openstreetmap-carto-flex.lua -d gis "$WORK/monaco.osm.pbf"
for sql in indexes.sql functions.sql common-values.sql;do psql -X -v ON_ERROR_STOP=1 -f "$sql";done
/usr/bin/time -f 'WALL=%e\nMAX_RSS_KB=%M' -o "$WORK/baseline-vector.time" \
 osm2pgsql --slim --drop --cache=256 --number-processes=1 --disable-parallel-indexing -O flex -S "$PROJECT/vector/vector-flex.lua" -d gis "$WORK/monaco.osm.pbf"
psql -X -v ON_ERROR_STOP=1 -f "$PROJECT/vector/post-import.sql"
external_carto
snapshot baseline
render_mvt baseline
render_png baseline
# Shared code must handle fresh DB lifecycle and all four SQL postprocessors.
/usr/bin/time -f 'WALL=%e\nMAX_RSS_KB=%M' -o "$WORK/shared-import.time" \
 /usr/bin/python3 - "$PROJECT" "$WORK" <<'PY'
from pathlib import Path
import os,sys
from osm2mbtiles.runtime import LocalDatabase,Runtime
pr=Path(sys.argv[1]);w=Path(sys.argv[2]);r=w/'runtime'
(r/'bin').mkdir(parents=True,exist_ok=True)
for tool in ('psql','createdb','osm2pgsql'):
 from shutil import which
 src=which(tool);target=r/'bin'/tool
 if not target.exists():target.symlink_to(src)
db=LocalDatabase(Runtime(r),w)
db.env=os.environ.copy()
db.import_shared_extract(w/'monaco.osm.pbf',w/'carto',pr/'vector','safe')
PY
external_carto
snapshot shared
render_mvt shared
render_png shared
/usr/bin/python3 "$PROJECT/benchmarks/compare_postgis_modes.py" "$WORK/baseline.vector.mbtiles" "$WORK/shared.vector.mbtiles" --output "$WORK/vector-parity.json"
/usr/bin/python3 "$PROJECT/benchmarks/shared_parity.py" compare --work "$WORK"
python3 - "$WORK" <<'PY'
from pathlib import Path
import json,re,sys
w=Path(sys.argv[1])
def wall(name):return float(re.search('WALL=([0-9.]+)',(w/name).read_text()).group(1))
r={'separate_osm_import_sec':wall('baseline-carto.time')+wall('baseline-vector.time'),
   'single_osm_import_sec':wall('shared-import.time'),
   'vector_parity':json.loads((w/'vector-parity.json').read_text()),
   'carto_png_parity':json.loads((w/'parity.json').read_text())}
print('SHARED_IMPORT_E2E_RESULT',json.dumps(r,ensure_ascii=False))
assert r['vector_parity']['equal']
(w/'results.json').write_text(json.dumps(r,indent=2)+'\n')
PY
cp "$WORK/"*.json "$WORK/"*.time "$WORK/input.sha256" "$GITHUB_WORKSPACE/shared-import-artifacts/"
echo SHARED_IMPORT_REAL_OSM_E2E_SUCCESS
pg_ctl -D "$WORK/pgdata" -m fast -w stop
trap - EXIT