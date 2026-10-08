import 'ol/ol.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import MVT from 'ol/format/MVT.js';
import VectorTileLayer from 'ol/layer/VectorTile.js';
import WebGLVectorTileLayer from 'ol/layer/WebGLVectorTile.js';
import VectorTileSource from 'ol/source/VectorTile.js';
import {fromLonLat} from 'ol/proj.js';

const renderer = new URLSearchParams(location.search).get('renderer') || 'vector';

const groups = [
  {
    name: 'nature',
    sourceLayers: ['forest','grass','farmland','vegetation','wood','sand','rock','wetland','protected_area','ice'],
    style: {'fill-color':'rgba(197,220,183,0.78)','stroke-color':'rgba(161,190,145,0.45)','stroke-width':0.5}
  },
  {
    name: 'water',
    sourceLayers: ['water','waterway'],
    style: {'fill-color':'rgba(153,204,238,0.88)','stroke-color':'rgba(111,174,218,0.95)','stroke-width':1.1}
  },
  {
    name: 'builtup',
    sourceLayers: ['residential','commercial','industrial','education','hospital','cemetery','construction','military','leisure','parking'],
    style: {'fill-color':'rgba(225,218,211,0.72)','stroke-color':'rgba(195,185,176,0.55)','stroke-width':0.6}
  },
  {
    name: 'transport-surfaces',
    sourceLayers: ['aviation','bridge','pedestrian','dam','pier','ferry'],
    style: {'fill-color':'rgba(235,230,220,0.85)','stroke-color':'rgba(182,170,155,0.82)','stroke-width':0.9}
  },
  {
    name: 'roads',
    sourceLayers: ['road','pathway'],
    style: {'stroke-color':'rgba(208,129,87,0.94)','stroke-width':1.7}
  },
  {
    name: 'rail-transit',
    sourceLayers: ['railway','subway','aerialway','aviation_line'],
    style: {'stroke-color':'rgba(88,88,96,0.9)','stroke-width':1.15}
  },
  {
    name: 'buildings',
    sourceLayers: ['building'],
    style: {'fill-color':'rgba(220,204,190,0.88)','stroke-color':'rgba(184,163,147,0.9)','stroke-width':0.7}
  },
  {
    name: 'labels-poi',
    sourceLayers: [
      'city_label','town_label','place_label','country_label','state_label','island_label','water_centroid',
      'poi_accommodation','poi_culture','poi_education','poi_food','poi_healthcare','poi_public',
      'poi_shopping','poi_sport','poi_station','poi_tourism','poi_transport','road_exit','traffic_control'
    ],
    style: {
      'circle-radius':2.4,
      'circle-fill-color':'#805c48',
      'circle-stroke-color':'rgba(255,255,255,0.85)',
      'circle-stroke-width':0.8,
      'text-value':['get','name'],
      'text-font':'11px sans-serif',
      'text-fill-color':'#29333d',
      'text-stroke-color':'rgba(255,255,255,0.9)',
      'text-stroke-width':2,
      'text-offset-y':10
    }
  }
];

const sources = groups.map((group) => new VectorTileSource({
  format: new MVT({layers: group.sourceLayers}),
  url: '/tiles/{z}/{x}/{y}.pbf',
  maxZoom: 14
}));

const layers = groups.map((group, index) => {
  const options = {source: sources[index], style: group.style, zIndex: index};
  const layer = renderer === 'webgl'
    ? new WebGLVectorTileLayer(options)
    : new VectorTileLayer(options);
  layer.set('benchmarkGroup', group.name);
  return layer;
});

const sourceEvents = {
  on(type, listener) {
    for (const source of sources) source.on(type, listener);
  }
};

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

globalThis.olBench = {
  map,
  source: sourceEvents,
  sources,
  renderer,
  fromLonLat,
  layerCount: layers.length,
  layerNames: groups.map((group) => group.name)
};
