import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

export async function startServer() {
  const key = process.env.MAPTILER_KEY;
  if (!key) throw new Error('MAPTILER_KEY is required');

  await build({
    entryPoints: [join(root, 'app.js')],
    bundle: true,
    outdir: dist,
    entryNames: 'bundle',
    logLevel: 'warning',
  });

  const tileJsonResponse = await fetch(
    'https://api.maptiler.com/tiles/v4/tiles.json?key=' + encodeURIComponent(key),
  );
  if (!tileJsonResponse.ok) {
    throw new Error('MapTiler TileJSON request failed: HTTP ' + tileJsonResponse.status);
  }
  const tileJson = await tileJsonResponse.json();
  const tileTemplate = tileJson.tiles?.[0];
  if (!tileTemplate) throw new Error('MapTiler v4 TileJSON has no tile template');

  const cache = new Map();
  const inflight = new Map();
  const stats = {hits: 0, misses: 0, bytes: 0};

  async function getTile(z, x, y) {
    const cacheKey = z + '/' + x + '/' + y;
    if (cache.has(cacheKey)) {
      stats.hits++;
      return cache.get(cacheKey);
    }
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);

    const task = (async () => {
      stats.misses++;
      let url = tileTemplate
        .replace('{z}', z)
        .replace('{x}', x)
        .replace('{y}', y)
        .replace('{key}', encodeURIComponent(key))
        .replace('{ratio}', '');
      if (!/[?&]key=/.test(url)) {
        url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key);
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error('Tile request failed: HTTP ' + response.status);
      const buffer = Buffer.from(await response.arrayBuffer());
      stats.bytes += buffer.length;
      cache.set(cacheKey, buffer);
      return buffer;
    })();

    inflight.set(cacheKey, task);
    try {
      return await task;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  const indexHtml = await readFile(join(root, 'index.html'));
  const bundleJs = await readFile(join(dist, 'bundle.js'));
  let bundleCss = Buffer.from('');
  try {
    bundleCss = await readFile(join(dist, 'bundle.css'));
  } catch {}

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
        res.end(indexHtml);
        return;
      }
      if (url.pathname === '/bundle.js') {
        res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'});
        res.end(bundleJs);
        return;
      }
      if (url.pathname === '/bundle.css') {
        res.writeHead(200, {'content-type': 'text/css; charset=utf-8'});
        res.end(bundleCss);
        return;
      }

      const match = url.pathname.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
      if (match) {
        const tile = await getTile(match[1], match[2], match[3]);
        res.writeHead(200, {
          'content-type': 'application/x-protobuf',
          'cache-control': 'no-store',
          'content-length': tile.length,
        });
        res.end(tile);
        return;
      }

      res.writeHead(404);
      res.end('not found');
    } catch (error) {
      res.writeHead(502, {'content-type': 'text/plain; charset=utf-8'});
      res.end(String(error?.message || error));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    port,
    stats,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
