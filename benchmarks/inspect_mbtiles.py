#!/usr/bin/env python3
"""Read MVT feature counts directly from MBTiles (stdlib-only protobuf wire reader)."""
import argparse
from collections import Counter, defaultdict
import gzip
import json
from pathlib import Path
import sqlite3


def varint(data, pos):
    value = 0
    for shift in range(0, 70, 7):
        if pos >= len(data):
            raise ValueError("Unexpected EOF in protobuf")
        b = data[pos]
        pos += 1
        value |= (b & 0x7f) << shift
        if not b & 0x80:
            return value, pos
    raise ValueError("Malformed protobuf varint")


def fields(data):
    pos = 0
    while pos < len(data):
        tag, pos = varint(data, pos)
        field_no, wire_type = tag >> 3, tag & 7
        if wire_type == 0:
            val, pos = varint(data, pos)
        elif wire_type == 1:
            val = data[pos:pos + 8]
            pos += 8
        elif wire_type == 2:
            size, pos = varint(data, pos)
            val = data[pos:pos + size]
            pos += size
        elif wire_type == 5:
            val = data[pos:pos + 4]
            pos += 4
        else:
            raise ValueError("Unsupported protobuf wire type: " + str(wire_type))
        if pos > len(data):
            raise ValueError("Protobuf field past EOF")
        yield field_no, val


def mvt_layers(buf):
    if buf[:2] == b"\x1f\x8b":
        buf = gzip.decompress(buf)
    for field, layer in fields(buf):
        if field != 3:
            continue
        name, types = None, Counter()
        for inner, value in fields(layer):
            if inner == 1:
                name = value.decode("utf-8")
            elif inner == 2:
                geometry = 0
                for f, v in fields(value):
                    if f == 3:
                        geometry = v
                        break
                types[{1: "point", 2: "line", 3: "polygon"}.get(geometry, "unknown")] += 1
        if name is not None:
            yield name, types


def inspect(args):
    mbtiles = Path(args.mbtiles)
    if not mbtiles.is_file():
        raise FileNotFoundError(mbtiles)
    by_zoom = defaultdict(lambda: defaultdict(Counter))
    with sqlite3.connect("file:" + str(mbtiles.resolve()) + "?mode=ro", uri=True) as db:
        for z, blob in db.execute("SELECT zoom_level, tile_data FROM tiles"):
            for name, geom_counts in mvt_layers(blob):
                by_zoom[int(z)][name].update(geom_counts)
    if not by_zoom:
        raise RuntimeError("No MVT features decoded from " + str(mbtiles))
    stats = {
        "mode": args.mode,
        "tool": args.tool,
        "round": args.round,
        "zoom_layers": {
            str(z): {
                layer: {"features": sum(c.values()), **dict(sorted(c.items()))}
                for layer, c in sorted(layers.items())
            }
            for z, layers in sorted(by_zoom.items())
        },
    }
    if args.mode == "controlled":
        if set(by_zoom) != {14}:
            raise RuntimeError("Controlled benchmark must only emit zoom=14")
        names = set(by_zoom[14])
        if names != {"roads", "buildings"}:
            raise RuntimeError(f"Expected road/building layers, found {names}")
        if min(sum(by_zoom[14][name].values()) for name in names) < 1:
            raise RuntimeError("Empty controlled layer!")
    dest = Path(args.dir)
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f"{args.tool}-{args.round}-layers.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("VALIDATED", args.mode, args.tool, args.round, json.dumps(stats["zoom_layers"].get("14", {})))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["controlled", "full"])
    parser.add_argument("--tool", required=True, choices=["planetiler", "tilemaker"])
    parser.add_argument("--round", type=int, required=True)
    parser.add_argument("--mbtiles", required=True)
    parser.add_argument("--dir", required=True)
    inspect(parser.parse_args())
