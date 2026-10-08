import http from 'node:http';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(root, 'results');
await mkdir(resultsDir, {recursive: true});

const layerCounts = [1, 5, 10, 20, 30, 40, 50];
const featureCounts = [10000, 50000, 100000, 200000];
const route = [
  [126.9780, 37.5665, 13],
  [127.0276, 37.4979, 14],
  [126.9237, 37.5563, 14],
  [127.1058, 37.5145, 13]
];

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const p95 = (a) => {
  if (!a.length) return NaN;
  const v = [...a].sort((x, y) => x - y);
  return v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)];
};
const metricMap = (metrics) => Object.fromEntries(metrics.map((m) => [m.name, m.value]));
const mib = (bytes) => bytes / 1024 / 1024;
const fmt = (n, d = 1) => Number.isFinite(n) ? n.toFixed(d) : 'failed';
const pct = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? ((a - b) / b) * 100 : NaN;

async function startStaticServer(entry) {
  const outdir = join(root, 'dist-feature');
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    outdir,
    entryNames: 'bundle',
    logLevel: 'warning'
  });

  const html = await readFile(join(root, 'index.html'));
  const js = await readFile(join(outdir, 'bundle.js'));
  let css = Buffer.from('');
  try { css = await readFile(join(outdir, 'bundle.css')); } catch {}

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, {'content-type': 'text/html'});
      res.end(html);
      return;
    }
    if (url.pathname === '/bundle.js') {
      res.writeHead(200, {'content-type': 'text/javascript'});
      res.end(js);
      return;
    }
    if (url.pathname === '/bundle.css') {
      res.writeHead(200, {'content-type': 'text/css'});
      res.end(css);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-precise-memory-info', '--enable-unsafe-swiftshader']
});

