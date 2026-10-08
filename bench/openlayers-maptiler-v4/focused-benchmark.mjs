import http from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(root, 'results');
await mkdir(resultsDir, {recursive: true});

const layerCounts = [1, 5, 10, 20, 30, 40, 50];
const featureCounts = [10000, 25000, 50000, 100000];

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const p95 = (a) => {
  const v = [...a].sort((x, y) => x - y);
  return v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)];
};
const metricsMap = (a) => Object.fromEntries(a.map((m) => [m.name, m.value]));
const mib = (v) => v / 1024 / 1024;
const fmt = (n, d = 1) => Number.isFinite(n) ? n.toFixed(d) : 'failed';
const pct = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b ? ((a - b) / b) * 100 : NaN;

async function start(entry) {
  const outdir = join(root, 'dist-focused');
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
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.writeHead(200, {'content-type':'text/html'});
      res.end(html);
      return;
    }
    if (u.pathname === '/bundle.js') {
      res.writeHead(200, {'content-type':'text/javascript'});
      res.end(js);
      return;
    }
    if (u.pathname === '/bundle.css') {
      res.writeHead(200, {'content-type':'text/css'});
      res.end(css);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-precise-memory-info', '--enable-unsafe-swiftshader']
});

async function runPage(url, readyExpr, loadExpr, loopExpr, screenshotPath) {
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
    await page.goto(url, {waitUntil:'load', timeout:60000});
    await page.waitForFunction(readyExpr, null, {timeout:30000});
    const initial = await page.evaluate(loadExpr);

    await cdp.send('HeapProfiler.collectGarbage');
    const before = metricsMap((await cdp.send('Performance.getMetrics')).metrics);
    const durations = await page.evaluate(loopExpr);
    const after = metricsMap((await cdp.send('Performance.getMetrics')).metrics);
    await cdp.send('HeapProfiler.collectGarbage');
    const gc = metricsMap((await cdp.send('Performance.getMetrics')).metrics);

    if (screenshotPath) await page.screenshot({path:screenshotPath});

    return {
      initialMs: initial.elapsedMs,
      buildMs: initial.buildMs,
      timedOut: initial.timedOut,
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

async function safe(fn, meta) {
  try {
    return {...meta, ...(await fn())};
  } catch (e) {
    return {...meta, failed:true, error:String(e?.stack || e)};
  }
}

const layerResults = [];
const featureResults = [];

try {
  const layerServer = await start('app-layer-overhead.js');
  for (const count of layerCounts) {
    for (const renderer of ['canvas','webgl']) {
      layerResults.push(await safe(
        () => runPage(
          layerServer.url + '/?renderer=' + renderer + '&layers=' + count,
          () => !!globalThis.olLayerBench?.map,
          () => globalThis.olLayerBench.waitLoaded(),
          () => globalThis.olLayerBench.renderLoop(6),
          count === 50 ? join(resultsDir, 'focused-layers-' + renderer + '.png') : null
        ),
        {renderer, layerCount:count}
      ));
    }
  }
  await layerServer.close();

  const featureServer = await start('app-features.js');
  for (const count of featureCounts) {
    for (const renderer of ['canvas','webgl']) {
      featureResults.push(await safe(
        () => runPage(
          featureServer.url + '/?renderer=' + renderer + '&features=' + count,
          () => !!globalThis.olFeatureBench?.map,
          () => globalThis.olFeatureBench.waitLoaded(60000),
          () => globalThis.olFeatureBench.renderLoop(4),
          count === 100000 ? join(resultsDir, 'focused-features-' + renderer + '.png') : null
        ),
        {renderer, featureCount:count}
      ));
    }
  }
  await featureServer.close();
} finally {
  await browser.close();
}

const layerRows = layerCounts.map((count) => ({
  count,
  canvas: layerResults.find((r) => r.renderer === 'canvas' && r.layerCount === count),
  webgl: layerResults.find((r) => r.renderer === 'webgl' && r.layerCount === count)
}));
const featureRows = featureCounts.map((count) => ({
  count,
  canvas: featureResults.find((r) => r.renderer === 'canvas' && r.featureCount === count),
  webgl: featureResults.find((r) => r.renderer === 'webgl' && r.featureCount === count)
}));

const lines = [
  '# OpenLayers 10.10.0 focused Canvas vs WebGL benchmark',
  '',
  '## A. Fixed 500 geometries, shared VectorTileSource, increasing layer count',
  '',
  'Geometry mix: 50% LineString, 30% Point, 20% Polygon. Total geometry count stays fixed at 500.',
  '',
  '| Layers | Canvas frame | WebGL frame | WebGL delta | Canvas task | WebGL task | Canvas heap | WebGL heap |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|'
];

for (const row of layerRows) {
  lines.push(
    '| ' + row.count +
    ' | ' + fmt(row.canvas?.frameMeanMs) + ' ms' +
    ' | ' + fmt(row.webgl?.frameMeanMs) + ' ms' +
    ' | ' + fmt(pct(row.webgl?.frameMeanMs, row.canvas?.frameMeanMs)) + '%' +
    ' | ' + fmt(row.canvas?.taskMs) + ' ms' +
    ' | ' + fmt(row.webgl?.taskMs) + ' ms' +
    ' | ' + fmt(row.canvas?.retainedHeapMiB) + ' MiB' +
    ' | ' + fmt(row.webgl?.retainedHeapMiB) + ' MiB |'
  );
}

lines.push(
  '',
  '## B. One layer, increasing feature count',
  '',
  'Geometry mix: 50% LineString, 30% Point, 20% Polygon.',
  '',
  '| Features | Canvas frame | WebGL frame | WebGL delta | Canvas initial | WebGL initial | Canvas heap | WebGL heap |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|'
);

for (const row of featureRows) {
  lines.push(
    '| ' + row.count +
    ' | ' + fmt(row.canvas?.frameMeanMs) + ' ms' +
    ' | ' + fmt(row.webgl?.frameMeanMs) + ' ms' +
    ' | ' + fmt(pct(row.webgl?.frameMeanMs, row.canvas?.frameMeanMs)) + '%' +
    ' | ' + fmt(row.canvas?.initialMs) + ' ms' +
    ' | ' + fmt(row.webgl?.initialMs) + ' ms' +
    ' | ' + fmt(row.canvas?.retainedHeapMiB) + ' MiB' +
    ' | ' + fmt(row.webgl?.retainedHeapMiB) + ' MiB |'
  );
}

lines.push(
  '',
  'Notes:',
  '- A changes only layer count while keeping one shared source and 500 total geometries.',
  '- B changes only feature count while keeping exactly one layer.',
  '- Both A and B explicitly render LineString with stroke-color and stroke-width.',
  '- GitHub Actions Chromium may use SwiftShader software WebGL, so this measures CI behavior rather than hardware-GPU performance.'
);

const report = lines.join('\n') + '\n';
await writeFile(join(resultsDir, 'focused-report.md'), report);
await writeFile(join(resultsDir, 'focused-raw.json'), JSON.stringify({
  layerCounts,
  featureCounts,
  layerResults,
  featureResults
}, null, 2));
console.log(report);
