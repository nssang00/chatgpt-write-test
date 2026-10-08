import http from 'node:http';
import os from 'node:os';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const resultsDir = join(root, 'local-results', stamp);
await mkdir(resultsDir, {recursive: true});

const outdir = join(root, 'dist-local-gpu');
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
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end(html);
    return;
  }
  if (url.pathname === '/bundle.js') {
    res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'});
    res.end(js);
    return;
  }
  if (url.pathname === '/bundle.css') {
    res.writeHead(200, {'content-type': 'text/css; charset=utf-8'});
    res.end(css);
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const launchArgs = [
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-precise-memory-info',
  '--window-size=1280,900'
];

async function launchBrowser() {
  const headless = process.env.LOCAL_HEADLESS === '1';
  const executablePath = process.env.CHROME_PATH;

  if (executablePath) {
    return {
      browser: await chromium.launch({
        executablePath,
        headless,
        args: launchArgs
      }),
      browserLabel: 'custom CHROME_PATH'
    };
  }

  try {
    const browser = await chromium.launch({
      channel: 'chrome',
      headless,
      args: launchArgs
    });
    return {browser, browserLabel: 'Google Chrome'};
  } catch {
    const browser = await chromium.launch({
      headless,
      args: launchArgs
    });
    return {browser, browserLabel: 'Playwright Chromium'};
  }
}

const {browser, browserLabel} = await launchBrowser();

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const p95 = (values) => {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)];
};
const metricsToMap = (metrics) => Object.fromEntries(metrics.map((m) => [m.name, m.value]));
const mib = (bytes) => bytes / 1024 / 1024;

async function inspectGpu(page) {
  return await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return {available: false};
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = debug
      ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
      : gl.getParameter(gl.VENDOR);
    const renderer = debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const text = (vendor + ' ' + renderer).toLowerCase();
    return {
      available: true,
      vendor,
      renderer,
      likelyHardware: !text.includes('swiftshader') && !text.includes('software')
    };
  });
}

