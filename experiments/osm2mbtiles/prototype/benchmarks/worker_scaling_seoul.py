#!/usr/bin/env python3
"""Real Seoul worker scaling: a single shared PostGIS import, 1/2/4/8 tile workers,
Planetiler 1/2/4/8 pipeline threads. Each mode repeats in reversed order.
No network activity; sources/runtime prepared by the Actions workflow.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
WORK = Path(os.environ['SCALING_WORK']).resolve()
STYLE = Path(os.environ['SCALING_STYLE']).resolve()
PBF = Path(os.environ['SCALING_PBF']).resolve()
PLANETILER = Path(os.environ['SCALING_PLANETILER']).resolve()
EVIDENCE = Path(os.environ['SCALING_EVIDENCE']).resolve()
BBOX = (126.95, 37.47, 127.13, 37.62) # 435 planned z12-15 tiles
LO, HI = 12, 15
WORKERS = (1, 2, 4, 8)
REPETITIONS = (WORKERS, tuple(reversed(WORKERS)))


def call_timed(argv, prefix, *, cwd=None, env=None):
    start = time.monotonic()
    timing = EVIDENCE / (prefix + '.time')
    command = ['/usr/bin/time', '-f', 'WALL_SEC=%e\nMAX_RSS_KB=%M\nUSER_CPU_SEC=%U\nSYSTEM_CPU_SEC=%S', '-o', str(timing)] + [str(a) for a in argv]
    completed = subprocess.run(command, cwd=cwd, env=env, text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = EVIDENCE / (prefix + '.log')
    log.write_text(completed.stdout, encoding='utf-8')
    if completed.returncode:
        print(completed.stdout[-12000:], file=sys.stderr, flush=True)
        raise RuntimeError(f'{prefix} failed code={completed.returncode}; see {log}')
    stats = dict(re.findall(r'^(\w+)=([\d.]+)$', timing.read_text(), flags=re.M))
    return {'wall_sec': round(time.monotonic()-start,3),
            'time_wall_sec': float(stats['WALL_SEC']),
            'max_rss_kb': int(stats['MAX_RSS_KB']),
            'user_cpu_sec':float(stats['USER_CPU_SEC']),
            'system_cpu_sec':float(stats['SYSTEM_CPU_SEC'])}


def sqlite_summary(path):
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        tiles = db.execute('SELECT COUNT(*) FROM tiles').fetchone()[0]
        bytes_total = db.execute('SELECT COALESCE(SUM(LENGTH(tile_data)),0) FROM tiles').fetchone()[0]
    return {'tiles':tiles,'tile_payload_bytes':bytes_total,'file_bytes':path.stat().st_size}


def shared_import():
    from osm2mbtiles.runtime import LocalDatabase, Runtime
    binroot = WORK / 'native-bin' / 'bin'
    binroot.mkdir(parents=True, exist_ok=True)
    for tool in ('osm2pgsql','psql','createdb'):
        target=binroot / tool
        if not target.exists(): target.symlink_to(shutil.which(tool))
    db=LocalDatabase(Runtime(binroot.parent), WORK/'db-controller')
    db.work.mkdir(parents=True,exist_ok=True)
    db.env.update({k:v for k,v in os.environ.items() if k.startswith('PG')})
    t=time.monotonic()
    db.import_shared_extract(PBF, STYLE, ROOT/'vector', 'safe')
    return {'seconds':round(time.monotonic()-t,3),'profile':'safe',
            'osm2pgsql_processes':1,'indexing':'sequential'}


def run():
    WORK.mkdir(parents=True,exist_ok=True)
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    assert PBF.is_file() and PLANETILER.is_file()
    env=os.environ.copy()
    env['OSM2MBTILES_VECTOR_QUERY_MODE']='projected'
    print('SCALING_SYSTEM',json.dumps({'cpu_count':os.cpu_count(),
          'nproc':subprocess.check_output(['nproc'],text=True).strip(),
          'bbox':BBOX,'zoom':[LO,HI],'worker_counts':WORKERS}),flush=True)
    print('SCALING_SHARED_IMPORT_START',flush=True)
    imp=shared_import()
    print('SCALING_SHARED_IMPORT',json.dumps(imp),flush=True)
    results={'input_sha256':hashlib.sha256(PBF.read_bytes()).hexdigest(),
             'bbox':BBOX,'zoom':[LO,HI],'postgis_import':imp,
             'system':{'logical_cpu':os.cpu_count(),
                       'nproc':int(subprocess.check_output(['nproc'],text=True))},
             'postgis':[],'planetiler':[]}
    # Separate runs; SQL plans and SQLite writes are identical for every worker count.
    # Reversed second pass mitigates OS cache + early JVM JIT warming bias.
    for repeat, order in enumerate(REPETITIONS, 1):
        for workers in order:
            label=f'postgis_r{repeat}_w{workers}'
            out=WORK/f'{label}.mbtiles'
            job=WORK/f'{label}.json'
            job.write_text(json.dumps({'pbf':str(PBF),'output':str(out),
                         'bbox':BBOX,'minzoom':LO,'maxzoom':HI,'processes':workers}))
            stats=call_timed([sys.executable,ROOT/'src/osm2mbtiles/vector_worker.py',job],label,env=env)
            stats.update(sqlite_summary(out))
            stats.update({'repeat':repeat,'workers':workers})
            results['postgis'].append(stats)
            print('SCALING_POSTGIS',json.dumps(stats),flush=True)
            from compare_postgis_modes import compare
            baseline=WORK/'postgis_r1_w1.mbtiles'
            if out != baseline:
                parity=compare(baseline,out)
                if not parity['equal']:
                    raise AssertionError(f'PostGIS semantic mismatch {label}: {parity}')
                stats['semantic_equal']=True
            else:
                stats['semantic_equal']=True
            # Keep all outputs for parity auditing; CI artifacts upload metrics only.
        for workers in order:
            label=f'planetiler_r{repeat}_w{workers}'
            out=WORK/f'{label}.mbtiles'
            argv=['java','-Xmx3g','-jar',str(PLANETILER),'generate-custom',
                  '--schema='+str(ROOT/'benchmarks/seoul-planetiler.yml'),
                  '--output='+str(out),'--bounds='+','.join(map(str,BBOX)),
                  '--minzoom='+str(LO),'--maxzoom='+str(HI),
                  '--threads='+str(workers),'--force']
            stats=call_timed(argv,label,cwd=WORK)
            stats.update(sqlite_summary(out))
            stats.update({'repeat':repeat,'workers':workers})
            results['planetiler'].append(stats)
            print('SCALING_PLANETILER',json.dumps(stats),flush=True)
        (EVIDENCE/'worker_scaling_partial.json').write_text(json.dumps(results,indent=2)+'\n')
    (EVIDENCE/'worker_scaling.json').write_text(json.dumps(results,indent=2)+'\n')
    with (EVIDENCE/'summary.md').open('w') as f:
        f.write('# Seoul PostGIS SQL/MVT worker scaling vs Planetiler\n\n')
        f.write(f"Source SHA256: `{results['input_sha256']}`. CPU count: {results['system']['nproc']} (nproc), PostGIS safe shared import: {imp['seconds']}s.\n\n")
        f.write('| Engine | Pass | Workers/threads | Wall seconds | RSS KiB (client only) | Tiles |\n|---|---:|---:|---:|---:|---:|\n')
        for engine in ('postgis','planetiler'):
            for t in results[engine]:
                f.write(f"| {engine} | {t['repeat']} | {t['workers']} | {t['time_wall_sec']:.2f} | {t['max_rss_kb']} | {t['tiles']} |\n")
        f.write('\nNotes: PostGIS measurements exclude import; Planetiler measurements include its full OSM-to-MBTiles pipeline.\n')
        f.write('Planetiler custom schema differs from PostGIS layers/features. RSS does NOT include postgres server.\n')
        f.write('8 workers on 4-vCPU runner tests oversubscription, not extra available CPU cores.\n')
        f.write('All PostGIS outputs must have identical decoded MVT geometry, properties and multiplicity.\n')
    print('SCALING_ALL_PARITY_AND_PERFORMANCE_PASS',flush=True)


if __name__=='__main__':
    run()