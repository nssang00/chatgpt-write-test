"""Tiny native Mapnik PNG consistency smoke using the actual OSM Carto tables.

The map style here is intentionally minimal and does NOT claim full visual
parity with the upstream CartoCSS/Mapnik project.xml. Carto table equality is
checked separately by common_import_benchmark.py.
"""
from __future__ import annotations
import hashlib
import math


def render(db,bbox,output):
    import mapnik
    from pathlib import Path
    R=20037508.342789244
    z=14
    west,south,east,north=bbox
    lon=(west+east)/2
    lat=(south+north)/2
    n=2**z
    x=int((lon+180)/360*n)
    y=int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)
    step=2*R/n
    bounds=mapnik.Box2d(-R+x*step,R-(y+1)*step,-R+(x+1)*step,R-y*step)
    merc='+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs'
    m=mapnik.Map(256,256)
    m.srs=merc
    m.background=mapnik.Color('white')
    for name,table,kind,color in (
            ('areas','planet_osm_polygon','poly','#e3e8cd'),
            ('roads','planet_osm_line','line','#797979')):
        sty=mapnik.Style()
        rule=mapnik.Rule()
        if kind=='poly':
            symbol=mapnik.PolygonSymbolizer()
            symbol.fill=mapnik.Color(color)
        else:
            symbol=mapnik.LineSymbolizer()
            symbol.stroke=mapnik.Color(color)
            symbol.stroke_width=2
        rule.symbols.append(symbol)
        sty.rules.append(rule)
        m.append_style(name,sty)
        layer=mapnik.Layer(name)
        layer.srs=merc
        layer.styles.append(name)
        layer.datasource=mapnik.PostGIS(
            host=db.env['PGHOST'],port=int(db.env['PGPORT']),
            dbname='gis',user=db.env['PGUSER'],password=db.env['PGPASSWORD'],
            table=f'(SELECT osm_id, way FROM {table} ORDER BY osm_id) AS {name}_query',
            geometry_field='way',srid=3857,extent_from_subquery=True)
        m.layers.append(layer)
    m.zoom_to_box(bounds)
    img=mapnik.Image(256,256)
    mapnik.render(m,img)
    png=img.tostring('png')
    output=Path(output);output.write_bytes(png)
    assert png.startswith(b'\x89PNG\r\n\x1a\n')
    return hashlib.sha256(png).hexdigest()