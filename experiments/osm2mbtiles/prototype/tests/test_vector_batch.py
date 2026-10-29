"""No-DB structural regression tests for region-batch SQL and XYZ coverage."""
from osm2mbtiles.vector import query_for_zoom, xyz_tasks
from osm2mbtiles.vector_batch import batch_query, microbatches


def test_microbatches_cover_exact_xyz_without_duplicates():
    bbox = (127.015, 37.485, 127.075, 37.535)
    baseline = list(xyz_tasks(bbox, 12, 15))
    for side in (1, 2, 4, 8):
        batch = [(z, x, y) for z, cells in microbatches(bbox, 12, 15, side)
                 for x, y in cells]
        assert len(batch) == len(set(batch))
        assert set(batch) == set(baseline)


def test_batch_sql_limits_inputs_and_projection():
    for z in (3, 8, 12, 13, 15):
        for count in (1, 4, 16):
            sql = batch_query(z, count)
            assert sql.count("%s::integer") == 2 * count
            assert "ST_TileEnvelope" in sql
            assert "ST_Envelope(ST_Collect(search))" in sql
            assert " AS pbf FROM b" in sql
            assert "FROM b ORDER BY b.y,b.x" in sql
            if z >= 12:
                assert "ST_AsMVTGeom(s.geom" in sql
                assert "ST_AsMVT(q" in sql
                assert "MATERIALIZED" in sql
                assert "SELECT f.geom, f.properties" in sql
            # Base MVT API must remain the same geometry envelope rules.
            old = query_for_zoom(z)
            assert "4096" in old and "4096" in sql
            assert "64.0 / 4096" in old and "64.0 / 4096" in sql


def test_invalid_batch_size_rejected():
    import pytest
    for n in (0, 65):
        with pytest.raises(ValueError):
            batch_query(15, n)
    for n in (0, 9):
        with pytest.raises(ValueError):
            list(microbatches((126, 37, 127, 38), 12, 12, side=n))
