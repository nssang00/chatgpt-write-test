#!/usr/bin/env python3
import hashlib, json, math, os, pathlib, sys, urllib.request

API = "https://api.maptiler.com"
OUT = pathlib.Path(os.environ.get("MAPTILER_OUT", "artifacts/maptiler-live"))
KEY = os.environ.get("MAPTILER_KEY", "")
CITIES = {
    "seoul": (37.5665, 126.9780),
    "london": (51.5074, -0.1278),
    "san-francisco": (37.7749, -122.4194),
}
ZOOMS = (8, 12, 15)

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent":"chatgpt-maptiler-recorder/1.0"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read()

def redact(data):
    return data.replace(KEY.encode(), b"${MAPTILER_KEY}") if KEY else data

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(redact(data))

def tile_xy(lat, lon, z):
    n = 1 << z
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(max(min(lat, 85.05112878), -85.05112878))
    y = int((1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n)
    return max(0, min(n-1, x)), max(0, min(n-1, y))

def main():
    if not KEY:
        raise SystemExit("MAPTILER_KEY is required")
    OUT.mkdir(parents=True, exist_ok=True)
    endpoints = {
        "style.json": f"{API}/maps/streets-v4/style.json?key={KEY}",
        "tiles.json": f"{API}/tiles/v4/tiles.json?key={KEY}",
    }
    for name,url in endpoints.items():
        data=fetch(url)
        write(OUT/name, data)
        print("recorded", name, len(data))

    # Record a deterministic 2x2 neighborhood for each city/zoom.
    tile_count=0
    for city,(lat,lon) in CITIES.items():
        for z in ZOOMS:
            x,y=tile_xy(lat,lon,z)
            for dx,dy in ((0,0),(1,0),(0,1),(1,1)):
                tx,ty=x+dx,y+dy
                url=f"{API}/tiles/v4/{z}/{tx}/{ty}.pbf?key={KEY}"
                data=fetch(url)
                write(OUT/"tiles"/city/str(z)/str(tx)/f"{ty}.pbf", data)
                tile_count += 1
                print("recorded", city, z, tx, ty, len(data))

    # Reject any accidental credential persistence before making the artifact.
    leaked=[]
    for p in OUT.rglob("*"):
        if p.is_file() and KEY.encode() in p.read_bytes():
            leaked.append(str(p))
    if leaked:
        raise SystemExit("credential leak detected: " + ", ".join(leaked))

    manifest={"schema":1,"map":"streets-v4","tileset":"v4","cities":CITIES,"zooms":ZOOMS,"tiles":tile_count,"files":[]}
    for p in sorted(x for x in OUT.rglob("*") if x.is_file()):
        b=p.read_bytes()
        manifest["files"].append({"path":str(p.relative_to(OUT)),"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest()})
    (OUT/"manifest.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n")
    print("wrote", OUT/"manifest.json")

if __name__ == "__main__":
    main()
