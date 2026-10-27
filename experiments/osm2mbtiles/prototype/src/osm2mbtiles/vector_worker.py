"""Directly executed under the WSL interpreter with system psycopg2."""
import json
import sys
from pathlib import Path
from osm2mbtiles.vector import export

if __name__ == '__main__':
    job = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    export(Path(job['pbf']),Path(job['output']),tuple(job['bbox']),
           int(job['minzoom']),int(job['maxzoom']),int(job['processes']))