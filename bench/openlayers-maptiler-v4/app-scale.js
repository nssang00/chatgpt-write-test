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

function styleFor(name, index) {
  const hue = (index * 47) % 360;
  const isLabel = name.includes('label') || name === 'building_number';
  const isPoi = name.startsWith('poi_');
  const isLine = [
    'aerialway','aviation_line','country_border','country_border_disputed',
    'ferry','pathway'
  ].includes(name);
  if (isLabel || isPoi) {
    return {
      'circle-radius': 2.8,
      'circle-fill-color': 'hsla(' + hue + ',55%,42%,0.85)',
      'circle-stroke-color': 'rgba(255,255,255,0.8)',
      'circle-stroke-width': 0.8
    };
  }
  if (isLine) {
    return {
      'stroke-color': 'hsla(' + hue + ',50%,42%,0.85)',
      'stroke-width': 1.3
    };
  }
  return {
    'fill-color': 'hsla(' + hue + ',38%,67%,0.38)',
    'stroke-color': 'hsla(' + hue + ',45%,40%,0.78)',
    'stroke-width': 0.8,
    'circle-radius': 2.4,
    'circle-fill-color': 'hsla(' + hue + ',55%,42%,0.8)'
  };
}

const stats = {pending: 0, started: 0, loaded: 0, errors: 0, lastEvent: performance.now()};
const sources = [];
const layers = [];

for (let i = 0; i < count; i++) {
  const name = sourceLayerNames[i];
  const source = new VectorTileSource({
    format: new MVT({layers: [name]}),
    url: '/tiles/{z}/{x}/{y}.pbf',
    maxZoom: 14
  });
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

  const options = {source, style: styleFor(name, i), zIndex: i};
  const layer = renderer === 'webgl'
    ? new WebGLVectorTileLayer(options)
    : new VectorTileLayer(options);
  layer.set('sourceLayerName', name);
  sources.push(source);
  layers.push(layer);
}

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
    if (stats.pending === 0 && performance.now() - stats.lastEvent > 350) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  map.renderSync();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {
    elapsedMs: performance.now() - start,
    timedOut: stats.pending !== 0,
    pending: stats.pending
  };
}

globalThis.olScaleBench = {
  map,
  sources,
  layers,
  stats,
  renderer,
  count,
  sourceLayerNames: sourceLayerNames.slice(0, count),
  fromLonLat,
  waitIdle
};
