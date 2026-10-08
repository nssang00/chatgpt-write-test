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
const featureCount = 500000;
const layerCount = 50;

const tileGrid = createXYZ({maxZoom: 0, tileSize: 512});
let featureBuildMs = 0;
let loaded = 0;

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
      const bucket = i % layerCount;
      const kind = i % 10;
      let geometry;

      if (kind < 5) {
        geometry = new LineString([
          [x - sx * 0.35, y - sy * 0.2],
          [x, y + sy * 0.25],
          [x + sx * 0.35, y - sy * 0.15]
        ]);
      } else if (kind < 8) {
        geometry = new Point([x, y]);
      } else {
        const dx = sx * 0.28;
        const dy = sy * 0.28;
        geometry = new Polygon([[
          [x - dx, y - dy],
          [x + dx, y - dy],
          [x + dx, y + dy],
          [x - dx, y + dy],
          [x - dx, y - dy]
        ]]);
      }

      features[i] = new Feature({geometry, bucket});
    }

    featureBuildMs = performance.now() - t0;
    tile.setFeatures(features);
    loaded++;
  }
});

function styleFor(bucket) {
  const hue = (bucket * 47) % 360;
  const own = ['==', ['get', 'bucket'], bucket];
  return [
    {
      filter: ['all', own, ['==', ['geometry-type'], 'LineString']],
      style: {
        'stroke-color': 'hsla(' + hue + ',58%,42%,0.82)',
        'stroke-width': 1.0
      }
    },
    {
      filter: ['all', own, ['==', ['geometry-type'], 'Point']],
      style: {
        'circle-radius': 1.7,
        'circle-fill-color': 'hsla(' + hue + ',62%,45%,0.82)'
      }
    },
    {
      filter: ['all', own, ['==', ['geometry-type'], 'Polygon']],
      style: {
        'fill-color': 'hsla(' + hue + ',45%,62%,0.38)',
        'stroke-color': 'hsla(' + hue + ',50%,38%,0.62)',
        'stroke-width': 0.55
      }
    }
  ];
}

const layers = [];
for (let i = 0; i < layerCount; i++) {
  const options = {source, style: styleFor(i), zIndex: i};
  layers.push(renderer === 'webgl'
    ? new WebGLVectorTileLayer({...options, disableHitDetection: true})
    : new VectorTileLayer(options));
}

const map = new Map({
  target: 'map',
  layers,
  controls: [],
  interactions: [],
  view: new View({center: [0, 0], zoom: 0, minZoom: 0, maxZoom: 0})
});

async function waitReady(timeoutMs = 120000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (loaded > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  map.renderSync();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {
    elapsedMs: performance.now() - start,
    featureBuildMs,
    loaded,
    timedOut: loaded === 0
  };
}

async function renderLoop(iterations = 4) {
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

globalThis.olStressBench = {
  map,
  source,
  layers,
  renderer,
  featureCount,
  layerCount,
  waitReady,
  renderLoop
};
