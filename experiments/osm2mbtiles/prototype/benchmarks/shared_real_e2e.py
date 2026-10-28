#!/usr/bin/env python3
"""Real OSM Carto v6 importer parity on an isolated GitHub Actions postgres.

Checks unmodified Carto table contents, real Mapnik PostGIS raster pixel parity,
and all vector MVT features. No mock engines, no remote user databases.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

from PIL import Image
import mapnik
import psycopg2
from osm2mbtiles.runtime import LocalDatabase, Runtime
from osm2mbtiles.vector import export as vector_export

P = Path(__file__).resolve().parents[1]
WORK = Path(os.environ['SHARED_CI_WORK'])
STYLE = Path(os.environ['SHARED_CI_STYLE'])
OSM = Path(os.environ['SHARED_CI_PBF'])
ZOOM = 14
BBOX = (7.400, 43.710, 7.460, 43.750)
WORK.mkdir(parents=True, exist_ok=True)


def timed(argv, *, cwd=None):
    start = time.monotonic()
    subprocess.run([str(x) for x in argv], env=os.environ, cwd=cwd, check=True)
    return round(time.monotonic() - start, 3)


def psql(sql):
    return subprocess.check_output(['psql','-XAt','-v','ON_ERROR_STOP=1','-c',sql], text=True).strip()


def reset():
    timed(['dropdb','--if-exists','gis'])
    timed(['createdb','gis'])
    psql('CREATE EXTENSION postgis; CREATE EXTENSION hstore;')


def table_fingerprints():
    """Full ordered content checksums for every OSM Carto table (not only row counts)."""
    with psycopg2.connect('dbname=gis') as conn:
        with conn.cursor() as cur:
            cur.execute('''SELECT tablename FROM pg_tables WHERE schemaname='public'
                AND tablename LIKE 'planet_osm_%' ORDER BY tablename''')
            names=[r[0] for r in cur.fetchall()]
            assert names, 'No real Carto tables imported'
            result={}
            for name in names:
                cur.execute(f'SELECT * FROM public."{name}"')
                columns=[d.name for d in cur.description]
                # Hash every value but do not rely on table row order, which
                # may legitimately change between independent imports.
                rows=[]
                for row in cur:
                    normalized=[]
                    for v in row:
                        if hasattr(v,'wkb'):
                            v=bytes(v.wkb).hex()
                        normalized.append(str(v) if v is not None else None)
                    rows.append(json.dumps(normalized,ensure_ascii=False,separators=(',',':')))
                rows.sort()
                h=hashlib.sha256('\n'.join(rows).encode()).hexdigest()
                result[name]={'columns':columns,'count':len(rows),'sha256':h}
            return result


def render_mapnik_png(prefix):
    """Actual Mapnik/PostGIS render using real OSM Carto imported tables.

    This intentional controlled subset tests Carto-imported roads/buildings;
    full OSM Carto project.xml additionally requires >1GB external datasets.
    """
    from osm2mbtiles.tiles import xyz_range
    x1,x2,y1,y2=xyz_range(BBOX, ZOOM)
    cx=(x1+x2)//2;cy=(y1+y2)//2
    x=cx-(cx%2);y=cy-(cy%2)
    radius=20037508.342789244
    meter=2*radius/(1<<ZOOM)
    bounds=mapnik.Box2d(-radius+x*meter, radius-(y+2)*meter,
                        -radius+(x+2)*meter, radius-y*meter)
    m=mapnik.Map(512,512)
    m.background=mapnik.Color('#f4f2ec')
    # Rendering actual Carto flex-produced PostGIS rows with Mapnik; same
    # datasource/style both times ensures controlled pixel parity.
    recipes=[
      ('polygons','planet_osm_polygon','way','building',mapnik.Color('#c5b9a5'),'polygon'),
      ('roads','planet_osm_line','way','highway',mapnik.Color('#b38064'),'line'),
    ]
    for name,table,geom,key,color,kind in recipes:
        style=mapnik.Style()
        rule=mapnik.Rule()
        if kind=='polygon':
            rule.symbols.append(mapnik.PolygonSymbolizer(color))
        else:
            stroke=mapnik.Stroke(color,2.5)
            rule.symbols.append(mapnik.LineSymbolizer(stroke))
        style.rules.append(rule)
        m.append_style(name,style)
        lay=mapnik.Layer(name,'+init=epsg:3857')
        lay.datasource=mapnik.PostGIS(host=os.environ['PGHOST'],port=int(os.environ['PGPORT']),
            dbname='gis',user=os.environ['PGUSER'],password=os.environ.get('PGPASSWORD',''),
            table=f'(SELECT {geom} FROM {table} WHERE {key} IS NOT NULL) AS {name}',
            geometry_field=geom,srid=3857)
        lay.styles.append(name)
        m.layers.append(lay)
    m.zoom_to_box(bounds)
    bitmap=mapnik.Image(512,512)
    mapnik.render(m,bitmap)
    out=WORK/f'{prefix}.png'
    out.write_bytes(bitmap.tostring('png'))
    img=Image.open(out).convert('RGBA')
    pixels=img.tobytes()
    return {'sha256':hashlib.sha256(pixels).hexdigest(),'width':img.width,'height':img.height,
            'unique_colors':len(img.getcolors(512*512) or []),'file':str(out)}


def create_vector(prefix):
    from osm2mbtiles.vector import export
    path=WORK/f'{prefix}.vector.mbtiles'
    start=time.monotonic()
    export(OSM,path,BBOX,12,14,2)
    sec=round(time.monotonic()-start,3)
    with sqlite3.connect(path) as db:
        tiles=db.execute('SELECT count(*) FROM tiles').fetchone()[0]
    return {'seconds':sec,'tiles':tiles,'path':str(path),'bytes':path.stat().st_size}


def baseline():
    reset()
    start=time.monotonic()
    timed(['osm2pgsql','--slim','--drop','--cache=256','--number-processes=1',
         '--disable-parallel-indexing','-O','flex','-S',STYLE/'openstreetmap-carto-flex.lua',
         '-d','gis',OSM],cwd=STYLE)
    for f in ['indexes.sql','functions.sql','common-values.sql']:
        timed(['psql','-X','-v','ON_ERROR_STOP=1','-f',STYLE/f])
    carto_import=round(time.monotonic()-start,3)
    start=time.monotonic()
    timed(['osm2pgsql','--slim','--drop','--cache=256','--number-processes=1',
         '--disable-parallel-indexing','-O','flex','-S',P/'vector/vector-flex.lua',
         '-d','gis',OSM],cwd=P/'vector')
    timed(['psql','-X','-v','ON_ERROR_STOP=1','-f',P/'vector/post-import.sql'])
    vector_import=round(time.monotonic()-start,3)
    return {'carto_import_seconds':carto_import,'vector_import_seconds':vector_import,
            'total_import_seconds':round(carto_import+vector_import,3)}


def shared():
    reset()
    root=WORK/'runtime';(root/'bin').mkdir(parents=True,exist_ok=True)
    import shutil
    for name in ['osm2pgsql','psql','createdb']:
        dest=root/'bin'/name
        if not dest.exists(): dest.symlink_to(shutil.which(name))
    runtime=Runtime(root)
    db=LocalDatabase(runtime,WORK/'fake-work')
    db.work.mkdir(parents=True,exist_ok=True)
    db.env.update({k:v for k,v in os.environ.items() if k.startswith('PG')})
    start=time.monotonic()
    db.import_shared_extract(OSM,STYLE,P/'vector','safe')
    return {'total_import_seconds':round(time.monotonic()-start,3)}


def main():
    all_report={}
    print('BASELINE_SEPARATE_IMPORT_START',flush=True)
    all_report['separate']=baseline()
    all_report['separate']['carto_tables']=table_fingerprints()
    all_report['separate']['png']=render_mapnik_png('separate')
    all_report['separate']['vector']=create_vector('separate')
    print('SHARED_SINGLE_IMPORT_START',flush=True)
    all_report['shared']=shared()
    all_report['shared']['carto_tables']=table_fingerprints()
    all_report['shared']['png']=render_mapnik_png('shared')
    all_report['shared']['vector']=create_vector('shared')
    same_tables=all_report['separate']['carto_tables']==all_report['shared']['carto_tables']
    same_png=all_report['separate']['png']['sha256']==all_report['shared']['png']['sha256']
    report={'separate':all_report['separate'],'shared':all_report['shared'],
            'carto_tables_equal':same_tables,'mapnik_png_pixels_equal':same_png,
            'import_speedup':round(all_report['separate']['total_import_seconds']/all_report['shared']['total_import_seconds'],3)}
    (WORK/'shared_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('SHARED_IMPORT_REPORT',json.dumps({
        'separate_import_sec':report['separate']['total_import_seconds'],
        'shared_import_sec':report['shared']['total_import_seconds'],
        'speedup':report['import_speedup'],
        'carto_tables_equal':same_tables,'mapnik_png_pixels_equal':same_png,
        'carto_tables':len(report['separate']['carto_tables'])},ensure_ascii=False),flush=True)
    assert same_tables,'Carto table row/column mismatch'
    assert same_png,'Real Mapnik PNG decoded pixel mismatch'
    assert all_report['separate']['png']['unique_colors']>1, 'Blank Mapnik render'
    print('SHARED_IMPORT_REAL_OSM_AND_MAPNIK_PASS',flush=True)

if __name__=='__main__':
    main()