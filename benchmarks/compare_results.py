#!/usr/bin/env python3
"""Combine timings and layer validation; no dependencies."""
import json
from pathlib import Path
from statistics import median

root = Path("metrics")
lines = ["# Repeat benchmark: Planetiler vs tilemaker", "",
         "The **controlled** experiment is the primary apples-to-apples approximation.",
         "The **full** experiment intentionally runs the tools' DIFFERENT default map schemas.",
         "Both use the exact same Geofabrik PBF; the download, build, and source prefetch are excluded.",
         "The two engines still have different geometry construction, clipping, simplification",
         "and tile output implementations. Comparing per-layer feature counts helps detect",
         "substantial mismatches, but does not prove geometrical equivalence.", ""]

for mode in ("controlled", "full"):
    folder = root / mode
    recordings = {}
    layers = {}
    for tool in ("planetiler", "tilemaker"):
        recordings[tool] = [
            json.loads(p.read_text()) for p in sorted(folder.glob(tool + "-[0-9]*.json"))
        ]
        layers[tool] = [
            json.loads(p.read_text()) for p in sorted(folder.glob("layers-" + tool + "-*.json"))
        ]
    lines += [f"## {mode.title()} experiment", "",
              "| Metric | Planetiler | tilemaker |",
              "|---|---:|---:|"]
    if not all(recordings.values()):
        lines.append("| Status | incomplete | incomplete |")
        continue
    def med(tool, key):
        return median(item[key] for item in recordings[tool])
    for key, description, fmt in [
        ("wall_seconds", "Median wall time (seconds)", ".2f"),
        ("user_seconds", "Median user CPU time (seconds)", ".2f"),
        ("peak_rss_mib", "Median peak RSS (MiB)", ".1f"),
        ("file_bytes", "Median MBTiles (MiB)", ".2f"),
        ("tile_count", "Median tile count", ".0f"),
    ]:
        val = lambda tool: med(tool, key) / (1048576 if key == "file_bytes" else 1)
        lines.append(f"| {description} | {val('planetiler'):{fmt}} | {val('tilemaker'):{fmt}} |")
    speed_ratio = med("planetiler", "wall_seconds") / med("tilemaker", "wall_seconds")
    lines += ["", f"Median wall time ratio (Planetiler / tilemaker): **{speed_ratio:.2f}×**.",
              "Lower is better for time, memory and bytes, but output coverage must be considered.",
              ""]
    if mode == "controlled":
        lines.extend([
            "### z14 layer feature counts (tiles can repeat clipped features)",
            "",
            "| Layer | Planetiler median | tilemaker median | Relative difference |",
            "|---|---:|---:|---:|",
        ])
        unmatched = []
        for layer in ("roads", "buildings"):
            def count(tool):
                values = [x["zoom_layers"].get("14", {}).get(layer, {}).get("features", 0)
                          for x in layers[tool]]
                return median(values) if values else 0
            a, b = count("planetiler"), count("tilemaker")
            diff = abs(a - b) / max(a, b, 1) * 100
            lines.append(f"| {layer} | {a:,.0f} | {b:,.0f} | {diff:.1f}% |")
            if diff > 5:
                unmatched.append(layer)
        lines.append("")
        if unmatched:
            lines += [
                "**Output-parity warning:** feature counts differ by more than 5% "
                "on " + ", ".join(unmatched) + ".",
                "Do not present this controlled run as equivalent-output throughput.",
            ]
        else:
            lines += [
                "**Feature-count sanity check:** both z14 layer counts are within 5%.",
                "This is only a count check, not equality of geometry or attributes.",
            ]
        lines.append("")
    else:
        lines.extend([
            "**Not output-equivalent:** default profiles, auxiliary layers, zoom policies,",
            "attributes, multipolygon handling and tile generalization differ.",
            "These results measure practical out-of-box performance only, not an engine speedup.",
            "",
        ])
    lines.extend([f"Detailed per-round timing: \`metrics/{mode}/runs.csv\`.",
                  f"Detailed geometry counts: \`metrics/{mode}/layers-*.json\`.",
                  ""])
text = "\n".join(lines) + "\n"
(root / "comparison.md").write_text(text, encoding="utf-8")
print(text)
