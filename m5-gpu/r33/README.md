# M5 R33: Reusable Earcut/Tile Geometry Worker Pool (experimental)

Base: R30/R29 direct WebGL tile pipeline. **Default renderer unchanged.**

The complete, checksummed patch bundle for this round is named
`M5_R33_EARCUT_WORKER_POOL_2026-10-22.zip`
(SHA-256 `7b8c8e9732b4726686ccb3fd13db48a6e947b83a7f72b69937b480afb6f8e433`).
It is supplied as a downloadable ChatGPT conversation artifact. The branch documents
the experiment only; **the ZIP source has not been committed to this branch**.

## Status
- Node 22 verification: 16 tile/layer outputs, 48 GPU typed arrays byte-exact.
- Geometry/painter packets match the unmodified M5 CPU path.
- Reusable worker pool: 1/2/4 CPU ABBA benchmarking done; 2 workers preferred initially.
- Cache hit: no PBF decode or Earcut; cache is opt-in with an explicit versioned key.
- Browser Worker source & opt-in HTML path prepared but WebGL runtime not verified.
- Physical NVIDIA RTX cold 50% acceptance: **NOT PASSED / NOT MEASURED for R33**.
- OL relative allowed visual parity is unchanged.

## Run after applying the attached ZIP onto the matching R30 project
```sh
node tests/verify_r33_worker_pool.mjs
node tests/bench_r33_worker_pool.mjs
node tests/verify_direct_feature_webgl_pipeline.mjs
node tests/verify_round11_road_and_decode.mjs
node tests/verify_polygon_ol_cpu_pipeline.mjs
node tests/verify_round13_cpu_direct_ranges.mjs
```
Browser page query flags: `workerPool=off|cold|warm`,
`workerCount=1|2|4`, `workerCache=0|1` (cache requires warm).

Do not enable by default or claim GPU acceptance until an RTX A/B run
compares OL, unmodified M5 and R33 in crossed order and validates pixel output.
