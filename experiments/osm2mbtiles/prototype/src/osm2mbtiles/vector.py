"""Detailed OSM PBF vector MBTiles via osm2pgsql flex JSONB -> PostGIS MVT.

Workers only SELECT from PostgreSQL; the parent is the only SQLite writer.
Uses MVT TileEnvelope(XYZ) and flips y only at the MBTiles boundary (TMS).
"""
from __future__ import annotations

import gzip
import json
import multiprocessing
import os
import sqlite3
import sys
import time
from pathlib import Path

from .tiles import xyz_range, tile_count

EXTENT = 4096
BUFFER = 64
# Explicit public field schema. High zoom preserves detailed OSM attributes,
# low zoom uses a lightweight subset but retains class, name, ref and osm_id.
COMMON = ('name', 'name:ko', 'name:en', 'name:ja', 'name:zh', 'ref',
          'alt_name', 'short_name', 'official_name', 'int_name', 'wikidata')
DETAILS = ('highway', 'foot', 'bicycle', 'horse', 'access', 'motor_vehicle',
           'oneway', 'maxspeed', 'lanes', 'surface', 'smoothness', 'width',
           'bridge', 'tunnel', 'layer', 'tracktype', 'service', 'lit',
           'building', 'building:part', 'building:levels', 'height',
           'min_height', 'roof:shape', 'roof:height', 'addr:housenumber',
           'addr:street', 'addr:city', 'addr:postcode', 'amenity', 'shop',
           'tourism', 'office', 'brand', 'operator', 'opening_hours',
           'phone', 'website', 'cuisine', 'landuse', 'landcover', 'natural',
           'water', 'waterway', 'intermittent', 'railway', 'aeroway',
           'power', 'public_transport', 'route', 'network', 'leisure',
           'boundary', 'admin_level', 'place', 'population', 'religion',
           'historic', 'man_made', 'barrier', 'wheelchair', 'ele', 'sport')
LOW_FIELDS = COMMON + ('highway', 'natural', 'waterway', 'railway',
                       'landuse', 'place', 'admin_level', 'boundary', 'population')
ALL_FIELDS = tuple(dict.fromkeys(COMMON + DETAILS))

# layer, minimum zoom, table, primary key, SQL predicate
# These zoom breakpoints approximate OSM Carto's object visibility and keep
# client-independent extra features for styling; pixel-parity is not claimed.
LAYERS = (
    ('water', 5, 'vector_areas', 'area_id',
     "tags->>'natural' = 'water' OR tags ? 'water' OR tags->>'landuse' = 'reservoir'"),
    ('waterway', 8, 'vector_lines', 'way_id', "tags ? 'waterway'"),
    ('landcover', 7, 'vector_areas', 'area_id',
     "tags->>'natural' IN ('wood','scrub','grassland','heath','wetland','sand','bare_rock','beach','glacier') OR tags ? 'landcover'"),
    ('landuse', 9, 'vector_areas', 'area_id', "tags ? 'landuse'"),
    ('boundary', 3, 'vector_relations', 'relation_id',
     "tags->>'boundary' = 'administrative'"),
    ('road', 6, 'vector_lines', 'way_id',
     "tags ? 'highway' AND tags->>'highway' NOT IN ('footway','cycleway','path','steps','pedestrian','bridleway')"),
    ('pathway', 12, 'vector_lines', 'way_id',
     "tags->>'highway' IN ('footway','cycleway','path','steps','pedestrian','bridleway')"),
    ('railway', 8, 'vector_lines', 'way_id', "tags ? 'railway'"),
    ('aeroway', 10, 'vector_lines', 'way_id', "tags ? 'aeroway'"),
    ('aeroway_area', 11, 'vector_areas', 'area_id', "tags ? 'aeroway'"),
    ('building', 13, 'vector_areas', 'area_id', "tags ? 'building' AND tags->>'building' <> 'no'"),
    ('building_part', 14, 'vector_areas', 'area_id', "tags ? 'building:part'"),
    ('leisure', 10, 'vector_areas', 'area_id', "tags ? 'leisure'"),
    ('place', 5, 'vector_points', 'node_id', "tags ? 'place'"),
    ('poi', 12, 'vector_points', 'node_id',
     "tags ?| ARRAY['amenity','shop','tourism','office','craft','historic','leisure']"),
    ('poi', 12, 'vector_label_points', 'osm_id',
     "tags ?| ARRAY['amenity','shop','tourism','office','craft','historic','leisure']"),
    ('transport', 11, 'vector_points', 'node_id',
     "tags ?| ARRAY['public_transport','railway','highway'] AND (tags ? 'public_transport' OR tags->>'railway' IN ('station','halt','tram_stop','subway_entrance') OR tags->>'highway' = 'bus_stop')"),
    ('power', 12, 'vector_lines', 'way_id', "tags ? 'power'"),
    ('housenumber', 15, 'vector_points', 'node_id', "tags ? 'addr:housenumber'"),
    ('housenumber', 15, 'vector_label_points', 'osm_id', "tags ? 'addr:housenumber'"),
)
LAYER_NAMES = tuple(dict.fromkeys(item[0] for item in LAYERS))

