# Seoul roadbed elevation experiment — same-input geometry A/B

Date: 2026-11-23 KST.
Branch: `experiment/seoul-grade-constrained-roadbed-20261123`.
Parent: `fix/seoul-road-render-shape-20261123`.

**Status: experimental numerical PASS; image and real elevation accuracy are separate gates. No merge to main.**

## Why we changed course

The preceding 2D road corner rounding and asphalt/curb polygon difference
removed planar overlap, but identical-camera SwiftShader screenshots
remained visually near-identical. Repeating offset/miter or planar union
edits would not address the core problem: road triangles shared exact
terrain heights, but the integrated roadbed could itself be implausibly
steep.

On the prior real Seoul geometry, the asphalt surface had 2.39% of its
area steeper than 20% and 0.416% steeper than 40%. The curb ring had
3.485% steeper than 20%.

## New method (visual prototype, not survey data)

- `geobench/roadbed_grade_solver.mjs`: apply maximum-grade projections
  to eight connected edges of the integrated terrain grid (cardinal +
  diagonal edges). Exclude non-at-grade bridges/tunnels by sampling
  the OSM grade `0||`. Diffuse only the height correction into a
  bounded 30m local shoulder so that terrain outside the shoulder
  is unchanged *relative to the old integrated roadbed*.
- `geobench/roadbed_terrain.mjs`: optional
  `gradeConstrained=true`, controlled by
  `GEO_ROAD_GRADE_RELAX=1` from `enhance.mjs`.
- `generate.mjs`, `enhance.mjs`: optional frozen OSM XML snapshot.
  Generate the original Terrarium fixture and OSM XML **once**, then
  run the baseline and variant from **identical input bytes**.
- `test_roadbed_grade_solver.mjs`: explicit height outlier to verify
  that the constraint really activates, plus unchanged far field.
- CI https://github.com/nssang00/chatgpt-write-test/actions/runs/45098519344
  passed unit tests, baseline and variant Seoul generation, 3D Tiles,
  exact terrain contact, and same-source numerical comparison.
- A/B screenshots CI
  https://github.com/nssang00/chatgpt-write-test/actions/runs/45098826675
  uses identical manifest focus and 3 camera modes. The capture source
  is **software Chromium SwiftShader**, not RTX 5060 Ti.

## Actual Seoul numbers (502 OSM road ways)

| Metric | Baseline integrated | New grade projection |
|---|---:|---:|
| Asphalt area slope >20% | 2.390637% | 0.039874% |
| Asphalt area slope >40% | 0.416049% | 0.004777% |
| Curb area slope >20% | 3.485255% | 0.189831% |
| Curb area slope >40% | 0.998175% | 0.023756% |
| Lane marking area slope >20% | 0.362288% | 0% |
| DEM cut maximum | 31.1489m | 32.1419m |
| DEM fill maximum | 25.0720m | 24.4754m |
| Roadbed contact error maximum | ~5e-9m | ~5e-9m |

Asphalt >20% and >40% slope area decreased by ~98.3% and ~98.9%.
The maximum cut increased ~0.99m, while maximum fill decreased ~0.60m.

The correction itself can be **10.50m at an individual vertex**.
The pairwise projection uses 50 passes, and does **not** enforce a
strict 12% cap everywhere: out of 72,458 constrained grid edges,
2,736 remain above 12%, and the maximum constrained-edge grade is
~20%. Never claim that the result is fully grade-limited, surveyed,
or civil-engineering compliant.

The `validate_road_grade_ab.mjs` quality-candidate flag is true only
for its declared tests (slope area improvement, geometric contact, and
no more than 3m extra *maximum* cut/fill). It does not certify accuracy.

## Known issues, decisions

- Both source DEM and OSM centerlines are approximate; a visually
  smoother fictional road can move terrain and buildings in ways that
  do not match Seoul. The **32m** maximum vertical earthwork is still
  unacceptable as a real topographic reconstruction.
- Projected grade control handles 8-neighbor grid edges, not all
  arbitrary road-polygon cross sections, and residual >12% mesh slopes
  remain.
- Bridge and tunnel `layer` tags are only *relative ordering*, not
  physical elevations.
- High-LOD triangle count remains larger than pre-rounded baseline;
  reducing low-LOD curb triangles does not guarantee better GPU FPS.
- All visual A/B comparisons must use the paired data artifacts from
  the same CI run, not the older live-source runs.

## Next if screenshots do not improve

1. Stop tweaking synthetic grade projections after one clear A/B.
2. Request/import NGII high-definition road mapping (3D lane and curb
   boundaries) and a corresponding source-verified DEM, checking
   licensing, coverage, accuracy and vertical datum beforehand.
3. Implement true topological carriageway faces and local shoulders
   using those source geometries; validate 3D point positions against
   held-out surveyed points and identical-camera screenshots.
4. Do not infer correct street elevation from a pretty screenshot.

Authoritative catalog links, **not yet obtained or ingested**:
- NGII HD road 3D vector mapping:
  https://www.data.go.kr/data/15059912/fileData.do
- NGII DEM:
  https://www.data.go.kr/data/15059920/fileData.do
- Seoul S-Map viewer (visual reference only, not a license for raw data):
  https://smap.seoul.go.kr/

Source catalog says the road vector/pointcloud downloads normally
require login and a large-file transfer client. Neither an official
NGII SHP nor a surveyed road DEM is present in this experiment.

## Frozen-source screenshot A/B: actual results

Workflow **success**:
https://github.com/nssang00/chatgpt-write-test/actions/runs/45098826675

Artifact: `seoul-grade-constraint-controlled-screenshots`.
Six 1280x720 source images: `grade-baseline-{top,oblique,low}.png`
and `grade-constrained-{top,oblique,low}.png`; paired images
`grade-ab-comparison-{top,oblique,low}.png`. Report:
`grade-ab-image-metrics.json`.

| Camera | Mean abs RGB difference, 0-255 | Pixels delta >15 |
| --- | ---: | ---: |
| Junction top | 1.64525 | 5.41% |
| Junction oblique | 1.99530 | 6.35% |
| Low roadside | 1.88474 | 6.24% |

Exact same original DEM / OSM XML, fixed Cesium camera, same
software Chromium SwiftShader. The screenshot CI loaded 81/81
GLBs with 0 HTTP, console or tile errors in the final camera run.

**Visual verdict:** The variant is not identical; rendered road edges and
adjacent terrain move, but the representative screenshots remain broadly
similar and show no unmistakable large-scale improvement in the natural
road silhouette. The 98% reduction in steep triangle area is a valid
numeric result, NOT proof that the current 3D city is surveyed or
visually satisfactory. The feature stays opt-in experimental, without
merging to `main`.

Do not keep tweaking the OSM miter/curb renderer as a substitute for
real street elevations. The next work should be a survey-source data
ingestion branch, and an actual road/curb/parcel transition design
using verified 3D features. NGII HD road mapping download requires
portal login and may need bulk-transfer software; it was not
downloaded here.
