#!/usr/bin/env python3
"""Strong semantic parity checks for separate versus single-pass osm2pgsql imports."""
import argparse, hashlib, json, sqlite3, gzip, io
from pathlib import Path


def fingerprint_tables():
    import psycopg2
    conn=psycopg2.connect(dbname='gis')
    names=[]; digests={}; counts={}
    with conn.cursor() as cur:
        cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'planet_osm_%' OR tablename LIKE 'vector_%') ORDER BY 1")
        names=[row[0] for row in cur.fetchall() if row[0] not in ('planet_osm_nodes','planet_osm_ways','planet_osm_rels')]
        for table in names:
            # Include data, types represented in Postgres JSON form, and duplicate multiplicities.
            # ORDER BY ensures stable hashing across different inserter thread orders.
            cur.execute(f'SELECT to_jsonb(t)::text FROM "{table}" t ORDER BY to_jsonb(t)::text')
            h=hashlib.sha256(); n=0
            for (row,) in cur:
                h.update(row.encode('utf-8'));h.update(b'\n');n+=1
            digests[table]=h.hexdigest();counts[table]=n
    conn.close()
    assert names, 'no Carto or vector tables'
    return {'tables':digests,'row_counts':counts}


def png_pixels(path):
    from PIL import Image
    out={}
    with sqlite3.connect(path) as c:
        for z,x,y,blob in c.execute('SELECT zoom_level,tile_column,tile_row,tile_data FROM tiles'):
            im=Image.open(io.BytesIO(blob)).convert('RGBA')
            out[f'{z}/{x}/{y}']=hashlib.sha256(im.tobytes()).hexdigest()
    assert out, 'no PNG tiles produced'
    return out


def main():
    p=argparse.ArgumentParser()
    p.add_argument('action',choices=['record-tables','compare'])
    p.add_argument('--work',type=Path,required=True)
    p.add_argument('--skip-png',action='store_true',help='Compare full Carto/Vector DB tables without rendering (fast import smoke)')
    a=p.parse_args();a.work.mkdir(parents=True,exist_ok=True)
    if a.action=='record-tables':
        (a.work/'tables.json').write_text(json.dumps(fingerprint_tables(),indent=2))
    else:
        baseline=json.loads((a.work/'baseline.tables.json').read_text())
        shared=json.loads((a.work/'shared.tables.json').read_text())
        names0=set(baseline['tables']);names1=set(shared['tables'])
        if names0 != names1:
            raise AssertionError(f'table name differences: baseline-only={names0-names1}, shared-only={names1-names0}')
        changes={k:{'baseline_rows':baseline['row_counts'][k],'shared_rows':shared['row_counts'][k]} for k in baseline['tables'] if baseline['tables'][k]!=shared['tables'][k]}
        png0={} if a.skip_png else png_pixels(a.work/'baseline.png.mbtiles')
        png1={} if a.skip_png else png_pixels(a.work/'shared.png.mbtiles')
        report={'table_count':len(names0),'changed_tables':changes,'png_tiles':len(png0),'different_png_tiles':sorted(k for k in png0.keys()|png1.keys() if png0.get(k)!=png1.get(k))}
        (a.work/'parity.json').write_text(json.dumps(report,indent=2))
        print('SHARED_IMPORT_CARTO_PNG_PARITY',json.dumps(report))
        if changes or report['different_png_tiles']:
            raise AssertionError('Shared import changed the stored Carto/vector data or actual PNG pixels')
        print('SHARED_IMPORT_CARTO_PNG_PARITY_SUCCESS')

if __name__=='__main__':main()