# Extra zoom-aware filtering, instead of blindly materializing every high-zoom
# object in z0-z10. A style may further filter by rank / visual collision.
ZOOM_FILTER = {
    'road': ((8, "tags->>'highway' IN ('motorway','trunk')"),
             (10, "tags->>'highway' IN ('motorway','trunk','primary','secondary')")),
    'railway': ((10, "tags->>'railway' IN ('rail','subway')"),),
    'waterway': ((11, "tags->>'waterway' IN ('river','canal')"),),
    'place': ((7, "tags->>'place' IN ('country','state','city')"),
              (10, "tags->>'place' IN ('country','state','city','town')")),
    'poi': ((14, "tags->>'amenity' IN ('hospital','university','school','townhall','police','fire_station') OR tags->>'tourism' IN ('museum','attraction')"),),
    'boundary': ((8, "CASE WHEN tags->>'admin_level' ~ '^[0-9]+$' THEN (tags->>'admin_level')::integer <= 4 ELSE false END"),),
}


def layer_specs(z: int):
    """Stable per-zoom layer plan, compatible with Carto's broad zoom density."""
    for name, min_zoom, table, id_col, predicate in LAYERS:
        if z < min_zoom:
            continue
        restricted = predicate
        for max_z, rule in ZOOM_FILTER.get(name, ()):
            if z < max_z:
                restricted = f'({predicate}) AND ({rule})'
                break
        yield name, table, id_col, restricted


def _properties(alias: str, z: int, name: str, key: str) -> str:
    """No interpolated user SQL: layer/table/key are fixed module constants."""
    fields = ALL_FIELDS if z >= 13 else LOW_FIELDS
    pairs = ["'class', COALESCE(" + ' ,'.join(f"{alias}.tags->>'{k}'" for k in
             {'road': ('highway',), 'pathway': ('highway',), 'poi': ('amenity','shop','tourism','office','leisure'),
              'water': ('water','natural'), 'waterway': ('waterway',), 'place': ('place',),
              'building': ('building',), 'building_part': ('building:part',),
              'landuse': ('landuse',), 'landcover': ('natural','landcover'),
              'railway': ('railway',), 'boundary': ('boundary',), 'transport': ('public_transport','railway'),
              'leisure': ('leisure',), 'aeroway': ('aeroway',), 'aeroway_area': ('aeroway',),
              'power': ('power',), 'housenumber': ('addr:housenumber',)}.get(name,('name',))) + ")",
             f"'osm_id', '{key}' || {alias}.{key}::text"]
    for field in fields:
        pairs.append(f"'{field}', {alias}.tags->>'{field}'")
    # PostgreSQL limits function calls to 100 arguments (50 JSONB pairs).
    # Emit bounded objects and merge them with || for the detailed high-zoom
    # schema, which intentionally contains more than 50 OSM attributes.
    chunks = [pairs[i:i+40] for i in range(0, len(pairs), 40)]
    return ' || '.join('jsonb_strip_nulls(jsonb_build_object(' + ', '.join(part) + '))'
                       for part in chunks)


