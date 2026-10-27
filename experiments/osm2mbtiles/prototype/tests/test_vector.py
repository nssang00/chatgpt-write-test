"""Vector tile schema and MBTiles validation without external PostGIS."""
import gzip
import json
import sqlite3
from pathlib import Path
from osm2mbtiles.vector import (LAYERS, LAYER_NAMES, metadata, layer_specs,
                                  query_for_zoom, xyz_tasks, create_db, verify)
from osm2mbtiles.cli import main
from .test_pbf import sample_pbf


def test_schema_layer_coverage():
    expected = {'road','pathway','railway','building','building_part',
                'water','waterway','landuse','landcover','poi','place',
                'boundary','housenumber','leisure','aeroway','transport'}
    assert expected.issubset(LAYER_NAMES)
    assert len(LAYER_NAMES) >= 16
    assert len(LAYERS) > len(LAYER_NAMES) # point + polygon POIs


def test_zoom_filters_are_monotonic():
    for z in range(0,16):
        specs = list(layer_specs(z))
        if z < 13: assert not any(n == 'building' for n,*_ in specs)
        if z >= 13: assert any(n == 'building' for n,*_ in specs)
        assert len(specs) >= len(list(layer_specs(z-1))) if z>0 else True
    assert any(n == 'road' for n,*_ in layer_specs(6))
    assert not any(n == 'pathway' for n,*_ in layer_specs(11))
    assert any(n == 'pathway' for n,*_ in layer_specs(12))


def test_sql_uses_index_and_preserves_attributes():
    sql = query_for_zoom(15)
    assert 'ST_TileEnvelope(%s, %s, %s)' in sql
    assert 't.geom && b.search' in sql
    assert 'ST_AsMVTGeom(' in sql and 'ST_AsMVT(q,' in sql
    for item in ("'maxspeed'", "'building:levels'", "'name:ko'", "'opening_hours'", "'surface'", "'osm_id'"):
        assert item in sql
    assert sql.count('FROM vector_') >= 16


def test_low_zoom_attribute_budget():
    small = query_for_zoom(8)
    assert "'maxspeed'" not in small
    assert "'name:ko'" in small
    assert "'road'" in small
    assert "'building'" not in small


def test_xyz_tasks_match_counts():
    bounds=(127.0,36.9,127.1,37.1)
    tiles=list(xyz_tasks(bounds,0,9))
    assert len(tiles) == len(set(tiles))
    assert all(0<=x<2**z and 0<=y<2**z for z,x,y in tiles)


def test_metadata_and_empty_mbtiles(tmp_path):
    m=metadata('monaco', (7.4,43.7,7.5,43.8),8,15)
    assert m['format']=='pbf'
    obj=json.loads(m['json'])
    assert len(obj['vector_layers'])>=16
    assert obj['vector_layers'][0]['id']=='water'
    assert obj['vector_layers'][0]['fields']['name:ko']=='String'
    p=tmp_path/'test.mbtiles'
    with sqlite3.connect(p) as conn:
        create_db(conn,m)
        assert conn.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert conn.execute('PRAGMA journal_mode').fetchone()[0]=='wal'
    info=verify(p)
    assert info['format']=='pbf'
    assert info['tiles']==0


def test_vector_cli_dry_run(tmp_path,capsys):
    pbf=sample_pbf(tmp_path/'test.osm.pbf',(-.1,-.1,.1,.1))
    assert main([str(pbf),'-z','0-4','-o',str(tmp_path/'map.mbtiles'),
                 '--format','vector','--dry-run'])==0
    assert 'tiles=' in capsys.readouterr().out


def test_vector_verifier_rejects_wrong_format(tmp_path):
    p=tmp_path/'bad.mbtiles'
    with sqlite3.connect(p) as conn:
        create_db(conn,metadata('test',(0,0,1,1),0,1))
        conn.execute("UPDATE metadata SET value='png' WHERE name='format'")
        conn.commit()
    try:
        verify(p)
        assert False, 'must reject PNG metadata'
    except ValueError as exc:
        assert 'Not a vector' in str(exc)