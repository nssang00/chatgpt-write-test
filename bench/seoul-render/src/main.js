import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import WebGLVectorTileLayer from 'ol/layer/WebGLVectorTile.js';
import VectorTileSource from 'ol/source/VectorTile.js';
import MVT from 'ol/format/MVT.js';
import { fromLonLat } from 'ol/proj.js';

const specs = [
  { id:'landuse', kind:'fill', color:'#d5e8c5' },
  { id:'landcover', kind:'fill', color:'#c2d9bd' },
  { id:'leisure', kind:'fill', color:'#c3e8bb' },
  { id:'water', kind:'fill', color:'#8bbfe3' },
  { id:'building', kind:'fill', color:'#c8b8aa' },
  { id:'building_part', kind:'fill', color:'#ada197' },
  { id:'aeroway_area', kind:'fill', color:'#d9dce1' },
  { id:'waterway', kind:'line', color:'#6eabd5', width:1.7 },
  { id:'road', kind:'line', color:'#db916b', width:1.5 },
  { id:'pathway', kind:'line', color:'#bd9f85', width:1.1 },
  { id:'railway', kind:'line', color:'#626774', width:1.4 },
  { id:'boundary', kind:'line', color:'#9687a0', width:1.2 },
  { id:'power', kind:'line', color:'#cc9e55', width:1.2 },
  { id:'aeroway', kind:'line', color:'#acb3ba', width:1.5 },
  { id:'poi', kind:'point', color:'#cb7153', radius:2.6 },
  { id:'place', kind:'point', color:'#6b5b95', radius:4.5 },
  { id:'transport', kind:'point', color:'#4874a4', radius:3.4 },
  { id:'housenumber', kind:'point', color:'#7f7971', radius:2.0 }
];

const suites = {
  polygons: specs.filter(x => x.kind === 'fill').map(x=>x.id),
  lines: specs.filter(x => x.kind === 'line').map(x=>x.id),
  points: specs.filter(x => x.kind === 'point').map(x=>x.id),
  all: specs.map(x=>x.id)
};

function actualRenderer() {
  const c=document.createElement('canvas');
  const gl=c.getContext('webgl2',{powerPreference:'high-performance'}) ||
    c.getContext('webgl',{powerPreference:'high-performance'});
  if (!gl) return {renderer:'NO_WEBGL',vendor:'',webgl:false};
  const ext=gl.getExtension('WEBGL_debug_renderer_info');
  const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  const vendor=ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR);
  const obj={renderer:String(renderer),vendor:String(vendor),webgl:true};
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return obj;
}
function raf2() {
  return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
}
function maplibreStyle(selected) {
  return {
    version:8,
    sources:{osm:{
      type:'vector',
      tiles:[window.location.origin+'/tiles/{z}/{x}/{y}.pbf'],
      minzoom:12, maxzoom:16,
      bounds:[126.76,37.38,127.20,37.72],
      attribution:'OpenStreetMap contributors'
    }},
    layers:selected.map(d=>{
      const common={id:'layer-'+d.id,type:d.kind==='point'?'circle':d.kind,source:'osm','source-layer':d.id};
      if(d.kind==='fill') common.paint={'fill-color':d.color,'fill-opacity':0.88,'fill-antialias':false};
      else if(d.kind==='line') common.paint={'line-color':d.color,'line-width':d.width,'line-opacity':1};
      else common.paint={'circle-color':d.color,'circle-radius':d.radius,'circle-opacity':1};
      return common;
    })
  };
}
function olRules(selected) {
  return selected.map(d=>{
    const style=d.kind==='fill'?{'fill-color':d.color}:
      d.kind==='line'?{'stroke-color':d.color,'stroke-width':d.width}:
      {'circle-radius':d.radius,'circle-fill-color':d.color};
    return {filter:['==',['get','layer'],d.id],style};
  });
}
async function run({engine,suite,lon,lat,zoom}) {
  const selected=specs.filter(x=>suites[suite]?.includes(x.id));
  if (!selected.length) throw Error('EMPTY_SUITE: '+suite);
  if(document.querySelector('#map').children.length) throw Error('Page must be fresh per sample');
  const gpu=actualRenderer();
  let map;
  const t0=performance.now();
  if(engine==='maplibre') {
    map=new maplibregl.Map({
      container:'map', style:maplibreStyle(selected),
      center:[lon,lat],zoom,
      interactive:false, attributionControl:false,
      fadeDuration:0, renderWorldCopies:false,
      preserveDrawingBuffer:true
    });
    window.__map=map;
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('MAPLIBRE_IDLE_TIMEOUT')),30000);
      map.once('idle',()=>{clearTimeout(timeout);resolve()});
      map.on('error',e=>{clearTimeout(timeout);reject(Error('MAPLIBRE_ERROR: '+String(e.error?.message||e.error||e)))});
    });
  } else if(engine==='openlayers') {
    const source=new VectorTileSource({
      format:new MVT(), url:'/tiles/{z}/{x}/{y}.pbf',
      maxZoom:16, wrapX:false
    });
    const layer=new WebGLVectorTileLayer({
      source, style:olRules(selected)
    });
    map=new OlMap({
      layers:[layer],
      // OL zoom is based on a 256px world tile; MapLibre's zoom is based on 512px.
      // Add one zoom level so their geographic viewport extents match.
      view:new View({center:fromLonLat([lon,lat]),zoom:zoom+1,enableRotation:false}),
      controls:[],interactions:[],
    });
    window.__map=map;
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('OPENLAYERS_RENDERCOMPLETE_TIMEOUT')),30000);
      map.once('rendercomplete',()=>{clearTimeout(timeout);resolve()});
      map.once('error',e=>{clearTimeout(timeout);reject(Error('OPENLAYERS_ERROR: '+String(e)))});
      map.setTarget(document.querySelector('#map'));
    });
  } else {
    throw Error('Unknown engine '+engine);
  }
  await raf2();
  const elapsedMs=performance.now()-t0;
  const canvas=document.querySelector('#map canvas');
  return {elapsedMs,gpu,canvas:{width:canvas?.width||0,height:canvas?.height||0},layerIds:selected.map(x=>x.id)};
}
window.__seoulBench={run,suites,specs,gpu:actualRenderer()};
