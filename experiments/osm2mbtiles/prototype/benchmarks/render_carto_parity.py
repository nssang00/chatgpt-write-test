#!/usr/bin/env python3
"""Render a real OSM Carto v6 Mapnik metatile into 4 PNG MBTiles for parity."""
import argparse,hashlib,math,sqlite3,os
from pathlib import Path
import mapnik
from PIL import Image,ImageStat
p=argparse.ArgumentParser();p.add_argument('--style',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
mapnik.register_fonts(str(a.style/'fonts'))
m=mapnik.Map(512,512);mapnik.load_map(m,str(a.style/'project.xml'),True)
m.buffer_size=128
z=14;lat=43.735;lon=7.423;n=1<<z
x=int((lon+180)/360*n);y=int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)*n/2)
mx=x-x%2;my=y-y%2;R=20037508.342789244;step=2*R/n
m.zoom_to_box(mapnik.Box2d(-R+mx*step,R-(my+2)*step,-R+(mx+2)*step,R-my*step))
image=mapnik.Image(512,512);mapnik.render(m,image)
a.out.parent.mkdir(parents=True,exist_ok=True)
with sqlite3.connect(a.out) as db:
 db.execute('CREATE TABLE metadata(name TEXT PRIMARY KEY, value TEXT)');db.execute('CREATE TABLE tiles(zoom_level INT,tile_column INT,tile_row INT,tile_data BLOB,PRIMARY KEY(zoom_level,tile_column,tile_row))')
 db.executemany('INSERT INTO metadata VALUES(?,?)',[('format','png'),('name','carto-parity')]);vars=[]
 for dy in range(2):
  for dx in range(2):
   png=image.view(dx*256,dy*256,256,256).tostring('png')
   pic=Image.open(__import__('io').BytesIO(png)).convert('RGB')
   vars.append(max(ImageStat.Stat(pic).var))
   db.execute('INSERT INTO tiles VALUES(?,?,?,?)',(z,mx+dx,n-1-(my+dy),png))
 db.commit()
 print('CARTO_REAL_PNG',a.out,'pixel_variance',vars,flush=True)
 assert max(vars)>20, 'Blank Carto image'