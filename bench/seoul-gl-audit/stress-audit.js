import maplibregl from 'maplibre-gl';
import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import WebGLVectorTileLayer from 'ol/layer/WebGLVectorTile.js';
import VectorTileSource from 'ol/source/VectorTile.js';
import MVT from 'ol/format/MVT.js';
import { fromLonLat, transformExtent } from 'ol/proj.js';

// Only the first 18 style entries reference distinct MVT source layers.
// 24-128 entries repeat those source layers and intentionally measure synthetic overdraw / style-rule scaling.
// MapLibre has N style layers; OpenLayers has ONE WebGLVectorTileLayer with N rules.
const specs = [
  ['building','fill','#b7a99d'],
  ['road','line','#b97e56'],
  ['water','fill','#81b8d9'],
  ['poi','point','#b85542'],
  ['landuse','fill','#cee0ba'],
  ['landcover','fill','#bfdcb4'],
  ['railway','line','#73787e'],
  ['pathway','line','#a08e77'],
  ['leisure','fill','#bee1a6'],
  ['transport','point','#4874a4'],
  ['building_part','fill','#aa9d90'],
  ['waterway','line','#77a8d0'],
  ['place','point','#625481'],
  ['boundary','line','#a89c9e'],
  ['power','line','#c6a45b'],
  ['aeroway','line','#adb2b8'],
  ['aeroway_area','fill','#d3d8d9'],
  ['housenumber','point','#777777']
].map(([id,kind,color])=>({id,kind,color}));

