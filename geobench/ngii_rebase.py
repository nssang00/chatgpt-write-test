#!/usr/bin/env python3
"""Replace Terrarium heights with AUTHENTIC supplied NGII DEM raster heights.
Fails closed if NGII raster files are missing or fail to cover the test bbox.
Required: numpy, rasterio. Supports NGII Erdas Imagine .img and GeoTIFF.
No source DEM raster or derived mesh is uploaded by this script.
"""
import argparse
import json
import math
from pathlib import Path
import sys
import numpy as np
import rasterio
from rasterio.transform import Affine
from rasterio.warp import reproject, Resampling

ROOT=Path(__file__).resolve().parent
BBOX_REQUIRED=[127.381,36.345,127.39,36.352]
def die(message):
    raise RuntimeError("NGII DEM INPUT ERROR: "+message)

def read_json(path):
    with path.open("r",encoding="utf-8") as f:return json.load(f)

def write_json(path,value):
    with path.open("w",encoding="utf-8") as f:
        json.dump(value,f,ensure_ascii=False,separators=(",",":"))

def interpolate(grid,x,z,x0,z0,x1,z1):
    height,width=grid.shape
    fx=np.clip((x-x0)/(x1-x0)*(width-1),0,width-1)
    fz=np.clip((z-z0)/(z1-z0)*(height-1),0,height-1)
    i=int(np.floor(fx)); j=int(np.floor(fz))
    i1=min(i+1,width-1);j1=min(j+1,height-1)
    dx=fx-i;dz=fz-j
    return float((grid[j,i]*(1-dx)+grid[j,i1]*dx)*(1-dz)
                +(grid[j1,i]*(1-dx)+grid[j1,i1]*dx)*dz)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dem-dir",required=True,help="Directory containing REAL NGII .img/.tif raster(s)")
    parser.add_argument("--grid-step",type=float,default=5.0,help="Target terrain grid step in meters (default 5)")
    parser.add_argument("--out-dir",default=str(ROOT/"public"))
    args=parser.parse_args()
    demdir=Path(args.dem_dir)
    if not demdir.is_dir():die("NGII_DEM_DIR is missing. Never substitute AWS DEM.")
    if not (1.0<=args.grid_step<=30.0):die("grid-step must be 1..30 meters")
    inputs=sorted(p for p in demdir.rglob("*") if p.is_file() and p.suffix.lower() in {".img",".tif",".tiff",".vrt"})
    if not inputs:die("No NGII .img/.tif/.tiff/.vrt files found. Never substitute AWS DEM.")
    public=Path(args.out_dir)
    base=read_json(public/"fixture.json")
    detailed=read_json(public/"fixture-detailed.json")
    west,south,east,north=map(float,base["metadata"]["bbox"])
    if max(abs(a-b) for a,b in zip([west,south,east,north],BBOX_REQUIRED))>1e-8:
        die("bbox differs from common four-engine Daejeon fixture")
    lon0,lat0=base["metadata"]["center"]
    latrad=math.radians(lat0)
    ew=(east-west)*111320*math.cos(latrad)
    ns=(north-south)*111320
    nx=max(64,math.ceil(ew/args.grid_step))
    nz=max(64,math.ceil(ns/args.grid_step))
    width=nx+1;height=nz+1
    # Pixel centers coincide EXACTLY with the projected terrain vertices.
    dx=(east-west)/nx;dy=(north-south)/nz
    transform=Affine(dx,0,west-dx/2,0,-dy,north+dy/2)
    target=np.full((height,width),np.nan,dtype=np.float32)
    source_info=[]
    for path in inputs:
        try:
            with rasterio.open(path) as src:
                if src.count<1:die(f"{path.name}: raster has no bands")
                if src.crs is None:die(f"{path.name}: CRS absent; refusing to guess EPSG")
                # Keep source nodata semantics; output unavailable pixels as NaN.
                tmp=np.full_like(target,np.nan)
                reproject(
                    source=rasterio.band(src,1),
                    destination=tmp,
                    src_nodata=src.nodata,
                    dst_transform=transform,
                    dst_crs="EPSG:4326",
                    dst_nodata=np.nan,
                    init_dest_nodata=True,
                    resampling=Resampling.bilinear
                )
                valid=np.isfinite(tmp)&(np.abs(tmp)<10000)
                # Later inputs only fill holes. Do not average mixed datum tiles.
                fill=valid&~np.isfinite(target)
                target[fill]=tmp[fill]
                source_info.append({
                  "file":path.name,"crs":src.crs.to_string(),
                  "pixelSize":list(src.res),"nodata":str(src.nodata),
                  "pixelsFilled":int(np.count_nonzero(fill))
                })
        except rasterio.errors.RasterioIOError as err:
            die(f"Cannot read {path.name}: {err}")
    coverage=float(np.mean(np.isfinite(target)))
    if coverage<0.999999:
        die(f"NGII input does not cover full Daejeon test area: {coverage:.2%}; supply all adjacent sheets")
    if float(np.nanmin(target))<-500 or float(np.nanmax(target))>2000:
        die("Unexpected elevation range. Check input raster band and units.")
    # target row 0 is north. Scene terrain rows progress from south to north.
    terrain={"positions":[],"indices":[]}
    for j in range(nz+1):
        lat=south+(north-south)*j/nz
        z=(lat-lat0)*111320
        for i in range(nx+1):
            lon=west+(east-west)*i/nx
            x=(lon-lon0)*111320*math.cos(latrad)
            terrain["positions"].extend([x,float(target[nz-j,i]),z])
    for j in range(nz):
        for i in range(nx):
            a=j*(nx+1)+i;b=a+1;c=a+(nx+1);d=c+1
            terrain["indices"].extend([a,c,b,b,c,d])
    oldmeta=base["metadata"]
    ow,oh=map(int,oldmeta["terrainGrid"])
    oldp=base["terrain"]["positions"]
    old_grid=np.asarray(oldp,dtype=np.float64).reshape((oh,ow,3))[:,:,1]
    new_grid=target[::-1].copy().astype(np.float64)
    x0=(west-lon0)*111320*math.cos(latrad)
    x1=(east-lon0)*111320*math.cos(latrad)
    z0=(south-lat0)*111320
    z1=(north-lat0)*111320
    # Rebase ALL facades, windows, roads and roof units from the old
    # reference surface to the NGII surface at each individual vertex.
    # This is necessary: merely swapping terrain leaves buildings floating.
    for name,mesh in detailed["surfaces"].items():
        v=mesh["positions"]
        for k in range(0,len(v),3):
            x,y,z=v[k:k+3]
            oldh=interpolate(old_grid,x,z,x0,z0,x1,z1)
            newh=interpolate(new_grid,x,z,x0,z0,x1,z1)
            v[k+1]=float(y+(newh-oldh))
    audit={
      "demSource":"NGII",
      "demSourceDescription":"National Geographic Information Institute user-supplied authentic raster (not public AWS Terrain Tiles)",
      "ngiiInputFiles":source_info,
      "ngiiCoverage":coverage,
      "ngiiGridStepMeters":args.grid_step,
      "ngiiElevationMinMaxMeters":[float(np.nanmin(target)),float(np.nanmax(target))],
      "ngiiVerticalDatumWarning":"Verify native NGII vertical reference and source units before mixing with other datasets.",
      "terrainGrid":[width,height],
      "terrainTriangles":len(terrain["indices"])//3,
      "terrainZoom":None,
      "demPrefix":None,
      "dataIntegrity":"NGII raster is required; NO automatic fallback to Mapzen/AWS is permitted"
    }
    newbase=read_json(public/"fixture.json")
    # Also rebase the plain extruded building mesh.
    plain_positions=newbase["buildings"]["positions"]
    for k in range(0,len(plain_positions),3):
        x,y,z=plain_positions[k:k+3]
        plain_positions[k+1]=float(y+
            interpolate(new_grid,x,z,x0,z0,x1,z1)-
            interpolate(old_grid,x,z,x0,z0,x1,z1))
    newbase["terrain"]=terrain
    newbase["metadata"].update(audit)
    newbase["metadata"]["triangles"]["terrain"]=len(terrain["indices"])//3
    nd=detailed
    nd["terrain"]=terrain
    nd["metadata"].update(audit)
    nd["metadata"]["visualAccuracy"]="OSM footprints and roads + authentic NGII user-provided DEM; facades, windows, trees and roof furniture remain PROCEDURAL / illustrative."
    write_json(public/"fixture-ngii.json",newbase)
    write_json(public/"fixture-ngii-detailed.json",nd)
    print("NGII_IMPORT_SUCCESS "+json.dumps({
      "demSource":"NGII","coverage":coverage,"sourceFiles":source_info,
      "terrainGrid":[width,height],"triangleCount":len(terrain["indices"])//3,
      "heightRange":audit["ngiiElevationMinMaxMeters"],
      "detailedBuildingCount":nd["metadata"]["buildingCount"]
    },ensure_ascii=False))
if __name__=="__main__":main()