async function run(renderer) {
  console.log('\n=== ' + renderer.toUpperCase() + ' START ===');
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
  const wallStart = Date.now();

  try {
    console.log('[1/5] Loading map...');
    await page.goto(baseUrl + '/?renderer=' + renderer, {
      waitUntil: 'load',
      timeout: 120000
    });
    await page.waitForFunction(() => globalThis.olStressBench?.map, null, {
      timeout: 120000
    });

    const gpu = await inspectGpu(page);
    console.log('[GPU]', JSON.stringify(gpu));

    console.log('[2/5] Building 500k features across 50 layers...');
    const initial = await page.evaluate(() => globalThis.olStressBench.waitReady(180000));
    console.log('[READY]', JSON.stringify(initial));

    await cdp.send('HeapProfiler.collectGarbage');
    const before = metricsToMap((await cdp.send('Performance.getMetrics')).metrics);

    console.log('[3/5] Running 8 render frames...');
    const durations = await page.evaluate(() => globalThis.olStressBench.renderLoop(8));
    console.log('[FRAMES]', durations.map((n) => n.toFixed(1)).join(', '));

    const after = metricsToMap((await cdp.send('Performance.getMetrics')).metrics);
    const peakObserved = after.JSHeapUsedSize || 0;
    await cdp.send('HeapProfiler.collectGarbage');
    const gc = metricsToMap((await cdp.send('Performance.getMetrics')).metrics);

    console.log('[4/5] Capturing screenshot...');
    const screenshotPath = join(resultsDir, renderer + '.png');
    try {
      await page.screenshot({path: screenshotPath, timeout: 120000});
    } catch (error) {
      errors.push('screenshot: ' + String(error?.message || error));
    }

    console.log('[5/5] Collecting result...');
    return {
      renderer,
      status: 'success',
      browser: browserLabel,
      featureCount: 500000,
      layerCount: 50,
      featuresPerLayer: 10000,
      geometryMix: {
        lineStringPct: 50,
        pointPct: 30,
        polygonPct: 20
      },
      gpu,
      initialReadyMs: initial.elapsedMs,
      featureBuildMs: initial.featureBuildMs,
      loadedSources: initial.loadedSources,
      initialTimedOut: initial.timedOut,
      frameMeanMs: mean(durations),
      frameP95Ms: p95(durations),
      frameSamplesMs: durations,
      taskMs: ((after.TaskDuration || 0) - (before.TaskDuration || 0)) * 1000,
      scriptMs: ((after.ScriptDuration || 0) - (before.ScriptDuration || 0)) * 1000,
      peakObservedJsHeapMiB: mib(peakObserved),
      retainedJsHeapMiB: mib(gc.JSHeapUsedSize || 0),
      wallMs: Date.now() - wallStart,
      errors
    };
  } catch (error) {
    return {
      renderer,
      status: 'failed',
      browser: browserLabel,
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
  results.push(await run('canvas'));
  await writeFile(join(resultsDir, 'raw.json'), JSON.stringify({results}, null, 2));

  results.push(await run('webgl'));
  await writeFile(join(resultsDir, 'raw.json'), JSON.stringify({results}, null, 2));
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

const gpuStatus = webgl?.gpu?.likelyHardware
  ? 'HARDWARE GPU DETECTED'
  : 'WARNING: SOFTWARE/UNKNOWN WEBGL RENDERER';

const report = [
  '# OpenLayers 10.10.0 local GPU benchmark',
  '',
  '**' + gpuStatus + '**',
  '',
  '- Browser: ' + browserLabel,
  '- Layers: 50',
  '- Total features: 500,000',
  '- Features per layer: 10,000',
  '- Geometry mix: 50% LineString / 30% Point / 20% Polygon',
  '',
  '## GPU',
  '',
  '- Vendor: ' + (webgl?.gpu?.vendor || 'n/a'),
  '- Renderer: ' + (webgl?.gpu?.renderer || 'n/a'),
  '',
  '## Results',
  '',
  '| Metric | Canvas VectorTileLayer | WebGLVectorTileLayer | WebGL vs Canvas |',
  '|---|---:|---:|---:|',
  '| Initial ready | ' + f(canvas?.initialReadyMs) + ' ms | ' + f(webgl?.initialReadyMs) + ' ms | ' + f(pct(webgl?.initialReadyMs, canvas?.initialReadyMs)) + '% |',
  '| Feature build | ' + f(canvas?.featureBuildMs) + ' ms | ' + f(webgl?.featureBuildMs) + ' ms | ' + f(pct(webgl?.featureBuildMs, canvas?.featureBuildMs)) + '% |',
  '| Frame mean | ' + f(canvas?.frameMeanMs) + ' ms | ' + f(webgl?.frameMeanMs) + ' ms | ' + f(pct(webgl?.frameMeanMs, canvas?.frameMeanMs)) + '% |',
  '| Frame p95 | ' + f(canvas?.frameP95Ms) + ' ms | ' + f(webgl?.frameP95Ms) + ' ms | ' + f(pct(webgl?.frameP95Ms, canvas?.frameP95Ms)) + '% |',
  '| Chromium task | ' + f(canvas?.taskMs) + ' ms | ' + f(webgl?.taskMs) + ' ms | ' + f(pct(webgl?.taskMs, canvas?.taskMs)) + '% |',
  '| Script | ' + f(canvas?.scriptMs) + ' ms | ' + f(webgl?.scriptMs) + ' ms | ' + f(pct(webgl?.scriptMs, canvas?.scriptMs)) + '% |',
  '| Peak observed JS heap | ' + f(canvas?.peakObservedJsHeapMiB) + ' MiB | ' + f(webgl?.peakObservedJsHeapMiB) + ' MiB | ' + f(pct(webgl?.peakObservedJsHeapMiB, canvas?.peakObservedJsHeapMiB)) + '% |',
  '| Retained JS heap | ' + f(canvas?.retainedJsHeapMiB) + ' MiB | ' + f(webgl?.retainedJsHeapMiB) + ' MiB | ' + f(pct(webgl?.retainedJsHeapMiB, canvas?.retainedJsHeapMiB)) + '% |',
  '',
  'Canvas status: ' + canvas?.status,
  'WebGL status: ' + webgl?.status,
  '',
  'Generated: ' + new Date().toISOString()
].join('\n') + '\n';

await writeFile(join(resultsDir, 'report.md'), report);
await writeFile(join(resultsDir, 'system.json'), JSON.stringify({
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  hostname: os.hostname(),
  cpuModel: os.cpus()[0]?.model,
  cpuCount: os.cpus().length,
  totalMemoryGiB: os.totalmem() / 1024 / 1024 / 1024,
  freeMemoryGiB: os.freemem() / 1024 / 1024 / 1024,
  browser: browserLabel,
  gpu: webgl?.gpu || null
}, null, 2));

await writeFile(join(root, 'local-results', 'LATEST.txt'), resultsDir + '\n');

console.log('\n========================================');
console.log(report);
console.log('RESULT_DIR=' + resultsDir);
console.log('========================================');
