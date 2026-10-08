import {writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import raw from './runner.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, 'results');

const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const average = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const p95 = (values) => {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)];
};
const mib = (bytes) => bytes / 1024 / 1024;

function summarize(runs) {
  return {
    initialMs: median(runs.map((r) => r.initialMs)),
    navMeanMs: median(runs.map((r) => average(r.navigationMs))),
    navP95Ms: median(runs.map((r) => p95(r.navigationMs))),
    taskMs: median(runs.map((r) => r.taskDurationMs)),
    scriptMs: median(runs.map((r) => r.scriptDurationMs)),
    retainedHeapMiB: median(runs.map((r) => mib(r.retainedHeapBytes))),
    peakHeapMiB: median(runs.map((r) => mib(r.peakHeapBytes))),
    domNodes: median(runs.map((r) => r.domNodes)),
    tileLoads: median(runs.map((r) => r.tiles.loaded)),
    tileErrors: runs.reduce((n, r) => n + r.tiles.failed, 0),
    consoleErrors: runs.reduce((n, r) => n + r.errors.length, 0)
  };
}

const summary = {
  vector: summarize(raw.vector),
  webgl: summarize(raw.webgl)
};

function pct(webgl, vector) {
  return ((webgl - vector) / vector) * 100;
}
function f(n, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a';
}
function delta(metric) {
  return f(pct(summary.webgl[metric], summary.vector[metric])) + '%';
}

const gl = raw.webgl[0]?.webgl;
const report = `# OpenLayers 10.10.0 — MapTiler Planet v4 benchmark

Environment: GitHub Actions Ubuntu, Chromium/Playwright, 1280×720, 3 measured rounds after warm-up.

Both layers use the same OpenLayers 10.10.0 VectorTileSource, MapTiler Planet v4 MVT tiles, view sequence, and flat fill/stroke style. Lower values are better for time and memory metrics.

| Metric | VectorTileLayer | WebGLVectorTileLayer | WebGL vs Vector |
|---|---:|---:|---:|
| Initial render | ${f(summary.vector.initialMs)} ms | ${f(summary.webgl.initialMs)} ms | ${delta('initialMs')} |
| Navigation mean | ${f(summary.vector.navMeanMs)} ms | ${f(summary.webgl.navMeanMs)} ms | ${delta('navMeanMs')} |
| Navigation p95 | ${f(summary.vector.navP95Ms)} ms | ${f(summary.webgl.navP95Ms)} ms | ${delta('navP95Ms')} |
| Chromium task time | ${f(summary.vector.taskMs)} ms | ${f(summary.webgl.taskMs)} ms | ${delta('taskMs')} |
| Script time | ${f(summary.vector.scriptMs)} ms | ${f(summary.webgl.scriptMs)} ms | ${delta('scriptMs')} |
| Retained JS heap | ${f(summary.vector.retainedHeapMiB)} MiB | ${f(summary.webgl.retainedHeapMiB)} MiB | ${delta('retainedHeapMiB')} |
| Peak JS heap | ${f(summary.vector.peakHeapMiB)} MiB | ${f(summary.webgl.peakHeapMiB)} MiB | ${delta('peakHeapMiB')} |
| DOM nodes | ${f(summary.vector.domNodes, 0)} | ${f(summary.webgl.domNodes, 0)} | ${delta('domNodes')} |
| Tiles loaded during route | ${f(summary.vector.tileLoads, 0)} | ${f(summary.webgl.tileLoads, 0)} | — |

WebGL renderer: ${gl ? gl.vendor + ' / ' + gl.renderer : 'not reported'}

Local MapTiler proxy cache: ${raw.serverCache.hits} hits, ${raw.serverCache.misses} misses, ${f(raw.serverCache.bytes / 1024 / 1024)} MiB fetched from MapTiler.

Notes:
- Warm-up populates the local tile proxy cache before recorded rounds, reducing CDN/network variance.
- JS heap is Chromium renderer JavaScript heap, not total GPU memory.
- GitHub-hosted Chromium may use software WebGL, so these numbers are CI regression/comparison data rather than a desktop-GPU benchmark.
`;

await writeFile(join(outDir, 'raw.json'), JSON.stringify({raw, summary}, null, 2));
await writeFile(join(outDir, 'report.md'), report);
console.log(report);

const failures =
  summary.vector.tileErrors +
  summary.webgl.tileErrors +
  summary.vector.consoleErrors +
  summary.webgl.consoleErrors;
if (failures) {
  console.error('Benchmark completed with ' + failures + ' tile/browser errors.');
  process.exitCode = 1;
}
