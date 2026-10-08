import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(root, 'results-scale');
await mkdir(resultsDir, {recursive: true});
await copyFile(join(root, 'app-scale.js'), join(root, 'app.js'));

const {startServer} = await import('./server.mjs');
const server = await startServer();
const baseUrl = 'http://127.0.0.1:' + server.port;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-precise-memory-info', '--enable-unsafe-swiftshader']
});

const counts = [1, 5, 10, 20, 30, 40, 50];
const route = [
  [126.9780, 37.5665, 13],
  [127.0276, 37.4979, 14],
  [126.9237, 37.5563, 14],
  [127.1058, 37.5145, 13]
];

const metricMap = (metrics) => Object.fromEntries(metrics.map((m) => [m.name, m.value]));
const mib = (bytes) => bytes / 1024 / 1024;
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const max = (values) => Math.max(...values);
const pct = (a, b) => ((a - b) / b) * 100;

async function runConfig(renderer, layerCount, screenshot = false) {
  const context = await browser.newContext({
    viewport: {width: 1280, height: 720},
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  const t0 = Date.now();
  await page.goto(baseUrl + '/?renderer=' + renderer + '&layers=' + layerCount, {
    waitUntil: 'load',
    timeout: 30000
  });
  await page.waitForFunction(() => globalThis.olScaleBench?.map, null, {timeout: 30000});
  const initial = await page.evaluate(() => globalThis.olScaleBench.waitIdle());

  await cdp.send('HeapProfiler.collectGarbage');
  const before = metricMap((await cdp.send('Performance.getMetrics')).metrics);

  const scenario = await page.evaluate(async (steps) => {
    const bench = globalThis.olScaleBench;
    const durations = [];
    const heap = [];
    const timeouts = [];

    for (const [lon, lat, zoom] of steps) {
      bench.map.getView().setCenter(bench.fromLonLat([lon, lat]));
      bench.map.getView().setZoom(zoom);
      const result = await bench.waitIdle();
      durations.push(result.elapsedMs);
      timeouts.push(result.timedOut);
      heap.push(performance.memory?.usedJSHeapSize ?? null);
    }

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');

    return {
      durations,
      heap,
      timeouts,
      stats: {...bench.stats},
      sourceLayers: bench.sourceLayerNames,
      webgl: gl ? {
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      } : null
    };
  }, route);

  const afterBeforeGc = metricMap((await cdp.send('Performance.getMetrics')).metrics);
  await cdp.send('HeapProfiler.collectGarbage');
  const afterGc = metricMap((await cdp.send('Performance.getMetrics')).metrics);
  const dom = await cdp.send('Memory.getDOMCounters');

  if (screenshot) {
    await page.screenshot({
      path: join(resultsDir, renderer + '-' + layerCount + '-layers.png')
    });
  }

  await context.close();

  return {
    renderer,
    layerCount,
    initialMs: initial.elapsedMs,
    initialTimedOut: initial.timedOut,
    navMeanMs: mean(scenario.durations),
    navMaxMs: max(scenario.durations),
    taskMs: ((afterBeforeGc.TaskDuration || 0) - (before.TaskDuration || 0)) * 1000,
    scriptMs: ((afterBeforeGc.ScriptDuration || 0) - (before.ScriptDuration || 0)) * 1000,
    retainedHeapMiB: mib(afterGc.JSHeapUsedSize || 0),
    peakHeapMiB: mib(max(scenario.heap.filter(Number.isFinite))),
    domNodes: dom.nodes,
    tileLoads: scenario.stats.loaded,
    tileErrors: scenario.stats.errors,
    timedOutMoves: scenario.timeouts.filter(Boolean).length,
    wallMs: Date.now() - t0,
    errors,
    webgl: scenario.webgl,
    sourceLayers: scenario.sourceLayers
  };
}

const warmup = await runConfig('canvas', 1, false);
const results = [];

try {
  for (const layerCount of counts) {
    results.push(await runConfig('canvas', layerCount, layerCount === 50));
    results.push(await runConfig('webgl', layerCount, layerCount === 50));
  }
} finally {
  await browser.close();
  await server.close();
}

const rows = counts.map((layerCount) => {
  const canvas = results.find((r) => r.renderer === 'canvas' && r.layerCount === layerCount);
  const webgl = results.find((r) => r.renderer === 'webgl' && r.layerCount === layerCount);
  return {
    layerCount,
    canvas,
    webgl,
    navDeltaPct: pct(webgl.navMeanMs, canvas.navMeanMs),
    heapDeltaPct: pct(webgl.retainedHeapMiB, canvas.retainedHeapMiB),
    taskDeltaPct: pct(webgl.taskMs, canvas.taskMs)
  };
});

const f = (n, d = 1) => Number.isFinite(n) ? n.toFixed(d) : 'n/a';
const reportLines = [
  '# OpenLayers 10.10.0 layer scaling benchmark',
  '',
  'MapTiler Planet v4, GitHub Actions Ubuntu, Chromium/Playwright, 1280x720.',
  'Each logical layer has its own VectorTileSource with MVT({layers:[sourceLayer]}).',
  'MapTiler network bytes are cached by a local proxy after warm-up.',
  '',
  '| Layers | Canvas nav mean | WebGL nav mean | WebGL delta | Canvas task | WebGL task | Canvas retained heap | WebGL retained heap |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|'
];

for (const row of rows) {
  reportLines.push(
    '| ' + row.layerCount +
    ' | ' + f(row.canvas.navMeanMs) + ' ms' +
    ' | ' + f(row.webgl.navMeanMs) + ' ms' +
    ' | ' + f(row.navDeltaPct) + '%' +
    ' | ' + f(row.canvas.taskMs) + ' ms' +
    ' | ' + f(row.webgl.taskMs) + ' ms' +
    ' | ' + f(row.canvas.retainedHeapMiB) + ' MiB' +
    ' | ' + f(row.webgl.retainedHeapMiB) + ' MiB |'
  );
}

const gl = results.find((r) => r.renderer === 'webgl')?.webgl;
reportLines.push(
  '',
  'WebGL renderer: ' + (gl ? gl.vendor + ' / ' + gl.renderer : 'not reported'),
  '',
  'Local proxy cache: ' + server.stats.hits + ' hits, ' + server.stats.misses +
    ' misses, ' + f(server.stats.bytes / 1024 / 1024) + ' MiB fetched from MapTiler.',
  '',
  'Warm-up: canvas / 1 layer, ' + f(warmup.navMeanMs) + ' ms navigation mean.',
  '',
  'Notes:',
  '- Lower times and memory are better.',
  '- JS heap excludes GPU/native memory.',
  '- GitHub-hosted Chromium uses SwiftShader when no hardware GPU is exposed.',
  '- This benchmark intentionally includes per-layer MVT decode/cache overhead because each MapTiler source layer is represented as an independent OpenLayers layer.'
);

const report = reportLines.join('\n') + '\n';
await writeFile(join(resultsDir, 'raw.json'), JSON.stringify({counts, warmup, results, rows, proxy: server.stats}, null, 2));
await writeFile(join(resultsDir, 'report.md'), report);
console.log(report);

const fatalErrors = results.flatMap((r) => r.errors);
const tileErrors = results.reduce((sum, r) => sum + r.tileErrors, 0);
if (fatalErrors.length || tileErrors) {
  console.error('Browser errors:', fatalErrors.slice(0, 20));
  console.error('Tile errors:', tileErrors);
  process.exitCode = 1;
}
