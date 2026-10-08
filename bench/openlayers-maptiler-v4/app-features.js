import 'ol/ol.css';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import VectorTileLayer from 'ol/layer/VectorTile.js';
import WebGLVectorTileLayer from 'ol/layer/WebGLVectorTile.js';
import VectorTileSource from 'ol/source/VectorTile.js';
import {createXYZ} from 'ol/tilegrid.js';

const params = new URLSearchParams(location.search);
const renderer = params.get('renderer') === 'webgl' ? 'webgl' : 'canvas';
const featureCount = Math.max(1, Number(params.get('features') || 10000));

const tileGrid = createXYZ({maxZoom: 0, tileSize: 512});
let buildMs = 0;

const source = new VectorTileSource({
  tileGrid,
  tileUrlFunction: (tileCoord) => tileCoord.join('/'),
  tileLoadFunction(tile) {
    const t0 = performance.now();
    const extent = tileGrid.getTileCoordExtent(tile.getTileCoord());
    const minX = extent[0];
    const minY = extent[1];
    const width = extent[2] - extent[0];
    const height = extent[3] - extent[1];
    const side = Math.ceil(Math.sqrt(featureCount));
    const sx = width / side;
    const sy = height / side;
    const features = new Array(featureCount);

    for (let i = 0; i < featureCount; i++) {
      const gx = i % side;
      const gy = Math.floor(i / side);
      const x = minX + (gx + 0.5) * sx;
      const y = minY + (gy + 0.5) * sy;
      const kind = i % 10;

      if (kind < 5) {
        features[i] = new Feature({
          geometry: new LineString([
            [x - sx * 0.35, y - sy * 0.2],
            [x, y + sy * 0.25],
            [x + sx * 0.35, y - sy * 0.15]
          ])
        });
      } else if (kind < 8) {
        features[i] = new Feature({
          geometry: new Point([x, y])
        });
      } else {
        const dx = sx * 0.28;
        const dy = sy * 0.28;
        features[i] = new Feature({
          geometry: new Polygon([[
            [x - dx, y - dy],
            [x + dx, y - dy],
            [x + dx, y + dy],
            [x - dx, y + dy],
            [x - dx, y - dy]
          ]])
        });
      }
    }

    buildMs = performance.now() - t0;
    tile.setFeatures(features);
  }
});

const style = [
  {
    filter: ['==', ['geometry-type'], 'LineString'],
    style: {
      'stroke-color': 'rgba(36,93,160,0.82)',
      'stroke-width': 1.1
    }
  },
  {
    filter: ['==', ['geometry-type'], 'Point'],
    style: {
      'circle-radius': 1.8,
      'circle-fill-color': 'rgba(195,76,57,0.78)'
    }
  },
  {
    filter: ['==', ['geometry-type'], 'Polygon'],
    style: {
      'fill-color': 'rgba(92,160,92,0.42)',
      'stroke-color': 'rgba(65,120,65,0.65)',
      'stroke-width': 0.6
    }
  }
];

let pending = 0;
let loaded = 0;
source.on('tileloadstart', () => pending++);
source.on('tileloadend', () => {
  pending = Math.max(0, pending - 1);
  loaded++;
});
source.on('tileloaderror', () => pending = Math.max(0, pending - 1));

const layer = renderer === 'webgl'
  ? new WebGLVectorTileLayer({source, style, disableHitDetection: true})
  : new VectorTileLayer({source, style});

const map = new Map({
  target: 'map',
  layers: [layer],
  controls: [],
  interactions: [],
  view: new View({
    center: [0, 0],
    zoom: 0,
    minZoom: 0,
    maxZoom: 0
  })
});

async function waitLoaded(timeoutMs = 30000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (loaded > 0 && pending === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  map.renderSync();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {
    elapsedMs: performance.now() - start,
    timedOut: !(loaded > 0 && pending === 0),
    buildMs
  };
}

async function renderLoop(iterations = 12) {
  const view = map.getView();
  const base = view.getCenter().slice();
  const durations = [];
  for (let i = 0; i < iterations; i++) {
    const offset = (i % 2 === 0 ? 1 : -1) * 1000;
    view.setCenter([base[0] + offset, base[1]]);
    const t0 = performance.now();
    map.renderSync();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    durations.push(performance.now() - t0);
  }
  view.setCenter(base);
  return durations;
}

globalThis.olFeatureBench = {
  map,
  source,
  layer,
  renderer,
  featureCount,
  waitLoaded,
  renderLoop
};
