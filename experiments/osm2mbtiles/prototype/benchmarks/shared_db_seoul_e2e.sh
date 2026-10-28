#!/usr/bin/env bash
# Real Seoul: compare split Carto/vector flex against ONE shared OSM import.
set -euo pipefail
PROJECT="$GITHUB_WORKSPACE/experiments/osm2mbtiles/prototype"
WORK="$RUNNER_TEMP/shared-seoul"
mkdir -p "$WORK/socket" "$GITHUB_WORKSPACE/shared-seoul-artifacts"
export PATH="/usr/lib/postgresql/16/bin:$PATH"
export PYTHONPATH="$PROJECT/src" PGHOST="$WORK/socket" PGPORT=55477 PGUSER=sharedseoul PGDATABASE=gis
initdb -D "$WORK/pgdata" -U "$PGUSER" --auth-local=trust --auth-host=trust
pg_ctl -D "$WORK/pgdata" -l "$WORK/pg.log" -w -o "-c listen_addresses='' -c unix_socket_directories=$PGHOST -c port=$PGPORT -c shared_buffers=64MB -c work_mem=4MB -c max_parallel_maintenance_workers=0" start
trap 'pg_ctl -D "$WORK/pgdata" -m immediate -w stop || true; tail -n 50 "$WORK/pg.log" || true' EXIT
curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 180 https://tiles.osm.kr/download/seoul-non-military.osm.pbf -o "$WORK/seoul.osm.pbf"
sha256sum "$WORK/seoul.osm.pbf" > "$WORK/input.sha256"
git clone --depth 1 --branch v6.0.0 -q https://github.com/openstreetmap-carto/openstreetmap-carto.git "$WORK/carto"
cd "$WORK/carto"
reset_db(){ dropdb --if-exists gis; createdb gis; psql -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION postgis; CREATE EXTENSION hstore;'; }
render_mvt(){
 local name="$1"
 /usr/bin/python3 - "$WORK/$name.job.json" "$WORK/$name.vector.mbtiles" "$WORK/seoul.osm.pbf" <<'PY'
import json,sys,pathlib
pathlib.Path(sys.argv[1]).write_text(json.dumps({'pbf':sys.argv[3],'output':sys.argv[2],'bbox':[127.015,37.485,127.075,37.535],'minzoom':12,'maxzoom':15,'processes':2}))
PY
 /usr/bin/python3 "$PROJECT/src/osm2mbtiles/vector_worker.py" "$WORK/$name.job.json"
}
snapshot(){ local name="$1"; /usr/bin/python3 "$PROJECT/benchmarks/shared_parity.py" record-tables --work "$WORK/$name"; cp "$WORK/$name/tables.json" "$WORK/$name.tables.json"; }
reset_db
/usr/bin/time -f 'WALL=%e\nMAX_RSS_KB=%M' -o "$WORK/separate-carto.time" osm2pgsql --slim --drop --cache=256 --number-processes=1 --disable-parallel-indexing -O flex -S openstreetmap-carto-flex.lua -d gis "$WORK/seoul.osm.pbf"
for sql in indexes.sql functions.sql common-values.sql;do psql -v ON_ERROR_STOP=1 -f "$sql" >/dev/null;done
/usr/bin/time -f 'WALL=%e\nMAX_RSS_KB=%M' -o "$WORK/separate-vector.time" osm2pgsql --slim --drop --cache=256 --number-processes=1 --disable-parallel-indexing -O flex -S "$PROJECT/vector/vector-flex.lua" -d gis "$WORK/seoul.osm.pbf"
psql -v ON_ERROR_STOP=1 -f "$PROJECT/vector/post-import.sql" >/dev/null
snapshot baseline
render_mvt baseline
/usr/bin/time -f 'WALL=%e\nMAX_RSS_KB=%M' -o "$WORK/shared-safe.time" /usr/bin/python3 - "$PROJECT" "$WORK" safe <<'PY'
from pathlib import Path
import os,sys,shutil
from osm2mbtiles.runtime import LocalDatabase,Runtime
pr=Path(sys.argv[1]);w=Path(sys.argv[2]);profile=sys.argv[3];r=w/'runtime';(r/'bin').mkdir(parents=True,exist_ok=True)
for name in ('psql','createdb','osm2pgsql'):
 dst=r/'bin'/name
 if not dst.exists():dst.symlink_to(shutil.which(name))
db=LocalDatabase(Runtime(r),w);db.env=os.environ.copy()
db.import_shared_extract(w/'seoul.osm.pbf',w/'carto',pr/'vector',profile)
PY
snapshot shared
render_mvt shared
/usr/bin/python3 "$PROJECT/benchmarks/compare_postgis_modes.py" "$WORK/baseline.vector.mbtiles" "$WORK/shared.vector.mbtiles" --output "$WORK/vector-parity.json"
/usr/bin/python3 "$PROJECT/benchmarks/shared_parity.py" compare --work "$WORK" --skip-png
/usr/bin/python3 - "$WORK" <<'PY'
import json,re,sys,pathlib
w=pathlib.Path(sys.argv[1]);seconds=lambda p:float(re.search(r'WALL=([0-9.]+)',(w/p).read_text()).group(1))
a=seconds('separate-carto.time');b=seconds('separate-vector.time');c=seconds('shared-safe.time')
report={'input_bytes':(w/'seoul.osm.pbf').stat().st_size,'separate_import_sec':a+b,'carto_import_sec':a,'vector_import_sec':b,'shared_import_sec':c,'shared_vs_separate_ratio':round(c/(a+b),4),'mvt':json.loads((w/'vector-parity.json').read_text()),'tables':json.loads((w/'parity.json').read_text())}
assert report['mvt']['equal'] and not report['tables']['changed_tables']
(w/'results.json').write_text(json.dumps(report,indent=2))
print('SEOUL_SHARED_IMPORT_PARITY_SUCCESS',json.dumps(report))
PY
cp "$WORK/"*.json "$WORK/"*.time "$WORK/input.sha256" "$GITHUB_WORKSPACE/shared-seoul-artifacts/"
pg_ctl -D "$WORK/pgdata" -m fast -w stop
trap - EXIT