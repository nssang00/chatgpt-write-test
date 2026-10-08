import {mkdir, copyFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {startServer} from './server.mjs';

const root = dirname(fileURLToPath(import.meta.url));
await mkdir(join(root, 'results'), {recursive: true});
await copyFile(join(root, 'app2.js'), join(root, 'app.js'));

const server = await startServer();
const baseUrl = 'http://127.0.0.1:' + server.port;
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-precise-memory-info', '--enable-unsafe-swiftshader']
});

const states = [
  [126.9780, 37.5665, 13],
  [127.0276, 37.4979, 14],
  [126.9237, 37.5563, 14],
  [127.1058, 37.5145, 14],
  [126.9950, 37.5700, 12],
  [127.0350, 37.5400, 13]
];

function metricMap(metrics) {
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function runOne(renderer, screenshotPath) {
  const context = await browser.newContext({
    viewport: {width: 1280, height: 720},
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  const navStart = Date.now();
  await page.goto(baseUrl + '/?renderer=' + renderer, {waitUntil: 'load'});
  await page.waitForFunction(() => globalThis.olBench?.map, null, {timeout: 120000});

  const initialMs = await page.evaluate(async () => {
    const map = globalThis.olBench.map;
    const t0 = performance.now();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('initial render timeout')), 120000);
      map.once('rendercomplete', () => {
        clearTimeout(timer);
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      map.render();
    });
    return performance.now() - t0;
  });

  await cdp.send('HeapProfiler.collectGarbage');
  const before = metricMap((await cdp.send('Performance.getMetrics')).metrics);

  const scenario = await page.evaluate(async (steps) => {
    const {map, source, fromLonLat} = globalThis.olBench;
    let started = 0;
    let loaded = 0;
    let failed = 0;
    source.on('tileloadstart', () => started++);
    source.on('tileloadend', () => loaded++);
    source.on('tileloaderror', () => failed++);

    async function render() {
      return new Promise((resolve, reject) => {
        const t0 = performance.now();
        const timer = setTimeout(() => reject(new Error('render timeout')), 120000);
        map.once('rendercomplete', () => {
          clearTimeout(timer);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            resolve(performance.now() - t0);
          }));
        });
        map.render();
      });
    }

    const durations = [];
    const heap = [];
    for (const [lon, lat, zoom] of steps) {
      map.getView().setCenter(fromLonLat([lon, lat]));
      map.getView().setZoom(zoom);
      durations.push(await render());
      heap.push(performance.memory?.usedJSHeapSize ?? null);
    }

    const glCanvas = document.createElement('canvas');
    const gl = glCanvas.getContext('webgl2') || glCanvas.getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      durations,
      heap,
      tiles: {started, loaded, failed},
      webgl: gl ? {
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      } : null
    };
  }, states);

  await cdp.send('HeapProfiler.collectGarbage');
  const after = metricMap((await cdp.send('Performance.getMetrics')).metrics);
  const dom = await cdp.send('Memory.getDOMCounters');

  if (screenshotPath) await page.screenshot({path: screenshotPath});

  await context.close();

  return {
    renderer,
    initialMs,
    wallMs: Date.now() - navStart,
    navigationMs: scenario.durations,
    peakHeapBytes: Math.max(...scenario.heap.filter((v) => Number.isFinite(v))),
    retainedHeapBytes: after.JSHeapUsedSize,
    taskDurationMs: ((after.TaskDuration || 0) - (before.TaskDuration || 0)) * 1000,
    scriptDurationMs: ((after.ScriptDuration || 0) - (before.ScriptDuration || 0)) * 1000,
    layoutDurationMs: ((after.LayoutDuration || 0) - (before.LayoutDuration || 0)) * 1000,
    domNodes: dom.nodes,
    tiles: scenario.tiles,
    webgl: scenario.webgl,
    errors
  };
}

const raw = {vector: [], webgl: [], serverCache: server.stats};

try {
  await runOne('vector');
  await runOne('webgl');

  for (let round = 0; round < 3; round++) {
    const order = round % 2 === 0 ? ['vector', 'webgl'] : ['webgl', 'vector'];
    for (const renderer of order) {
      const shot = round === 0
        ? join(root, 'results', renderer + '.png')
        : null;
      raw[renderer].push(await runOne(renderer, shot));
    }
  }
} finally {
  await browser.close();
  await server.close();
}

export default raw;
