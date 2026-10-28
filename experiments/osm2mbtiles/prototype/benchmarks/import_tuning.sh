#!/usr/bin/env bash
# CI-only, isolated PostgreSQL benchmark. Never touches user databases.
set -euo pipefail
PROJECT="$GITHUB_WORKSPACE/experiments/osm2mbtiles/prototype"
WORK="$RUNNER_TEMP/import-tune"
mkdir -p "$WORK/socket"
export PGHOST="$WORK/socket" PGPORT=55449 PGUSER=tuneosm PGDATABASE=gis
export PYTHONPATH="$PROJECT/src" OSM2MBTILES_VECTOR_QUERY_MODE=projected
export PATH="/usr/lib/postgresql/16/bin:$PATH"
initdb -D "$WORK/pgdata" -U "$PGUSER" --auth-local=trust --auth-host=trust
pg_ctl -D "$WORK/pgdata" -l "$WORK/pg.log" -w \
 -o "-c listen_addresses='' -c unix_socket_directories=$PGHOST -c port=$PGPORT -c shared_buffers=64MB -c work_mem=4MB -c maintenance_work_mem=64MB -c max_parallel_maintenance_workers=0" start
trap 'pg_ctl -D "$WORK/pgdata" -m fast -w stop || true' EXIT
curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 180 \
 https://tiles.osm.kr/download/seoul-non-military.osm.pbf -o "$WORK/seoul.osm.pbf"
sha256sum "$WORK/seoul.osm.pbf" | tee "$WORK/input.sha256"
python3 - "$PROJECT/vector/vector-flex.lua" "$WORK/vector-no-cluster.lua" <<'PY'
import pathlib,sys
s=pathlib.Path(sys.argv[1]).read_text()
assert s.count('\n})\n')>=4,'Unexpected flex Lua table format'
s=s.replace('\n})\n', '\n}, { cluster = "no" })\n',4)
pathlib.Path(sys.argv[2]).write_text(s)
PY
variants=(baseline threads2 parallelidx2 nocluster2 nocluster4)
if [[ "${TUNING_ORDER:-}" == reverse ]]; then
  variants=(baseline nocluster4 parallelidx2 threads2 nocluster2)
fi
for variant in "${variants[@]}"; do
  echo "::group::IMPORT_TUNING $variant"
  dropdb --if-exists gis
  createdb gis
  psql -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION postgis; CREATE EXTENSION hstore;'
  workers=1
  style="$PROJECT/vector/vector-flex.lua"
  options=(--disable-parallel-indexing)
  case "$variant" in
    baseline) ;;
    threads2) workers=2 ;;
    parallelidx2) workers=2; options=() ;;
    nocluster2) workers=2; options=(); style="$WORK/vector-no-cluster.lua" ;;
    nocluster4) workers=4; options=(); style="$WORK/vector-no-cluster.lua" ;;
  esac
  /usr/bin/time -f 'WALL=%e\nRSS_KB=%M' -o "$WORK/$variant.import.time" \
    osm2pgsql --slim --drop --cache=256 --number-processes="$workers" \
       "${options[@]}" -O flex -S "$style" -d gis "$WORK/seoul.osm.pbf"
  /usr/bin/time -f 'WALL=%e\nRSS_KB=%M' -o "$WORK/$variant.post.time" \
    psql -v ON_ERROR_STOP=1 -f "$PROJECT/vector/post-import.sql"
  python3 - "$WORK/$variant.job.json" "$WORK/$variant.mbtiles" "$WORK/seoul.osm.pbf" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'pbf':sys.argv[3],'output':sys.argv[2],
 'bbox':[127.015,37.485,127.075,37.535],'minzoom':12,'maxzoom':15,'processes':2}))
PY
  /usr/bin/time -f 'WALL=%e\nRSS_KB=%M' -o "$WORK/$variant.tiles.time" \
    /usr/bin/python3 "$PROJECT/src/osm2mbtiles/vector_worker.py" "$WORK/$variant.job.json"
  /usr/bin/python3 -m osm2mbtiles verify-vector "$WORK/$variant.mbtiles"
  if [[ "$variant" != baseline ]]; then
    /usr/bin/python3 "$PROJECT/benchmarks/compare_postgis_modes.py" \
      "$WORK/baseline.mbtiles" "$WORK/$variant.mbtiles" \
      --output "$WORK/$variant.parity.json"
  fi
  echo '::endgroup::'
done
python3 - "$WORK" "$GITHUB_WORKSPACE/import-tuning-artifacts" <<'PY'
import json,sys,re,pathlib
w=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);out.mkdir(exist_ok=True)
variants=['baseline','threads2','parallelidx2','nocluster2','nocluster4']
result={}
def wall(v,p):
    m=re.search(r'WALL=([0-9.]+)',(w/f'{v}.{p}.time').read_text())
    assert m,(v,p)
    return float(m.group(1))
def rss(v,p):
    m=re.search(r'RSS_KB=([0-9.]+)',(w/f'{v}.{p}.time').read_text())
    assert m,(v,p)
    return int(float(m.group(1)))
for v in variants:
    a=wall(v,'import');b=wall(v,'post');c=wall(v,'tiles')
    parity=json.loads((w/f'{v}.parity.json').read_text()) if v!='baseline' else {}
    result[v]={'import_sec':a,'post_sec':b,'tile_sec':c,'total_sec':round(a+b+c,2),
               'mvt_semantic_equal':parity.get('equal',True),
               'mismatch_tiles':parity.get('different_tiles',0),
               'osm2pgsql_max_rss_kb':rss(v,'import')}
assert all(x['mvt_semantic_equal'] for x in result.values()),result
(out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
(out/'input.sha256').write_text((w/'input.sha256').read_text())
with (out/'summary.md').open('w') as f:
    f.write('| Mode | Import (s) | Postprocessing (s) | Tile encoding (s) | Total (s) | Same MVT |\n|---|---:|---:|---:|---:|---|\n')
    for v,x in result.items():
        f.write(f"| {v} | {x['import_sec']} | {x['post_sec']} | {x['tile_sec']} | {x['total_sec']} | {x['mvt_semantic_equal']} |\n")
print('IMPORT_TUNING_RESULTS',json.dumps(result,sort_keys=True))
PY
cat "$GITHUB_WORKSPACE/import-tuning-artifacts/summary.md" >> "$GITHUB_STEP_SUMMARY"
echo IMPORT_TUNING_SUCCESS