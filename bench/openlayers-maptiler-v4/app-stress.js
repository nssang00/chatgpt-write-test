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

const layerCount = 50;
const featuresPerLayer = 10000;
const featureCount = layerCount * featuresPerLayer;
const tileGrid = createXYZ({maxZoom: 0, tileSize: 512});

let loadedSources = 0;
let totalFeatureBuildMs = 0;

function styleFor(layerIndex) {
  const hue = (layerIndex * 47) % 360;
  return [
    {
      filter: ['==', ['geometry-type'], 'LineString'],
      style: {
        'stroke-color': 'hsla(' + hue + ',58%,42%,0.82)',
        'stroke-width': 1.0
      }
    },
    {
      filter: ['==', ['geometry-type'], 'Point'],
      style: {
        'circle-radius': 1.7,
        'circle-fill-color': 'hsla(' + hue + ',62%,45%,0.82)'
      }
    },
    {
      filter: ['==', ['geometry-type'], 'Polygon'],
      style: {
        'fill-color': 'hsla(' + hue + ',45%,62%,0.38)',
        'stroke-color': 'hsla(' + hue + ',50%,38%,0.62)',
        'stroke-width': 0.55
      }
    }
  ];
}

function createSource(layerIndex) {
  return new VectorTileSource({
    tileGrid,
    tileUrlFunction: (tileCoord) => layerIndex + '/' + tileCoord.join('/'),
    tileLoadFunction(tile) {
      const t0 = performance.now();
      const extent = tileGrid.getTileCoordExtent(tile.getTileCoord());
      const minX = extent[0];
      const minY = extent[1];
      const width = extent[2] - extent[0];
      const height = extent[3] - extent[1];

      const side = Math.ceil(Math.sqrt(featuresPerLayer));
      const sx = width / side;
      const sy = height / side;
      const features = new Array(featuresPerLayer);

      for (let i = 0; i < featuresPerLayer; i++) {
        const gx = i % side;
        const gy = Math.floor(i / side);
        const jitterX = ((layerIndex % 10) - 5) * sx * 0.025;
        const jitterY = (Math.floor(layerIndex / 10) - 2) * sy * 0.025;
        const x = minX + (gx + 0.5) * sx + jitterX;
        const y = minY + (gy + 0.5) * sy + jitterY;
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

        features[i] = new Feature({geometry});
      }

      totalFeatureBuildMs += performance.now() - t0;
      tile.setFeatures(features);
      loadedSources++;
    }
  });
}

const sources = [];
const layers = [];

for (let i = 0; i < layerCount; i++) {
  const source = createSource(i);
  const options = {
    source,
    style: styleFor(i),
    zIndex: i
  };
  const layer = renderer === 'webgl'
    ? new WebGLVectorTileLayer({...options, disableHitDetection: true})
    : new VectorTileLayer(options);

  sources.push(source);
  layers.push(layer);
}

const map = new Map({
  target: 'map',
  layers,
  controls: [],
  interactions: [],
  view: new View({
    center: [0, 0],
    zoom: 0,
    minZoom: 0,
    maxZoom: 0
  })
});

async function waitReady(timeoutMs = 120000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (loadedSources >= layerCount) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  map.renderSync();
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );

  return {
    elapsedMs: performance.now() - start,
    featureBuildMs: totalFeatureBuildMs,
    loadedSources,
    timedOut: loadedSources < layerCount
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
  sources,
  layers,
  renderer,
  featureCount,
  featuresPerLayer,
  layerCount,
  waitReady,
  renderLoop
};
