# Geo DevTools — isolated GitHub Actions sandbox

**New default (2026-10-12):** URL-only basic scanner in `source.zip` under `scripts/geo_doctor_scan.py`; zero app source changes. Produces sanitized JSON + HTML report. Real OpenLayers 404 tile + healthy controls are in `tests/zero_touch_e2e.py`. See `docs/ZERO_TOUCH_STRATEGY.md` inside ZIP. Runtime adapter remains optional.\n\n**Isolation:** All Geo DevTools test sources are under `sandbox/geo-devtools-ci/` and this single workflow exists only on branch `sandbox/geo-devtools-ci-20261012`.
NativeWeb source, existing workflows and default `main` branch are unchanged. Do not merge this branch into `main`.

## Contents
- `source.zip`: Geo DevTools v0.2 JS, MVT parser, unit tests and browser tests. The action extracts it into this directory's `project/` (runner only).
- `.github/workflows/geo-devtools-sandbox.yml`: workflow scoped to this sandbox branch.

## Tests and artifacts
- `npm test`: unit tests and real OL class API integration.
- `tests/visual_e2e.py`: Chromium UI DOM behavior with OpenLayers-like mocks, seven PNG screenshots.
- `tests/real_ol_e2e.py`: actual `ol/Map` in Chromium, screenshots and Playwright trace.
- Artifacts: `geo-devtools-sandbox-evidence` (14 days).

**Limits:** UI mock tests are separate from true `ol/Map` browser integration. Download runner artifacts to inspect screenshots. CI execution is required to claim the real OpenLayers E2E is verified.

To rerun: push a commit to this sandbox branch or run the workflow via the Actions UI if GitHub exposes workflow dispatch for it.
