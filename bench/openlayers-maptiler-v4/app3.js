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

const anyLayer = (names) => [
  'any',
  ...names.map((name) => ['==', ['get', 'layer'], name])
];

const groups = [
  {
    name: 'nature',
    rules: [{
      filter: anyLayer(['forest','grass','farmland','vegetation','wood','sand','rock','wetland','protected_area','ice']),
      style: {'fill-color':'rgba(197,220,183,0.78)','stroke-color':'rgba(161,190,145,0.45)','stroke-width':0.5}
    }]
  },
  {
    name: 'water',
    rules: [
      {filter:anyLayer(['water']), style:{'fill-color':'rgba(153,204,238,0.88)'}},
      {filter:anyLayer(['waterway']), style:{'stroke-color':'rgba(111,174,218,0.95)','stroke-width':1.2}}
    ]
  },
  {
    name: 'builtup',
    rules: [{
      filter:anyLayer(['residential','commercial','industrial','education','hospital','cemetery','construction','military','leisure','parking']),
      style:{'fill-color':'rgba(225,218,211,0.72)','stroke-color':'rgba(195,185,176,0.55)','stroke-width':0.6}
    }]
  },
  {
    name: 'transport-surfaces',
    rules: [
      {filter:anyLayer(['aviation','bridge','pedestrian','dam','pier']), style:{'fill-color':'rgba(235,230,220,0.85)','stroke-color':'rgba(182,170,155,0.8)','stroke-width':0.8}},
      {filter:anyLayer(['ferry']), style:{'stroke-color':'rgba(89,151,194,0.9)','stroke-width':1.1}}
    ]
  },
  {
    name: 'roads',
    rules: [
      {filter:['all',anyLayer(['road']),['any',['==',['get','class'],'motorway'],['==',['get','class'],'trunk'],['==',['get','class'],'primary']]],style:{'stroke-color':'rgba(224,143,98,0.95)','stroke-width':2.4}},
      {filter:anyLayer(['road','pathway']),else:true,style:{'stroke-color':'rgba(175,160,148,0.9)','stroke-width':1.1}}
    ]
  },
  {
    name: 'rail-transit',
    rules: [
      {filter:anyLayer(['railway','subway']),style:{'stroke-color':'rgba(92,92,100,0.9)','stroke-width':1.2}},
      {filter:anyLayer(['aerialway','aviation_line']),style:{'stroke-color':'rgba(125,115,105,0.78)','stroke-width':0.9}}
    ]
  },
  {
    name: 'buildings',
    rules: [{
      filter:anyLayer(['building']),
      style:{'fill-color':'rgba(220,204,190,0.88)','stroke-color':'rgba(184,163,147,0.9)','stroke-width':0.7}
    }]
  },
  {
    name: 'labels-poi',
    rules: [
      {
        filter:anyLayer(['city_label','town_label','place_label','country_label','state_label','island_label','water_centroid']),
        style:{
          'text-value':['get','name'],
          'text-font':'12px sans-serif',
          'text-fill-color':'#29333d',
          'text-stroke-color':'rgba(255,255,255,0.9)',
          'text-stroke-width':2
        }
      },
      {
        filter:anyLayer(['poi_accommodation','poi_culture','poi_education','poi_food','poi_healthcare','poi_public','poi_shopping','poi_sport','poi_station','poi_tourism','poi_transport','road_exit','traffic_control']),
        style:{'circle-radius':2.5,'circle-fill-color':'#805c48','circle-stroke-color':'rgba(255,255,255,0.8)','circle-stroke-width':0.8}
      }
    ]
  }
];

function createLayer(group, zIndex) {
  const options = {source, style: group.rules, zIndex};
  const layer = renderer === 'webgl'
    ? new WebGLVectorTileLayer(options)
    : new VectorTileLayer(options);
  layer.set('benchmarkGroup', group.name);
  return layer;
}

const layers = groups.map((group, index) => createLayer(group, index));

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
  source,
  renderer,
  fromLonLat,
  layerCount: layers.length,
  layerNames: groups.map((group) => group.name)
};
