import 'ol/ol.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import MVT from 'ol/format/MVT.js';
import VectorTileLayer from 'ol/layer/VectorTile.js';
import WebGLVectorTileLayer from 'ol/layer/WebGLVectorTile.js';
import VectorTileSource from 'ol/source/VectorTile.js';
import {fromLonLat} from 'ol/proj.js';

const params = new URLSearchParams(location.search);
const renderer = params.get('renderer') === 'webgl' ? 'webgl' : 'canvas';
const requestedCount = Number(params.get('layers') || 1);

const sourceLayerNames = [
  'aerialway','aerialway_label','archipelago_label','aviation','aviation_line',
  'bridge','bridge_label','building','building_number','cemetery',
  'city_label','commercial','construction','continent_label','country_border',
  'country_border_disputed','country_disputed_label','country_label','dam','education',
  'farmland','ferry','ferry_label','forest','grass',
  'hospital','ice','industrial','island_label','leisure',
  'military','military_label','parking','pathway','pathway_label',
  'pedestrian','pedestrian_label','pier','place_label','poi_accommodation',
  'poi_culture','poi_education','poi_food','poi_healthcare','poi_public',
  'poi_shopping','poi_sport','poi_station','poi_tourism','poi_transport'
];

const count = Math.max(1, Math.min(requestedCount, sourceLayerNames.length));

const source = new VectorTileSource({
  format: new MVT(),
  url: '/tiles/{z}/{x}/{y}.pbf',
  maxZoom: 14
});

const stats = {pending: 0, started: 0, loaded: 0, errors: 0, lastEvent: performance.now()};
source.on('tileloadstart', () => {
  stats.pending++;
  stats.started++;
  stats.lastEvent = performance.now();
});
source.on('tileloadend', () => {
  stats.pending = Math.max(0, stats.pending - 1);
  stats.loaded++;
  stats.lastEvent = performance.now();
});
source.on('tileloaderror', () => {
  stats.pending = Math.max(0, stats.pending - 1);
  stats.errors++;
  stats.lastEvent = performance.now();
});

function rulesFor(name, index) {
  const hue = (index * 47) % 360;
  const layerFilter = ['==', ['get', 'layer'], name];
  return [
    {
      filter: ['all', layerFilter, ['==', ['geometry-type'], 'Polygon']],
      style: {
        'fill-color': 'hsla(' + hue + ',38%,67%,0.38)',
        'stroke-color': 'hsla(' + hue + ',45%,40%,0.78)',
        'stroke-width': 0.8
      }
    },
    {
      filter: ['all', layerFilter, ['==', ['geometry-type'], 'LineString']],
      style: {
        'stroke-color': 'hsla(' + hue + ',55%,38%,0.88)',
        'stroke-width': 1.4
      }
    },
    {
      filter: ['all', layerFilter, ['==', ['geometry-type'], 'Point']],
      style: {
        'circle-radius': 2.8,
        'circle-fill-color': 'hsla(' + hue + ',55%,42%,0.85)',
        'circle-stroke-color': 'rgba(255,255,255,0.8)',
        'circle-stroke-width': 0.8
      }
    }
  ];
}

const layers = sourceLayerNames.slice(0, count).map((name, index) => {
  const options = {source, style: rulesFor(name, index), zIndex: index};
  const layer = renderer === 'webgl'
    ? new WebGLVectorTileLayer(options)
    : new VectorTileLayer(options);
  layer.set('sourceLayerName', name);
  return layer;
});

const map = new Map({
  target: 'map',
  layers,
  controls: [],
  interactions: [],
  view: new View({
    center: fromLonLat([126.978, 37.5665]),
    zoom: 13
  })
});

async function waitIdle(timeoutMs = 2500) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (stats.pending === 0 && performance.now() - stats.lastEvent > 300) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  map.renderSync();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {
    elapsedMs: performance.now() - start,
    timedOut: stats.pending !== 0,
    pending: stats.pending
  };
}

globalThis.olSharedBench = {
  map,
  source,
  layers,
  stats,
  renderer,
  count,
  sourceLayerNames: sourceLayerNames.slice(0, count),
  fromLonLat,
  waitIdle
};
