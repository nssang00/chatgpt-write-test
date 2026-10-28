#!/usr/bin/env python3
"""Compare independent Carto+vector imports with one-pass combined import.

Runs on a real, private PostgreSQL/PostGIS instance in GitHub Actions. No mocks.
Times exclude input download, apt/npm install, and tile validation/export.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from osm2mbtiles.runtime import Runtime, LocalDatabase, run
from osm2mbtiles.vector import verify

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compare_postgis_modes import compare as compare_vector

CARTO_TABLES = ('planet_osm_point','planet_osm_line','planet_osm_roads','planet_osm_polygon')
VECTOR_TABLES = ('vector_points','vector_lines','vector_areas','vector_relations','vector_label_points')


def table_snapshot(db, sample_limit=0):
    import psycopg2
    conn=psycopg2.connect(dbname='gis',host=db.env['PGHOST'],port=db.env['PGPORT'],
                          user=db.env['PGUSER'],password=db.env['PGPASSWORD'])
    result={}
    with conn:
      with conn.cursor() as cur:
        for table in CARTO_TABLES + VECTOR_TABLES:
          # Monaco: full row hash; Seoul: choose deterministic first N IDs,
          # plus whole-table row count to avoid expensive multi-minute hashing.
          # The FULL MVT tile payload is always checked, independently.
          if sample_limit:
            id_col = {'vector_points':'node_id','vector_lines':'way_id',
                      'vector_areas':'area_id','vector_relations':'relation_id',
                      'vector_label_points':'osm_id'}.get(table,'osm_id')
            cur.execute(f'SELECT COUNT(*) FROM {table}')
            count = cur.fetchone()[0]
            cur.execute(f'''SELECT md5(COALESCE(string_agg(h, '' ORDER BY h),''))
                            FROM (SELECT md5(to_jsonb(t)::text) AS h FROM
                             (SELECT * FROM {table} ORDER BY {id_col} LIMIT %s) t) q''',
                        (sample_limit,))
            digest = cur.fetchone()[0]
          else:
            cur.execute(f'''SELECT COUNT(*),md5(COALESCE(string_agg(h, '' ORDER BY h),''))
                           FROM (SELECT md5(to_jsonb(t)::text) AS h
                                 FROM {table} t) q''')
            count,digest=cur.fetchone()
          result[table]={'rows':count,'hash':digest}
    conn.close()
    return result


def render_vector(db,pbf,out,bbox,lo,hi):
    worker=Path(__file__).resolve().parents[1]/'src/osm2mbtiles/vector_worker.py'
    job=out.with_suffix('.job.json')
    job.write_text(json.dumps({'pbf':str(pbf),'output':str(out),'bbox':bbox,
               'minzoom':lo,'maxzoom':hi,'processes':2}))
    env=db.env.copy();env['PYTHONPATH']=str(worker.parents[1]);env['OSM2MBTILES_VECTOR_QUERY_MODE']='projected'
    run([sys.executable,worker,job],env=env)
    verified=verify(out)
    assert verified['integrity']=='ok',verified
    return {'bytes':out.stat().st_size,'tiles':verified['tiles']}


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--pbf',type=Path,required=True)
    p.add_argument('--carto',type=Path,required=True)
    p.add_argument('--runtime',type=Path,required=True)
    p.add_argument('--vector',type=Path,required=True)
    p.add_argument('--work',type=Path,required=True)
    p.add_argument('--bbox',required=True)
    p.add_argument('--zoom',default='12-15')
    p.add_argument('--profile',choices=('safe','fast'),default='safe')
    p.add_argument('--sequence',default='split,common,common,split')
    p.add_argument('--snapshot-limit',type=int,default=0,help='0=full-table hashes; N=first N IDs + all row counts')
    args=p.parse_args()
    args.work.mkdir(exist_ok=True,parents=True)
    bbox=[float(x) for x in args.bbox.split(',')]
    lo,hi=(int(x) for x in args.zoom.split('-'))
    sequence=args.sequence.split(',')
    assert all(x in ('split','common') for x in sequence)
    input_sha=hashlib.sha256(args.pbf.read_bytes()).hexdigest()
    report={'input':str(args.pbf),'input_size':args.pbf.stat().st_size,
            'input_sha256':input_sha,'bbox':bbox,'zoom':args.zoom,'profile':args.profile,
            'excludes':'downloads, dependencies, PostgreSQL startup, rendered PNG, vector export and validation',
            'snapshot_limit':args.snapshot_limit,'runs':[]}
    first_snapshot=None
    first_vec=None
    with LocalDatabase(Runtime(args.runtime),args.work/'pg') as db:
      for i,mode in enumerate(sequence):
        start=time.perf_counter()
        if mode=='split':
          db.import_extract(args.pbf,args.carto)
          carto_end=time.perf_counter()
          db.import_vector_extract(args.pbf,args.vector,args.profile)
          elapsed=time.perf_counter()-start
          segments={'carto_import_s':round(carto_end-start,3),
                    'vector_import_s':round(elapsed-(carto_end-start),3)}
        else:
          db.import_both_extract(args.pbf,args.carto,args.vector,args.profile)
          elapsed=time.perf_counter()-start
          segments={}
        snapshot=table_snapshot(db,args.snapshot_limit)
        for t in CARTO_TABLES+VECTOR_TABLES:
          if snapshot[t]['rows']==0 and t in ('planet_osm_line','planet_osm_polygon','vector_lines','vector_areas'):
            raise AssertionError(f'Empty required table: {t}')
        if first_snapshot is None:
          first_snapshot=snapshot
        assert snapshot==first_snapshot, {k:(first_snapshot.get(k),v) for k,v in snapshot.items() if v!=first_snapshot.get(k)}
        vecout=args.work/f'vector-{i}-{mode}.mbtiles'
        out=render_vector(db,args.pbf,vecout,bbox,lo,hi)
        parity=compare_vector(first_vec,vecout) if first_vec else None
        if first_vec is None:first_vec=vecout
        else:assert parity['equal'],parity
        row={'kind':mode,'import_total_s':round(elapsed,3),'segments':segments,
             'carto_vector_rows_equal':True,'mvt_semantic_equal':parity['equal'] if parity else True,
             'mvt_feature_count':parity['features'] if parity else None,**out}
        report['runs'].append(row)
        print('COMMON_IMPORT_CASE',json.dumps(row,sort_keys=True),flush=True)
    from statistics import median
    report['median_split_s']=round(median(r['import_total_s'] for r in report['runs'] if r['kind']=='split'),3)
    report['median_common_s']=round(median(r['import_total_s'] for r in report['runs'] if r['kind']=='common'),3)
    report['saved_s']=round(report['median_split_s']-report['median_common_s'],3)
    report['speedup']=round(report['median_split_s']/report['median_common_s'],3)
    report['reference_tables']=first_snapshot
    (args.work/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('COMMON_IMPORT_SUCCESS',json.dumps({k:report[k] for k in ('median_split_s','median_common_s','saved_s','speedup')},sort_keys=True))

if __name__=='__main__':
    main()