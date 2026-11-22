# Seoul OSM 3D tag usage — actual coverage and visual preview

Date: 2026-11-23 KST. Branch: `fix/seoul-osm-3d-tags-20261123`.
Parent: `fix/seoul-road-roadbed-integrated-20261120`. No merge to main.

## Goal

Use available OSM 3D building tags rather than inventing height/roof data,
while retaining the existing integrated roadbed and Cesium native 3D Tiles.
Do not treat sparse OSM tags as a surveyed elevation data set.

## Implemented

- `geobench/osm_3d_buildings.mjs`: parse metres (including explicit feet),
  prefer `height` for overall roof-inclusive height; use `building:levels`
  for storeys, fall back to inferred floors only when no tag is present.
  Interpret `min_height`/`building:min_level`; support flat, gabled, hipped
  and pyramidal roof shapes on approximately rectangular footprints, with
  explicit vs estimated roof heights distinguished.
- `geobench/enhance.mjs`: apply those tags to generated building walls,
  floors, roofs and equipment; retain the integrated roadbed. Count available
  `start_date`, `name`, `building:part`, and road `incline`/`ele` tags.
  No automatic raw `ele` import without vertical datum reconciliation, and
  no fake asphalt grade derived from `incline=up/down`.
- `geobench/test_osm_3d_tags.mjs` and
  `geobench/validate_osm_3d_tags.mjs`: unit tests and actual geographic
  coverage report.
- `.github/workflows/geo-osm-3d-tags.yml`: synthetic tests, real Seoul
  build and RTX screenshot jobs.
- `.github/workflows/geo-osm-3d-cpu-preview.yml`: captures close/overview/
  low-angle screenshots using Google SwiftShader on GitHub-hosted Ubuntu,
  with exact GLB data artifact from the primary workflow. These are
  **software renders, not RTX**.

## Real Seoul tag coverage

CI run: https://github.com/nssang00/chatgpt-write-test/actions/runs/45068245995
Artifact: `seoul-osm-3d-tags-report`.

| Field | Count |
| --- | ---: |
| OSM building footprints | 2,085 |
| height present | 254 |
| building:levels present | 271 |
| height inferred (no usable height/levels) | 1,813 |
| roof:shape present | **0** |
| nonflat OSM roof rendered | **0** |
| min_height / building:min_level present | **0** |
| named building ways | 68 |
| start_date present | 268 |
| building:part found (separate) | 0 |
| road ways | 502 |
| numeric incline | 0 |
| textual incline | 6 |
| OSM nodes with numeric ele | 0 |

The number of height and level tags includes overlapping buildings. In
particular, the 254 and 271 counts cannot be added to determine the number
of uniquely covered buildings.

**Important:** No new sloping roof or elevated base can appear in this
current test area because those OSM tags do not exist. The meaningful
visual change can come from choosing separately tagged `building:levels`
for facade window rows even where `height` also exists.

## Geometry and screenshots

- All existing road/roadbed regression tests and new OSM 3D building tag
  tests passed in run `45068245995`.
- Full Seoul native 3D Tiles packaged successfully.
- High-LOD triangles: before **2,600,341** -> after **2,507,757**.
  Low-LOD triangles stayed **984,531**. The difference is primarily in
  procedurally generated facade/window details, not surveyed new roof data.
- Software screenshot CI:
  https://github.com/nssang00/chatgpt-write-test/actions/runs/45068590955
  (success, artifact `seoul-osm-3d-tags-cpu-preview`).
  Chrome ANGLE / Vulkan SwiftShader; latest low-angle load: **81/81 GLBs,
  zero errors**, 98 rendered frames.
- The original baseline uses real RTX 5060 Ti:
  https://github.com/nssang00/chatgpt-write-test/actions/runs/44746059903
  The CPU screenshots are useful for visual inspection but do **not**
  constitute a perfectly controlled pixel-for-pixel RTX A/B test.
- Primary RTX run `45068245995` is queued for self-hosted
  `[self-hosted, Windows, X64, m5-gpu]` at the time of writing.
  Re-check status/artifacts before declaring real GPU success.

## Verdict / limitations

Building provenance/tag interpretation is improved; *real* OSM coverage is
too sparse to materially improve roof silhouette in the chosen area.
The 2D OSM road joins and speculative Terrarium-based roadbed still have
visual and topographic accuracy limitations. Current data includes no
numeric road incline/elevation tags, so importing OSM 3D tags cannot
resolve the road flatness issue by itself.

We must not present workflow success as proof of citywide 3D accuracy.
For more realistic Seoul buildings and road grade, obtain trustworthy
survey-grade footprint/height/roof geometry and road vertical alignment
with licensed/source-attributed elevation data; then verify both image
quality and deformation/performance costs on fixed inputs.
