import maplibregl from 'maplibre-gl';

const specs = [
  {id:'building',kind:'fill',color:'#b7a99d'},
  {id:'road',kind:'line',color:'#b97e56'},
  {id:'water',kind:'fill',color:'#81b8d9'},
  {id:'poi',kind:'point',color:'#b85542'},
  {id:'landuse',kind:'fill',color:'#cee0ba'},
  {id:'landcover',kind:'fill',color:'#bfdcb4'},
  {id:'railway',kind:'line',color:'#73787e'},
  {id:'pathway',kind:'line',color:'#a08e77'},
  {id:'leisure',kind:'fill',color:'#bee1a6'},
  {id:'transport',kind:'point',color:'#4874a4'},
  {id:'building_part',kind:'fill',color:'#aa9d90'},
  {id:'waterway',kind:'line',color:'#77a8d0'},
  {id:'place',kind:'point',color:'#625481'},
  {id:'boundary',kind:'line',color:'#a89c9e'},
  {id:'power',kind:'line',color:'#c6a45b'},
  {id:'aeroway',kind:'line',color:'#adb2b8'},
  {id:'aeroway_area',kind:'fill',color:'#d3d8d9'},
  {id:'housenumber',kind:'point',color:'#777777'}
];

function style(count, transitionMs) {
  const s = {
    version:8,
    sources:{osm:{type:'vector',tiles:[location.origin+'/tiles/{z}/{x}/{y}.pbf'],
      minzoom:12,maxzoom:16,bounds:[126.76,37.38,127.20,37.72]}},
    layers:specs.slice(0,count).map((d,i)=>{
      const type=d.kind==='point'?'circle':d.kind;
      const result={id:'compare-'+i,type,source:'osm','source-layer':d.id};
      if(type==='fill')result.paint={'fill-color':d.color,'fill-opacity':1,'fill-antialias':false};
      if(type==='line')result.paint={'line-color':d.color,'line-width':1.5,'line-opacity':1};
      if(type==='circle')result.paint={'circle-color':d.color,'circle-radius':3,'circle-opacity':1};
      return result;
    })
  };
  if(transitionMs !== null) s.transition = {duration:transitionMs,delay:0};
  return s;
}
function timeout(p, ms=12000) {
  return Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('EVENT_TIMEOUT_'+ms)),ms))]);
}
const twice=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

async function run({count,transitionMs,lon=127.0276,lat=37.4979,zoom=16}) {
  if(document.getElementById('map').childNodes.length)throw Error('FRESH_PAGE_REQUIRED');
  const t0=performance.now(), events={};
  const map=new maplibregl.Map({
    container:'map',style:style(count,transitionMs),
    center:[lon,lat],zoom,interactive:false,attributionControl:false,
    preserveDrawingBuffer:true,fadeDuration:0,renderWorldCopies:false
  });
  window.__probeMap=map;
  let frames=0;
  map.on('render',()=>{frames++;if(events.firstRenderMs===undefined)events.firstRenderMs=performance.now()-t0;});
  const styleP=map.once('style.load').then(()=>events.styleReadyMs=performance.now()-t0);
  const loadP=map.once('load').then(()=>events.loadMs=performance.now()-t0);
  const idleP=map.once('idle').then(()=>events.idleMs=performance.now()-t0);
  await timeout(Promise.all([styleP,loadP,idleP]));
  await twice();
  const finishMs=performance.now()-t0;
  return {
    count,transitionMs,events,finishMs,renderFrames:frames,
    isStyleLoaded:map.isStyleLoaded(),loaded:map.loaded(),
    layerCount:map.getStyle().layers.length,
    canvasSize:[map.getCanvas().width,map.getCanvas().height]
  };
}
window.__transitionProbe={run};
