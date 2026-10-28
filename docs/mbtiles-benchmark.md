# Planetiler vs tilemaker: Geofabrik PBF → MBTiles benchmark

This independent benchmark is run by GitHub Actions. It does not change NativeWeb build steps.

- Opening or updating the PR with workflow-file changes triggers a one-round Luxembourg smoke benchmark.
- After merging the workflow to main, open **Actions → Geofabrik PBF to MBTiles Benchmark → Run workflow** to choose the dataset and 1–3 rounds.
- Defaults: `europe/luxembourg` / `luxembourg`. South Korea: `asia/south-korea` / `south-korea` (start with one round and a larger runner).
- Planetiler 0.10.2 (Java 25) and tilemaker v3.2.0 (C++), both pinned.
- One downloaded PBF is hashed and reused by both programs.
- Downloads, building tilemaker, installing packages, and fetching auxiliary datasets happen **outside** the timed portions.
- Repeat order alternates; each run produces fresh MBTiles.
- Outputs: Actions Job Summary, `mbtiles-benchmark-report` artifact containing `summary.md`, `runs.csv`, `zoom_stats.csv`, per-run JSON and input SHA-256. MBTiles themselves are not uploaded.

## Validity notes

This compares whole conversion pipelines, **not** isolated JTS/Boost.Geometry operations.
Default OpenMapTiles-compatible profiles are not identical: source datasets, layers,
feature filters, geometry generalization and attributes may differ. Therefore wall time,
tile count and output size should be interpreted together, not as a strict speedup for
equivalent output. The run does not measure visual fidelity or decoded feature equality.

Hosted runners have limited RAM and SSD. Full South Korea may exceed their limits.
The build has only been statically/synthetically checked until an Actions run completes.
