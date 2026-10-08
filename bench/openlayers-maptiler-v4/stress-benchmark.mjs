import http from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(root, 'results');
await mkdir(resultsDir, {recursive: true});

const outdir = join(root, 'dist-stress');
await build({
  entryPoints: [join(root, 'app-stress.js')],
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
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-precise-memory-info', '--enable-unsafe-swiftshader']
});

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const p95 = (a) => {
  const v = [...a].sort((x, y) => x - y);
  return v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)];
};
const metricsToMap = (metrics) => Object.fromEntries(metrics.map((m) => [m.name, m.value]));
const mib = (bytes) => bytes / 1024 / 1024;

async function run(renderer) {
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

  try {
    const wallStart = Date.now();
    await page.goto(baseUrl + '/?renderer=' + renderer, {
      waitUntil: 'load',
      timeout: 120000
    });
    await page.waitForFunction(() => globalThis.olStressBench?.map, null, {
      timeout: 120000
    });

    const initial = await page.evaluate(() => globalThis.olStressBench.waitReady(120000));

    await cdp.send('HeapProfiler.collectGarbage');
    const before = metricsToMap((await cdp.send('Performance.getMetrics')).metrics);

    const durations = await page.evaluate(() => globalThis.olStressBench.renderLoop(4));

    const after = metricsToMap((await cdp.send('Performance.getMetrics')).metrics);
    const beforeGcHeap = after.JSHeapUsedSize || 0;
    await cdp.send('HeapProfiler.collectGarbage');
    const gc = metricsToMap((await cdp.send('Performance.getMetrics')).metrics);

    const screenshot = join(resultsDir, 'stress-' + renderer + '.png');
    await page.screenshot({path: screenshot});

    const canvasInfo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl ? {
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      } : null;
    });

    return {
      renderer,
      status: 'success',
      featureCount: 500000,
      layerCount: 50,
      geometryMix: {lineStringPct: 50, pointPct: 30, polygonPct: 20},
      initialReadyMs: initial.elapsedMs,
      featureBuildMs: initial.featureBuildMs,
      frameMeanMs: mean(durations),
      frameP95Ms: p95(durations),
      frameSamplesMs: durations,
      taskMs: ((after.TaskDuration || 0) - (before.TaskDuration || 0)) * 1000,
      scriptMs: ((after.ScriptDuration || 0) - (before.ScriptDuration || 0)) * 1000,
      peakObservedJsHeapMiB: mib(beforeGcHeap),
      retainedJsHeapMiB: mib(gc.JSHeapUsedSize || 0),
      wallMs: Date.now() - wallStart,
      webglInfo: canvasInfo,
      errors
    };
  } catch (error) {
    return {
      renderer,
      status: 'failed',
      featureCount: 500000,
      layerCount: 50,
      error: String(error?.stack || error),
      errors
    };
  } finally {
    await context.close();
  }
}

const results = [];
try {
  for (const renderer of ['canvas', 'webgl']) {
    const result = await run(renderer);
    results.push(result);
    await writeFile(
      join(resultsDir, 'stress-raw.json'),
      JSON.stringify({results}, null, 2)
    );
    console.log('Completed', renderer, JSON.stringify(result));
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

const canvas = results.find((r) => r.renderer === 'canvas');
const webgl = results.find((r) => r.renderer === 'webgl');
const f = (n, d = 1) => Number.isFinite(n) ? n.toFixed(d) : 'failed';
const pct = (a, b) =>
  Number.isFinite(a) && Number.isFinite(b) && b !== 0
    ? ((a - b) / b) * 100
    : NaN;

const report = [
  '# OpenLayers 10.10.0 — 50 layers / 500k features stress test',
  '',
  'Shared VectorTileSource, 50 OpenLayers layers, 500,000 total features.',
  'Geometry mix: 50% LineString, 30% Point, 20% Polygon.',
  '',
  '| Metric | Canvas VectorTileLayer | WebGLVectorTileLayer | WebGL vs Canvas |',
  '|---|---:|---:|---:|',
  '| Initial ready | ' + f(canvas?.initialReadyMs) + ' ms | ' + f(webgl?.initialReadyMs) + ' ms | ' + f(pct(webgl?.initialReadyMs, canvas?.initialReadyMs)) + '% |',
  '| Feature object build | ' + f(canvas?.featureBuildMs) + ' ms | ' + f(webgl?.featureBuildMs) + ' ms | ' + f(pct(webgl?.featureBuildMs, canvas?.featureBuildMs)) + '% |',
  '| Frame mean | ' + f(canvas?.frameMeanMs) + ' ms | ' + f(webgl?.frameMeanMs) + ' ms | ' + f(pct(webgl?.frameMeanMs, canvas?.frameMeanMs)) + '% |',
  '| Frame p95 | ' + f(canvas?.frameP95Ms) + ' ms | ' + f(webgl?.frameP95Ms) + ' ms | ' + f(pct(webgl?.frameP95Ms, canvas?.frameP95Ms)) + '% |',
  '| Chromium task | ' + f(canvas?.taskMs) + ' ms | ' + f(webgl?.taskMs) + ' ms | ' + f(pct(webgl?.taskMs, canvas?.taskMs)) + '% |',
  '| Script | ' + f(canvas?.scriptMs) + ' ms | ' + f(webgl?.scriptMs) + ' ms | ' + f(pct(webgl?.scriptMs, canvas?.scriptMs)) + '% |',
  '| Retained JS heap | ' + f(canvas?.retainedJsHeapMiB) + ' MiB | ' + f(webgl?.retainedJsHeapMiB) + ' MiB | ' + f(pct(webgl?.retainedJsHeapMiB, canvas?.retainedJsHeapMiB)) + '% |',
  '',
  'Canvas status: ' + canvas?.status,
  'WebGL status: ' + webgl?.status,
  '',
  'WebGL environment: ' + (webgl?.webglInfo ? webgl.webglInfo.vendor + ' / ' + webgl.webglInfo.renderer : 'not reported'),
  '',
  'Note: GitHub-hosted Chromium commonly uses SwiftShader software WebGL, so this is a CI stress comparison rather than hardware-GPU performance.'
].join('\n') + '\n';

await writeFile(join(resultsDir, 'stress-report.md'), report);
console.log(report);