function selectedLayers(count) {
  if(![18,24,32,48,64,96,128].includes(count)) throw Error('UNSUPPORTED_COUNT '+count);
  return Array.from({length:count},(_,i)=>({...specs[i%specs.length],styleId:'scale-'+i}));
}
function mlStyle(layers) {
  return {
    version:8,
    // Match OpenLayers' immediate style application; exclude MapLibre's default 300ms transition from idle timing.
    transition:{duration:0,delay:0},
    sources:{osm:{
      type:'vector',tiles:[location.origin+'/tiles/{z}/{x}/{y}.pbf'],
      minzoom:12,maxzoom:16,bounds:[126.76,37.38,127.20,37.72]
    }},
    layers:layers.map(d=>{
      const type=d.kind==='point'?'circle':d.kind;
      const entry={id:d.styleId,type,source:'osm','source-layer':d.id};
      if(type==='fill') entry.paint={'fill-color':d.color,'fill-opacity':1,'fill-antialias':false};
      if(type==='line') entry.paint={'line-color':d.color,'line-width':1.5,'line-opacity':1};
      if(type==='circle') entry.paint={'circle-color':d.color,'circle-radius':3,'circle-opacity':1};
      return entry;
    })
  };
}
function olStyle(layers) {
  return layers.map(d=>{
    const style=d.kind==='fill'?{'fill-color':d.color}:
      d.kind==='line'?{'stroke-color':d.color,'stroke-width':1.5}:
      {'circle-radius':3,'circle-fill-color':d.color};
    return {filter:['==',['get','layer'],d.id],style};
  });
}
function boundedPromise(attach, ms=20000) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('COMPLETE_EVENT_TIMEOUT')),ms);
    attach(()=>{clearTimeout(timer);resolve()});
  });
}
const twoRaf=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function extent(engine,map) {
  if(engine==='maplibre') {
    const b=map.getBounds();
    return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
  }
  return transformExtent(map.getView().calculateExtent(map.getSize()),'EPSG:3857','EPSG:4326');
}
function percentile(vals,p) {
  if(!vals.length)return null;
  const a=vals.slice().sort((x,y)=>x-y);
  return Math.round(a[Math.min(a.length-1,Math.max(0,Math.ceil(p*a.length)-1))]*100)/100;
}
async function waitReady(engine,map) {
  if(engine==='maplibre') {
    // If already idle, two animation frames are enough to observe the settled view.
    if(map.loaded()&&!map.isMoving()) return;
    await boundedPromise(resolve=>map.once('idle',resolve));
  } else {
    // Call render() so the next full-frame event is not missed after view.animate.
    const done=boundedPromise(resolve=>map.once('rendercomplete',resolve));
    map.render();
    await done;
  }
}
async function create(engine,lon,lat,zoom,count) {
  const layers=selectedLayers(count), host=document.getElementById('map');
  if(host.childNodes.length) throw Error('FRESH_PAGE_REQUIRED');
  window.__glAudit.setPhase('cold');
  const initial=performance.now();
  let map;
  const phases={};
  if(engine==='maplibre') {
    map=new maplibregl.Map({
      container:host,style:mlStyle(layers),center:[lon,lat],zoom,
      fadeDuration:0,interactive:false,attributionControl:false,
      preserveDrawingBuffer:true,renderWorldCopies:false
    });
    const load=boundedPromise(resolve=>map.once('load',()=>{phases.styleLoadMs=performance.now()-initial;resolve()}));
    const idle=boundedPromise(resolve=>map.once('idle',resolve));
    await Promise.all([load,idle]);
  } else if(engine==='openlayers') {
    map=new OlMap({
      layers:[new WebGLVectorTileLayer({
        source:new VectorTileSource({format:new MVT(),url:'/tiles/{z}/{x}/{y}.pbf',maxZoom:16,wrapX:false}),
        style:olStyle(layers)
      })],
      view:new View({center:fromLonLat([lon,lat]),zoom:zoom+1,enableRotation:false}),
      controls:[],interactions:[]
    });
    const done=boundedPromise(resolve=>map.once('rendercomplete',resolve));
    map.setTarget(host);
    await done;
  }
  await twoRaf();
  const coldMs=performance.now()-initial;
  return {map,coldMs,phases,extent:extent(engine,map),coldGL:window.__glAudit.snapshot('cold')};
}
async function moveAndMeasure(engine,map,longitude,latitude,zoom,durationMs,phaseName) {
  window.__glAudit.setPhase(phaseName);
  const t0=performance.now(), frameTimestamps=[], rafTimestamps=[];
  const eventName=engine==='maplibre'?'render':'postrender';
  const onRender=()=>frameTimestamps.push(performance.now());
  map.on(eventName,onRender);
  let stopRaf=false;
  function recordRaf(t){if(stopRaf)return;rafTimestamps.push(t);requestAnimationFrame(recordRaf)}
  requestAnimationFrame(recordRaf);
  try {
    if(engine==='maplibre') {
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('MAPLIBRE_MOVEEND_TIMEOUT')),20000);
        map.once('moveend',()=>{clearTimeout(timeout);resolve()});
        map.easeTo({center:[longitude,latitude],zoom,duration:durationMs,easing:t=>t});
      });
    } else {
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('OL_ANIMATE_TIMEOUT')),20000);
        map.getView().animate({
          center:fromLonLat([longitude,latitude]),zoom:zoom+1,
          duration:durationMs,easing:t=>t
        },completed=>{
          clearTimeout(timeout);
          if(completed)resolve();else reject(Error('OL_ANIMATION_CANCELLED'));
        });
      });
    }
    await waitReady(engine,map);
    await twoRaf();
  } finally {
    stopRaf=true;
    if(engine==='maplibre')map.off(eventName,onRender);
    else map.un(eventName,onRender);
  }
  const intervals=a=>a.slice(1).map((v,i)=>v-a[i]).filter(n=>n>0);
  const frames=intervals(frameTimestamps), rafs=intervals(rafTimestamps);
  return {
    settleMs:Math.round((performance.now()-t0)*100)/100,
    renderEvents:frameTimestamps.length,
    renderFrameP50Ms:percentile(frames,0.5),
    renderFrameP95Ms:percentile(frames,0.95),
    rafFrames:rafTimestamps.length,
    rafP50Ms:percentile(rafs,0.5),
    rafP95Ms:percentile(rafs,0.95),
    extent:extent(engine,map),
    gl:window.__glAudit.snapshot(phaseName)
  };
}
async function run({engine,lon,lat,zoom=16,count=18,durationMs=850}) {
  const {map,coldMs,phases,extent:initialExtent,coldGL}=await create(engine,lon,lat,zoom,count);
  window.__extendedMap=map;
  const forward=await moveAndMeasure(engine,map,lon+0.006,lat+0.002,zoom+0.3,durationMs,'forward');
  const back=await moveAndMeasure(engine,map,lon,lat,zoom,durationMs,'back');
  window.__glAudit.setPhase('singleRedraw');
  const startRedraw=performance.now();
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('SINGLE_REDRAW_TIMEOUT')),12000);
    if(engine==='maplibre'){
      map.once('render',()=>{clearTimeout(timer);resolve()});
      map.triggerRepaint();
    }else{
      map.once('postrender',()=>{clearTimeout(timer);resolve()});
      map.renderSync();
    }
  });
  const redrawEventMs=performance.now()-startRedraw;
  const singleRedrawGL=window.__glAudit.snapshot('singleRedraw');
  const canvas=document.querySelector('#map canvas');
  return {
    engine,count,zoom,initialExtent,phases,
    coldMs:Math.round(coldMs*100)/100,
    coldGL,forward,back,
    singleRedrawGL,redrawEventMs:Math.round(redrawEventMs*100)/100,
    auditInfo:window.__glAudit.info(),canvas:{width:canvas?.width||0,height:canvas?.height||0}
  };
}
window.__seoulExtended={run,specs,version:'v4-audited-18-to-128'};