async function runShared(baseUrl, renderer, layerCount, screenshot = false) {
  const context = await browser.newContext({
    viewport: {width: 1280, height: 720},
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  try {
    await page.goto(baseUrl + '/?renderer=' + renderer + '&layers=' + layerCount, {
      waitUntil: 'load',
      timeout: 60000
    });
    await page.waitForFunction(() => globalThis.olSharedBench?.map, null, {timeout: 30000});
    const initial = await page.evaluate(() => globalThis.olSharedBench.waitIdle());

    await cdp.send('HeapProfiler.collectGarbage');
    const before = metricMap((await cdp.send('Performance.getMetrics')).metrics);

    const scenario = await page.evaluate(async (steps) => {
      const bench = globalThis.olSharedBench;
      const durations = [];
      const timeouts = [];
      for (const [lon, lat, zoom] of steps) {
        bench.map.getView().setCenter(bench.fromLonLat([lon, lat]));
        bench.map.getView().setZoom(zoom);
        const r = await bench.waitIdle();
        durations.push(r.elapsedMs);
        timeouts.push(r.timedOut);
      }
      return {
        durations,
        timeouts,
        stats: {...bench.stats}
      };
    }, route);

    const after = metricMap((await cdp.send('Performance.getMetrics')).metrics);
    await cdp.send('HeapProfiler.collectGarbage');
    const gc = metricMap((await cdp.send('Performance.getMetrics')).metrics);

    if (screenshot) {
      await page.screenshot({path: join(resultsDir, 'shared-' + renderer + '-50.png')});
    }

    return {
      renderer,
      layerCount,
      initialMs: initial.elapsedMs,
      navMeanMs: mean(scenario.durations),
      navP95Ms: p95(scenario.durations),
      taskMs: ((after.TaskDuration || 0) - (before.TaskDuration || 0)) * 1000,
      scriptMs: ((after.ScriptDuration || 0) - (before.ScriptDuration || 0)) * 1000,
      retainedHeapMiB: mib(gc.JSHeapUsedSize || 0),
      tileLoads: scenario.stats.loaded,
      tileErrors: scenario.stats.errors,
      timedOutMoves: scenario.timeouts.filter(Boolean).length,
      errors
    };
  } finally {
    await context.close();
  }
}

async function runFeatures(baseUrl, renderer, featureCount, screenshot = false) {
  const context = await browser.newContext({
    viewport: {width: 1280, height: 720},
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  try {
    await page.goto(baseUrl + '/?renderer=' + renderer + '&features=' + featureCount, {
      waitUntil: 'load',
      timeout: 120000
    });
    await page.waitForFunction(() => globalThis.olFeatureBench?.map, null, {timeout: 60000});

    const initial = await page.evaluate(() => globalThis.olFeatureBench.waitLoaded(90000));
    await cdp.send('HeapProfiler.collectGarbage');
    const before = metricMap((await cdp.send('Performance.getMetrics')).metrics);

    const durations = await page.evaluate(() => globalThis.olFeatureBench.renderLoop(6));

    const after = metricMap((await cdp.send('Performance.getMetrics')).metrics);
    await cdp.send('HeapProfiler.collectGarbage');
    const gc = metricMap((await cdp.send('Performance.getMetrics')).metrics);

    if (screenshot) {
      await page.screenshot({path: join(resultsDir, 'features-' + renderer + '-' + featureCount + '.png')});
    }

    return {
      renderer,
      featureCount,
      loadAndInitialMs: initial.elapsedMs,
      featureBuildMs: initial.buildMs,
      initialTimedOut: initial.timedOut,
      frameMeanMs: mean(durations),
      frameP95Ms: p95(durations),
      taskMs: ((after.TaskDuration || 0) - (before.TaskDuration || 0)) * 1000,
      scriptMs: ((after.ScriptDuration || 0) - (before.ScriptDuration || 0)) * 1000,
      retainedHeapMiB: mib(gc.JSHeapUsedSize || 0),
      errors
    };
  } finally {
    await context.close();
  }
}

async function safeRun(fn, meta) {
  try {
    return await fn();
  } catch (error) {
    return {...meta, failed: true, error: String(error?.stack || error)};
  }
}

const sharedResults = [];
const featureResults = [];
let maptilerStats = null;

try {
  await copyFile(join(root, 'app-shared.js'), join(root, 'app.js'));
  const {startServer} = await import('./server.mjs');
  const mapServer = await startServer();
  const mapBase = 'http://127.0.0.1:' + mapServer.port;

  await safeRun(() => runShared(mapBase, 'canvas', 1), {renderer:'canvas', layerCount:1});

  for (const count of layerCounts) {
    sharedResults.push(await safeRun(
      () => runShared(mapBase, 'canvas', count, count === 50),
      {renderer:'canvas', layerCount:count}
    ));
    sharedResults.push(await safeRun(
      () => runShared(mapBase, 'webgl', count, count === 50),
      {renderer:'webgl', layerCount:count}
    ));
  }

  maptilerStats = {...mapServer.stats};
  await mapServer.close();

  const featureServer = await startStaticServer('app-features.js');
  const featureBase = 'http://127.0.0.1:' + featureServer.port;

  for (const count of featureCounts) {
    featureResults.push(await safeRun(
      () => runFeatures(featureBase, 'canvas', count, count === 100000),
      {renderer:'canvas', featureCount:count}
    ));
    featureResults.push(await safeRun(
      () => runFeatures(featureBase, 'webgl', count, count === 100000),
      {renderer:'webgl', featureCount:count}
    ));
  }

  await featureServer.close();
} finally {
  await browser.close();
}

const layerRows = layerCounts.map((count) => ({
  count,
  canvas: sharedResults.find((r) => r.renderer === 'canvas' && r.layerCount === count),
  webgl: sharedResults.find((r) => r.renderer === 'webgl' && r.layerCount === count)
}));

const featureRows = featureCounts.map((count) => ({
  count,
  canvas: featureResults.find((r) => r.renderer === 'canvas' && r.featureCount === count),
  webgl: featureResults.find((r) => r.renderer === 'webgl' && r.featureCount === count)
}));

const lines = [
  '# OpenLayers 10.10.0 renderer scaling benchmark',
  '',
  '## A. Shared VectorTileSource, increasing layer count',
  '',
  '| Layers | Canvas nav mean | WebGL nav mean | WebGL delta | Canvas task | WebGL task | Canvas heap | WebGL heap |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|'
];

for (const row of layerRows) {
  lines.push(
    '| ' + row.count +
    ' | ' + fmt(row.canvas?.navMeanMs) + ' ms' +
    ' | ' + fmt(row.webgl?.navMeanMs) + ' ms' +
    ' | ' + fmt(pct(row.webgl?.navMeanMs, row.canvas?.navMeanMs)) + '%' +
    ' | ' + fmt(row.canvas?.taskMs) + ' ms' +
    ' | ' + fmt(row.webgl?.taskMs) + ' ms' +
    ' | ' + fmt(row.canvas?.retainedHeapMiB) + ' MiB' +
    ' | ' + fmt(row.webgl?.retainedHeapMiB) + ' MiB |'
  );
}

lines.push(
  '',
  '## B. One VectorTileLayer, increasing feature count',
  '',
  'Synthetic mix: 50% LineString, 30% Point, 20% Polygon.',
  '',
  '| Features | Canvas frame mean | WebGL frame mean | WebGL delta | Canvas initial | WebGL initial | Canvas heap | WebGL heap |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|'
);

for (const row of featureRows) {
  lines.push(
    '| ' + row.count +
    ' | ' + fmt(row.canvas?.frameMeanMs) + ' ms' +
    ' | ' + fmt(row.webgl?.frameMeanMs) + ' ms' +
    ' | ' + fmt(pct(row.webgl?.frameMeanMs, row.canvas?.frameMeanMs)) + '%' +
    ' | ' + fmt(row.canvas?.loadAndInitialMs) + ' ms' +
    ' | ' + fmt(row.webgl?.loadAndInitialMs) + ' ms' +
    ' | ' + fmt(row.canvas?.retainedHeapMiB) + ' MiB' +
    ' | ' + fmt(row.webgl?.retainedHeapMiB) + ' MiB |'
  );
}

lines.push(
  '',
  'MapTiler local proxy: ' + (maptilerStats ? maptilerStats.hits + ' hits, ' + maptilerStats.misses + ' misses' : 'n/a'),
  '',
  'Notes:',
  '- A isolates layer/renderer overhead by sharing one VectorTileSource across all layers.',
  '- B isolates large-geometry rendering by using exactly one VectorTileLayer/WebGLVectorTileLayer.',
  '- Synthetic feature mix explicitly includes 50% LineString.',
  '- GitHub-hosted Chromium may use SwiftShader software WebGL; interpret WebGL results as CI behavior, not hardware-GPU performance.'
);

const report = lines.join('\n') + '\n';
await writeFile(join(resultsDir, 'advanced-raw.json'), JSON.stringify({
  layerCounts,
  featureCounts,
  sharedResults,
  featureResults,
  maptilerStats
}, null, 2));
await writeFile(join(resultsDir, 'advanced-report.md'), report);
console.log(report);