def query_for_zoom(z: int) -> str:
    """One indexed SQL statement per XYZ tile, with UNIQUE MVT layer names.

    When a logical layer has two source tables (point POIs and area label
    points), UNION the source features BEFORE ST_AsMVT. Appending two MVT
    layers with the same name causes ambiguity in real tile renderers.
    """
    grouped = {}
    for name, table, key, predicate in layer_specs(z):
        props = _properties('t', z, name, key)
        branch = f"""SELECT ST_AsMVTGeom(t.geom, b.tile, {EXTENT}, {BUFFER}, true) AS geom,
                          {props} AS properties
                     FROM {table} t
                    WHERE t.geom && b.search AND ({predicate})"""
        grouped.setdefault(name, []).append(branch)
    parts = []
    for name, branches in grouped.items():
        query = ' UNION ALL '.join(branches)
        parts.append(f"""COALESCE((
          SELECT ST_AsMVT(q, '{name}', {EXTENT}, 'geom')
            FROM ({query}) q WHERE q.geom IS NOT NULL
        ), ''::bytea)""")
    if not parts:
        return "SELECT ''::bytea"
    return """WITH b AS (
      SELECT ST_TileEnvelope(%s, %s, %s) AS tile,
             ST_TileEnvelope(%s, %s, %s, margin => 64.0 / 4096) AS search
    ) SELECT """ + ' || '.join(parts) + ' FROM b'


def metadata(name: str, bounds: tuple, lo: int, hi: int) -> dict[str, str]:
    layer_info = []
    for layer in LAYER_NAMES:
        min_zoom = min(z for n, z, _, _, _ in LAYERS if n == layer)
        if min_zoom > hi:
            continue
        layer_info.append({'id': layer,
                           'fields': {'class': 'String', 'osm_id': 'String',
                                      **{field:'String' for field in ALL_FIELDS}},
                           'minzoom': max(lo, min_zoom), 'maxzoom': hi})
    w, s, e, n = bounds
    return {'name': name, 'type': 'baselayer', 'version': '1.3',
            'description': 'Detailed OSM feature properties using vector flex import',
            'format': 'pbf', 'minzoom': str(lo), 'maxzoom': str(hi),
            'bounds': ','.join(map(str, bounds)),
            'center': f'{(w+e)/2},{(s+n)/2},{lo}',
            'json': json.dumps({'vector_layers': layer_info}, separators=(',', ':'))}


def xyz_tasks(bbox, lo, hi):
    for z in range(lo, hi+1):
        xmin, xmax, ymin, ymax = xyz_range(bbox, z)
        for y in range(ymin, ymax+1):
            for x in range(xmin, xmax+1):
                yield z, x, y


_conn = None
_queries = {}


def init_worker():
    global _conn, _queries
    import psycopg2
    _conn = psycopg2.connect(dbname=os.environ.get('PGDATABASE', 'gis'))
    _conn.autocommit = True  # read-only tile SELECTs, no lingering transaction
    _queries = {}


def render_one(task):
    z, x, y = task
    sql = _queries.get(z)
    if sql is None:
        sql = query_for_zoom(z)
        _queries[z] = sql
    with _conn.cursor() as cur:
        if z < 3:
            # no selected vector layers at some global zoom levels
            return z, x, y, b''
        cur.execute(sql, (z,x,y,z,x,y))
        pbf = cur.fetchone()[0] or b''
    return z, x, y, bytes(pbf)


def create_db(conn, info):
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA temp_store=MEMORY')
    conn.execute('PRAGMA cache_size=-32768')  # 32 MiB, respects WSL memory
    conn.executescript('''
       CREATE TABLE IF NOT EXISTS metadata(name TEXT PRIMARY KEY, value TEXT);
       CREATE TABLE IF NOT EXISTS tiles(zoom_level INTEGER, tile_column INTEGER,
         tile_row INTEGER, tile_data BLOB,
         PRIMARY KEY(zoom_level,tile_column,tile_row));
    ''')
    conn.executemany('INSERT OR REPLACE INTO metadata VALUES (?,?)', info.items())
    conn.commit()


