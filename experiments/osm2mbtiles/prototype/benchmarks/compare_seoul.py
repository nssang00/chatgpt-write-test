#!/usr/bin/env python3
"""Compare real gzip-MVT MBTiles without pretending the schemas are identical."""
import argparse
import collections
import gzip
import hashlib
import json
import os
import re
import sqlite3
import subprocess
from pathlib import Path

import mapbox_vector_tile


def mbtiles_stats(path):
    counts = collections.Counter()
    attrs = collections.defaultdict(set)
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        fmt = dict(db.execute("SELECT name, value FROM metadata")).get("format")
        assert fmt == "pbf", (path, fmt)
        rows = db.execute("SELECT zoom_level,tile_data FROM tiles").fetchall()
        zooms = collections.Counter()
        for z, blob in rows:
            zooms[z] += 1
            tile = mapbox_vector_tile.decode(gzip.decompress(blob))
            for layer_name, layer in tile.items():
                for feature in layer["features"]:
                    counts[layer_name] += 1
                    attrs[layer_name].update(feature["properties"].keys())
    assert rows, "No populated MVT tiles: "+str(path)
    return {
        "bytes": path.stat().st_size,
        "tiles": len(rows),
        "zooms": dict(sorted(zooms.items())),
        "features": sum(counts.values()),
        "layer_counts": dict(sorted(counts.items())),
        "detail_fields": {k: sorted(v) for k, v in sorted(attrs.items())},
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def time_stats(path):
    raw = Path(path).read_text()
    def get(pattern):
        m = re.search(pattern, raw, re.M)
        return float(m.group(1)) if m else None
    return {
        "wall_seconds": get(r"BENCH_WALL_SEC=([0-9.]+)"),
        "max_rss_kb": get(r"BENCH_MAX_RSS_KB=([0-9.]+)"),
        "user_cpu_seconds": get(r"BENCH_USER_SEC=([0-9.]+)"),
        "sys_cpu_seconds": get(r"BENCH_SYS_SEC=([0-9.]+)"),
    }


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--postgis",type=Path,required=True)
    p.add_argument("--planetiler",type=Path,required=True)
    p.add_argument("--import-time",type=Path,required=True)
    p.add_argument("--render-time",type=Path,required=True)
    p.add_argument("--planet-time",type=Path,required=True)
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    im=time_stats(a.import_time)
    pg=time_stats(a.render_time)
    pl=time_stats(a.planet_time)
    report={
        "scope":"Seoul Gangnam/Samseong district bbox [127.015,37.485,127.075,37.535], z12-z15",
        "caveat":"18-layer Planetiler YAML is an APPROXIMATE match of osm2mbtiles 18-layer PostGIS SQL. Different feature counts/sizes mean time comparison is not a strict equal-output performance comparison.",
        "input":{"size_bytes":a.input.stat().st_size,"sha256":hashlib.sha256(a.input.read_bytes()).hexdigest()},
        "postgis":{"import":im,"tile_generation":pg,"total_wall_seconds":round(im["wall_seconds"]+pg["wall_seconds"],3) if im["wall_seconds"] is not None and pg["wall_seconds"] is not None else None,"output":mbtiles_stats(a.postgis)},
        "planetiler":{"end_to_end":pl,"output":mbtiles_stats(a.planetiler)},
        "memory_note":"GNU time max_rss of osm2pgsql and Python excludes PostgreSQL server RSS; NOT comparable to Java Planetiler max_rss as total memory.",
    }
    a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print("SEOUL_BENCHMARK_RESULT",json.dumps(report,ensure_ascii=False))
    print("POSTGIS_WALL_SECONDS",report["postgis"]["total_wall_seconds"])
    print("PLANETILER_WALL_SECONDS",pl["wall_seconds"])


if __name__=="__main__":
    main()
