# Geo DevTools: Node.js-only isolated GitHub Actions

**Isolation:** Never merge this branch into NativeWeb `main`. All Geo DevTools code stays in `sandbox/geo-devtools-ci/source.zip`; only this test workflow lives in `.github/workflows/` on the sandbox branch.

Run `npm test` and `npm run test:e2e` inside the unzipped source. No Python setup is used by the workflow.

Basic scanner: `node bin/geo-doctor.js scan http://localhost:5173 --output geo-doctor-report.json`.

Report: status codes and hostnames only, no request URLs, query params, response bodies, or console messages. Screenshots are explicit opt-in.

Artifact: `geo-devtools-node-playwright-evidence` includes PNG screenshots and Playwright traces. Real OpenLayers tests cover both optional runtime connection and zero-touch HTTP 404 detection.

Scope limitation: this run is a controlled local fixture, **not** a broad real-world detection accuracy evaluation.