def export(pbf, out: Path, bbox, lo: int, hi: int, processes: int):
    """Produces gzip MVT MBTiles; a failed run never overwrites the final file."""
    if not 1 <= processes <= 64:
        raise ValueError('workers must be 1..64')
    partial = out.with_name(out.name+'.partial')
    # A fresh build starts from a clean staging DB; do not destroy a verified out.
    partial.unlink(missing_ok=True)
    total = tile_count(bbox, lo, hi)
    start = time.monotonic()
    seen = written = 0
    print(f'[VECTOR] total XYZ tiles={total:,}, zoom={lo}-{hi}, workers={processes}',flush=True)
    ctx = multiprocessing.get_context('spawn' if sys.platform == 'win32' else 'fork')
    # Spawn worker processes BEFORE opening SQLite to avoid inherited SQLite handles.
    with ctx.Pool(processes=processes, initializer=init_worker) as pool:
        with sqlite3.connect(partial) as conn:
            create_db(conn, metadata(out.stem,bbox,lo,hi))
            pending = last_pct = 0
            for z, x, y, pbf_data in pool.imap_unordered(render_one, xyz_tasks(bbox,lo,hi), chunksize=1):
                seen += 1
                if pbf_data:
                    # MVT in MBTiles 1.3 must be gzip compressed.
                    conn.execute('INSERT INTO tiles VALUES (?,?,?,?)',
                                 (z,x,(1<<z)-1-y,sqlite3.Binary(gzip.compress(pbf_data,compresslevel=6,mtime=0))))
                    written += 1
                    pending += 1
                if pending >= 128:
                    conn.commit()
                    pending = 0
                pct = int(seen * 100 / total) if total else 100
                if pct >= last_pct + 5 or seen == total:
                    rate = seen / max(0.001, time.monotonic() - start)
                    eta = (total-seen) / rate if rate else 0
                    print(f'[VECTOR] {pct:3d}%  {seen:,}/{total:,} tiles | nonempty={written:,} | {rate:,.1f}/s | ETA={eta/60:.1f}m', flush=True)
                    last_pct = pct
            if seen != total:
                raise RuntimeError(f'vector tile jobs incomplete: {seen}/{total}')
            conn.commit()
            conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            conn.execute('PRAGMA journal_mode=DELETE')
            result = conn.execute('PRAGMA integrity_check').fetchone()[0]
            if result != 'ok':
                raise RuntimeError('vector MBTiles integrity_check: '+result)
    os.replace(partial, out)
    print(f'[VECTOR] COMPLETE: {written:,} nonempty/{total:,} planned tiles; {out.stat().st_size:,} bytes', flush=True)
    return written


def verify(path: Path) -> dict:
    """Validate the container and gzip payloads, including MVT layer headers."""
    if not path.is_file():
        raise ValueError(f'File not found: {path}')
    with sqlite3.connect(path) as conn:
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite integrity_check failed')
        meta = dict(conn.execute('SELECT name,value FROM metadata'))
        if meta.get('format') != 'pbf':
            raise ValueError('Not a vector PBF MBTiles')
        info = json.loads(meta['json'])
        layers = info['vector_layers']
        if not layers or not all('id' in v and 'fields' in v for v in layers):
            raise ValueError('Invalid vector_layers metadata')
        rows = conn.execute('SELECT zoom_level,tile_column,tile_row,tile_data FROM tiles').fetchall()
        sample = rows[:128]
        for z, x, y, data in sample:
            if not (0 <= x < (1 << z) and 0 <= y < (1 << z)):
                raise ValueError('Invalid TMS tile coordinates')
            decoded = gzip.decompress(data)
            if not decoded or b'\x1a' not in decoded:
                raise ValueError('Empty or malformed MVT PBF')
        return {'format':'pbf', 'tiles':len(rows), 'layers':len(layers),
                'layer_names':[v['id'] for v in layers],
                'sampled_gzip_tiles':len(sample), 'integrity':'ok'}