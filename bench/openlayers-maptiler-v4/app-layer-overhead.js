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
const layerCount = Math.max(1, Math.min(50, Number(params.get('layers') || 1)));
const totalFeatures = 500;
const tileGrid = createXYZ({maxZoom: 0, tileSize: 512});

let pending = 0;
let loaded = 0;
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
    const side = Math.ceil(Math.sqrt(totalFeatures));
    const sx = width / side;
    const sy = height / side;
    const features = new Array(totalFeatures);

    for (let i = 0; i < totalFeatures; i++) {
      const gx = i % side;
      const gy = Math.floor(i / side);
      const x = minX + (gx + 0.5) * sx;
      const y = minY + (gy + 0.5) * sy;
      const group = i % layerCount;
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

      features[i] = new Feature({geometry, group});
    }

    buildMs = performance.now() - t0;
    tile.setFeatures(features);
  }
});

source.on('tileloadstart', () => pending++);
source.on('tileloadend', () => {
  pending = Math.max(0, pending - 1);
  loaded++;
});
source.on('tileloaderror', () => pending = Math.max(0, pending - 1));

function styleFor(group) {
  const hue = (group * 47) % 360;
  const groupFilter = ['==', ['get', 'group'], group];
  return [
    {
      filter: ['all', groupFilter, ['==', ['geometry-type'], 'LineString']],
      style: {
        'stroke-color': 'hsla(' + hue + ',55%,38%,0.9)',
        'stroke-width': 1.2
      }
    },
    {
      filter: ['all', groupFilter, ['==', ['geometry-type'], 'Point']],
      style: {
        'circle-radius': 2.1,
        'circle-fill-color': 'hsla(' + hue + ',55%,42%,0.85)'
      }
    },
    {
      filter: ['all', groupFilter, ['==', ['geometry-type'], 'Polygon']],
      style: {
        'fill-color': 'hsla(' + hue + ',40%,65%,0.42)',
        'stroke-color': 'hsla(' + hue + ',45%,38%,0.72)',
        'stroke-width': 0.6
      }
    }
  ];
}

const layers = Array.from({length: layerCount}, (_, group) => {
  const options = {source, style: styleFor(group), zIndex: group};
  return renderer === 'webgl'
    ? new WebGLVectorTileLayer({ ...options, disableHitDetection: true })
    : new VectorTileLayer(options);
});

const map = new Map({
  target: 'map',
  layers,
  controls: [],
  interactions: [],
  view: new View({center: [0, 0], zoom: 0, minZoom: 0, maxZoom: 0})
});

async function waitLoaded(timeoutMs = 15000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (loaded > 0 && pending === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  map.renderSync();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {elapsedMs: performance.now() - start, timedOut: !(loaded > 0 && pending === 0), buildMs};
}

async function renderLoop(iterations = 6) {
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
  return durations;
}

globalThis.olLayerBench = {
  map,
  source,
  layers,
  renderer,
  layerCount,
  totalFeatures,
  waitLoaded,
  renderLoop
};
