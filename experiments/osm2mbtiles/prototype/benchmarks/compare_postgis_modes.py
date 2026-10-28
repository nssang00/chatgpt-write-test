#!/usr/bin/env python3
"""Assert per-tile MVT semantic equality across PostGIS query plans.

Compares decoded geometry + *all* feature properties by layer and XYZ tile,
including duplicate feature multiplicity. Feature sequence and gzip bytes can
legitimately differ without changing vector tile contents.
"""
import argparse
import collections
import gzip
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

import mapbox_vector_tile


def read_archive(path):
    result = {}
    with sqlite3.connect(path) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Invalid SQLite archive: '+str(path))
        for z,x,tms_y,blob in db.execute('SELECT zoom_level,tile_column,tile_row,tile_data FROM tiles'):
            xyz_y = (1 << z) - 1 - tms_y
            decoded = mapbox_vector_tile.decode(gzip.decompress(blob))
            counted = collections.Counter()
            for layer, data in decoded.items():
                for feature in data['features']:
                    key = json.dumps((layer,feature['geometry'],feature['properties']),
                                     sort_keys=True,ensure_ascii=False,separators=(',',':'))
                    counted[key] += 1
            result[z,x,xyz_y] = counted
    return result


def compare(a,b):
    left = read_archive(a)
    right = read_archive(b)
    allkeys = left.keys() | right.keys()
    errors = []
    features = 0
    for tile in sorted(allkeys):
        ca,cb = left.get(tile,collections.Counter()),right.get(tile,collections.Counter())
        features += sum(ca.values())
        if ca != cb:
            errors.append({'tile':list(tile),'missing':sum((ca-cb).values()),
                           'extra':sum((cb-ca).values())})
    return {'equal':len(errors)==0,'tiles_baseline':len(left),
            'tiles_cached':len(right),'features':features,'different_tiles':len(errors),
            'first_mismatches':errors[:8],
            'baseline_sha256':hashlib.sha256(a.read_bytes()).hexdigest(),
            'cached_sha256':hashlib.sha256(b.read_bytes()).hexdigest()}


def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument('baseline',type=Path)
    p.add_argument('cached',type=Path)
    p.add_argument('--output',type=Path)
    a=p.parse_args(argv)
    result=compare(a.baseline,a.cached)
    if a.output:
        a.output.write_text(json.dumps(result,indent=2)+'\n')
    print('POSTGIS_MVT_SEMANTIC_PARITY',json.dumps(result,ensure_ascii=False))
    return 0 if result['equal'] else 1


if __name__=='__main__':
    sys.exit(main())