#!/usr/bin/env python3
"""Read-only MBTiles XYZ tile server. No remote tile requests during measured runs."""
import gzip
import json
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

DB_PATH = Path(sys.argv[1]).resolve()
THREAD_LOCAL = threading.local()

def db():
    if not hasattr(THREAD_LOCAL, "conn"):
        THREAD_LOCAL.conn = sqlite3.connect(f"file:{DB_PATH.as_posix()}?mode=ro", uri=True, check_same_thread=False)
    return THREAD_LOCAL.conn

def metadata():
    d = {k: v for k, v in db().execute("SELECT name,value FROM metadata")}
    parsed = {}
    if "json" in d:
        try: parsed = json.loads(d["json"])
        except (ValueError, TypeError): pass
    return {
        "minzoom": int(d.get("minzoom", "12")),
        "maxzoom": int(d.get("maxzoom", "16")),
        "bounds": d.get("bounds"),
        "vector_layers": parsed.get("vector_layers", []),
        "tileCount": db().execute("SELECT count(*) FROM tiles").fetchone()[0],
        "name": d.get("name", "")
    }

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        p = urlsplit(self.path).path
        if p == "/health":
            data = json.dumps(metadata()).encode()
            return self.reply(200, "application/json", data)
        if p.startswith("/tiles/") and p.endswith(".pbf"):
            s = p.removeprefix("/tiles/").removesuffix(".pbf").split("/")
            if len(s) != 3:
                return self.reply(400, "text/plain", b"bad tile path")
            try:
                z, x, y = (int(q) for q in s)
                if z < 0 or z > 20 or x < 0 or y < 0 or x >= 2**z or y >= 2**z:
                    raise ValueError("out of range")
            except ValueError:
                return self.reply(400, "text/plain", b"invalid coordinates")
            tms = 2**z - 1 - y
            row = db().execute("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?", (z, x, tms)).fetchone()
            if not row:
                return self.reply(204, "application/x-protobuf", b"")
            data = bytes(row[0])
            encoding = "gzip" if data[:2] == b"\x1f\x8b" else None
            return self.reply(200, "application/x-protobuf", data, encoding)
        return self.reply(404, "text/plain", b"not found")

    def reply(self, status, mime, body, encoding=None):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        if encoding: self.send_header("Content-Encoding", encoding)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body: self.wfile.write(body)

    def log_message(self, fmt, *args):
        if args and str(args[1] if len(args) > 1 else "") not in ("200", "204"):
            super().log_message(fmt, *args)

if __name__ == "__main__":
    if not DB_PATH.is_file(): raise SystemExit(f"Missing MBTiles: {DB_PATH}")
    print("MBTILES_HEALTH " + json.dumps(metadata(), ensure_ascii=False), flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8787), Handler).serve_forever()
