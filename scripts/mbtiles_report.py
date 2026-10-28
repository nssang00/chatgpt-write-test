#!/usr/bin/env python3
"""Collect benchmark timings and MBTiles statistics; only Python stdlib required."""
import argparse
import csv
import json
from pathlib import Path
import sqlite3
import statistics


def read_timing(path):
    values = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return {
        "wall_seconds": float(values["wall_seconds"]),
        "user_seconds": float(values["user_seconds"]),
        "system_seconds": float(values["system_seconds"]),
        "peak_rss_mib": int(values["peak_rss_kb"]) / 1024,
        "exit_code": int(values.get("exit_code", -1)),
    }


def record(args):
    output = Path(args.mbtiles)
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError("Missing or empty MBTiles: " + str(output))
    timing = read_timing(args.time)
    if timing["exit_code"] != 0:
        raise RuntimeError("Conversion failed: " + str(timing["exit_code"]))
    with sqlite3.connect("file:" + str(output.resolve()) + "?mode=ro", uri=True) as db:
        zooms = [
            {"zoom": int(z), "tiles": int(n), "payload_bytes": int(size or 0)}
            for z, n, size in db.execute(
                "SELECT zoom_level, COUNT(*), SUM(LENGTH(tile_data)) "
                "FROM tiles GROUP BY zoom_level ORDER BY zoom_level"
            )
        ]
    if not zooms:
        raise RuntimeError("MBTiles has no tiles: " + str(output))
    result = {
        "tool": args.tool, "round": args.round, **timing,
        "file_bytes": output.stat().st_size,
        "tile_count": sum(item["tiles"] for item in zooms),
        "per_zoom": zooms,
    }
    dest = Path(args.dir)
    dest.mkdir(parents=True, exist_ok=True)
    (dest / (args.tool + "-" + str(args.round) + ".json")).write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    print("Recorded", args.tool, args.round, result["wall_seconds"], "seconds")


def summarize(args):
    dest = Path(args.dir)
    dest.mkdir(parents=True, exist_ok=True)
    runs = []
    for name in ("planetiler", "tilemaker"):
        for path in sorted(dest.glob(name + "-*.json")):
            runs.append(json.loads(path.read_text(encoding="utf-8")))
    groups = {name: [row for row in runs if row["tool"] == name]
              for name in ("planetiler", "tilemaker")}
    sha_file = dest / "pbf-sha256.txt"
    digest = sha_file.read_text().split()[0] if sha_file.is_file() else "not available"
    lines = [
        "# Planetiler vs tilemaker: PBF to MBTiles", "",
        "- Input: " + args.pbf,
        "- SHA-256: " + digest,
        "- Planetiler: " + args.planetiler_version,
        "- tilemaker: " + args.tilemaker_version,
        "- Runner logical CPUs: " + args.cpu_count,
        "- Timed sections exclude downloads, dependency setup and compilation.",
        "- This measures end-to-end conversion, not isolated JTS / Boost.Geometry.",
        "",
        "| Engine | Runs | Median wall (s) | Median peak RSS (MiB) | Median MBTiles (MiB) | Median tile count |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for name, values in groups.items():
        if not values:
            lines.append("| " + name + " | 0 | n/a | n/a | n/a | n/a |")
            continue
        med = lambda field: statistics.median(row[field] for row in values)
        lines.append(
            f"| {name} | {len(values)} | {med('wall_seconds'):.2f} | "
            f"{med('peak_rss_mib'):.1f} | {med('file_bytes')/1048576:.2f} | "
            f"{med('tile_count'):,.0f} |"
        )
    lines.extend([
        "", "## Individual runs", "",
        "| Engine | Round | Wall (s) | User CPU (s) | System CPU (s) | Peak RSS (MiB) | MBTiles (MiB) | Tiles |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for row in runs:
        lines.append(
            f"| {row['tool']} | {row['round']} | {row['wall_seconds']:.2f} | "
            f"{row['user_seconds']:.2f} | {row['system_seconds']:.2f} | "
            f"{row['peak_rss_mib']:.1f} | {row['file_bytes']/1048576:.2f} | "
            f"{row['tile_count']:,} |"
        )
    lines.extend([
        "", "## Interpretation", "",
        "The default configurations differ in feature selection, layer rules, "
        "supplementary datasets and simplification. A faster or smaller output "
        "does not imply equivalent map coverage or fidelity.",
        "RSS does not include all filesystem cache and may not capture every child process.",
        "Repeat measurements on the same runner class and inspect per-zoom data.",
    ])
    (dest / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    with (dest / "runs.csv").open("w", newline="", encoding="utf-8") as out:
        fields = ["tool", "round", "wall_seconds", "user_seconds",
                  "system_seconds", "peak_rss_mib", "file_bytes", "tile_count"]
        writer = csv.DictWriter(out, fieldnames=fields)
        writer.writeheader()
        for row in runs:
            writer.writerow({key: row[key] for key in fields})
    with (dest / "zoom_stats.csv").open("w", newline="", encoding="utf-8") as out:
        writer = csv.DictWriter(out, fieldnames=["tool", "round", "zoom", "tiles", "payload_bytes"])
        writer.writeheader()
        for row in runs:
            for zoom in row["per_zoom"]:
                writer.writerow({"tool": row["tool"], "round": row["round"], **zoom})
    print("\n".join(lines))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    rec = sub.add_parser("record")
    rec.add_argument("--tool", required=True, choices=("planetiler", "tilemaker"))
    rec.add_argument("--round", required=True, type=int)
    rec.add_argument("--time", required=True)
    rec.add_argument("--mbtiles", required=True)
    rec.add_argument("--dir", required=True)
    report = sub.add_parser("summarize")
    report.add_argument("--dir", required=True)
    report.add_argument("--pbf", required=True)
    report.add_argument("--planetiler-version", required=True)
    report.add_argument("--tilemaker-version", required=True)
    report.add_argument("--cpu-count", required=True)
    options = parser.parse_args()
    {"record": record, "summarize": summarize}[options.command](options)
