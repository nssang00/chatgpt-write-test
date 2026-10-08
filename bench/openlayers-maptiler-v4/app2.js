import 'ol/ol.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import MVT from 'ol/format/MVT.js';
import VectorTileLayer from 'ol/layer/VectorTile.js';
import WebGLVectorTileLayer from 'ol/layer/WebGLVectorTile.js';
import VectorTileSource from 'ol/source/VectorTile.js';
import {fromLonLat} from 'ol/proj.js';

const renderer = new URLSearchParams(location.search).get('renderer') || 'vector';
const source = new VectorTileSource({
  format: new MVT(),
  url: '/tiles/{z}/{x}/{y}.pbf',
  maxZoom: 14
});
const style = {
  'fill-color': 'rgba(214,226,210,0.72)',
  'stroke-color': 'rgba(191,111,78,0.88)',
  'stroke-width': 1
};
const layer = renderer === 'webgl'
  ? new WebGLVectorTileLayer({source, style})
  : new VectorTileLayer({source, style});
const map = new Map({
  target: 'map',
  layers: [layer],
  controls: [],
  interactions: [],
  view: new View({center: fromLonLat([126.978, 37.5665]), zoom: 13})
});
globalThis.olBench = {map, source, renderer, fromLonLat};
