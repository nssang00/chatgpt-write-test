#!/usr/bin/env python3
"""SYNTHETIC-only unit tests for NGII adapter; never call this a real NGII benchmark."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import transform_bounds

HERE=Path(__file__).resolve().parent
BBOX=[127.381,36.345,127.39,36.352]
def main():
    with tempfile.TemporaryDirectory(prefix="synthetic-ngii-unit-test-") as tmp:
        root=Path(tmp);source=root/"raster";source.mkdir()
        public=root/"public";public.mkdir()
        metadata={"bbox":BBOX,"center":[(BBOX[0]+BBOX[2])/2,(BBOX[1]+BBOX[3])/2],
                  "terrainGrid":[2,2],"triangles":{"terrain":2,"buildings":1},
                  "buildingCount":1}
        terrain={"positions":[],"indices":[0,2,1,1,2,3]}
        for lat in (BBOX[1],BBOX[3]):
            for lon in (BBOX[0],BBOX[2]):
                x=(lon-metadata["center"][0])*111320*np.cos(np.deg2rad(metadata["center"][1]))
                z=(lat-metadata["center"][1])*111320
                terrain["positions"].extend([float(x),0,float(z)])
        building={"positions":[0,0,0, 0,8,0],"indices":[0,1,0]}
        (public/"fixture.json").write_text(json.dumps({"metadata":metadata,"terrain":terrain,"buildings":building}))
        (public/"fixture-detailed.json").write_text(json.dumps({
            "metadata":dict(metadata,materialColors={"wall":[.5,.5,.5]},trianglesByMaterial={"wall":1}),
            "terrain":terrain,
            "surfaces":{"wall":{"positions":[0,10,0,0,12,0,0,15,0],"indices":[0,1,2]}}
        }))
        # Expected production format: georeferenced GeoTIFF / Erdas Imagine .img.
        # EPSG:5186 test checks realistic Korean projected-grid support.
        coord=transform_bounds("EPSG:4326","EPSG:5186",
            BBOX[0]-.035,BBOX[1]-.035,BBOX[2]+.035,BBOX[3]+.035,densify_pts=21)
        height=150;width=150
        f=source/"synthetic_do_not_publish_as_ngii.tif"
        with rasterio.open(f,"w",driver="GTiff",width=width,height=height,
            count=1,dtype="float32",crs="EPSG:5186",
            transform=from_bounds(*coord,width,height),nodata=-9999) as dst:
            dst.write(np.full((height,width),131.5,dtype="float32"),1)
        command=[sys.executable,str(HERE/"ngii_rebase.py"),"--dem-dir",str(source),"--out-dir",str(public)]
        outcome=subprocess.run(command,capture_output=True,text=True)
        if outcome.returncode!=0:raise AssertionError("synthetic raster reprojection failed:\n"+outcome.stderr)
        data=json.loads((public/"fixture-ngii-detailed.json").read_text())
        base=json.loads((public/"fixture-ngii.json").read_text())
        assert data["metadata"]["demSource"]=="NGII"
        assert len(data["terrain"]["positions"])>1000
        assert abs(data["terrain"]["positions"][1]-131.5)<.1
        assert abs(data["surfaces"]["wall"]["positions"][1]-141.5)<.1
        assert abs(base["buildings"]["positions"][1]-131.5)<.1
        assert data["metadata"]["ngiiCoverage"]==1.0
        # Fail-closed test: no input DEM may be replaced with AWS/Mapzen.
        empty=root/"empty";empty.mkdir()
        failure=subprocess.run([sys.executable,str(HERE/"ngii_rebase.py"),
            "--dem-dir",str(empty),"--out-dir",str(public)],capture_output=True,text=True)
        assert failure.returncode!=0 and "Never substitute AWS DEM" in failure.stderr
        print("SYNTHETIC_CONVERTER_TEST_PASS EPSG:5186 IMG/TIFF rasterio path; authentic NGII source NOT obtained")
if __name__=="__main__":main()
