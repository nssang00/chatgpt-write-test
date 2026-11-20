import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

// Real engine-native 3D Tiles path: Cesium3DTileset.fromUrl(tileset.json).
// This viewer does NOT construct its own geometry, do its own spatial
// scheduling, or load the full 215MB fixture.
const manifestRes=await fetch('/stream-manifest.json');
if(!manifestRes.ok)throw Error('Missing source manifest');
const manifest=await manifestRes.json();
const [lon,lat]=manifest.center;
const [fx,fy,fz]=manifest.focus;
const theta=.18;
const roadView=new URLSearchParams(location.search).has('roadview');
const baseEye=roadView?[fx+100,fy+75,fz-155]:[fx+250*Math.sin(theta)+120,fy+155,fz-360*Math.cos(theta)];
const baseTarget=roadView?[fx,fy-42,fz]:[fx,fy,fz];
const viewer=new Cesium.Viewer('mount',{
  animation:false,timeline:false,geocoder:false,homeButton:false,
  baseLayerPicker:false,sceneModePicker:false,navigationHelpButton:false,
  selectionIndicator:false,infoBox:false,fullscreenButton:false,
  baseLayer:false,globe:false,skyBox:false,skyAtmosphere:false,
  requestRenderMode:false,
  contextOptions:{webgl:{alpha:false,antialias:false,preserveDrawingBuffer:true}}
});
const scene=viewer.scene;
scene.backgroundColor=Cesium.Color.fromCssColorString('#acbdcb');
scene.screenSpaceCameraController.enableInputs=false;
viewer.camera.frustum.fov=2*Math.atan(Math.tan(Math.PI/6)*(1280/720));
const frame=Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(lon,lat,0));
const up=Cesium.Matrix4.multiplyByPointAsVector(frame,new Cesium.Cartesian3(0,0,1),new Cesium.Cartesian3());
Cesium.Cartesian3.normalize(up,up);
const toWorld=([x,y,z])=>Cesium.Matrix4.multiplyByPoint(frame,new Cesium.Cartesian3(x,z,y),new Cesium.Cartesian3());
let rendered=0,pan=0;
scene.postRender.addEventListener(()=>rendered++);
function move(value){
  pan=value;
  const eye=[baseEye[0]+pan,baseEye[1],baseEye[2]];
  const target=[baseTarget[0]+pan,baseTarget[1],baseTarget[2]];
  const pos=toWorld(eye),toward=toWorld(target);
  const direction=Cesium.Cartesian3.subtract(toward,pos,new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(direction,direction);
  viewer.camera.setView({destination:pos,orientation:{direction,up}});
}
move(0);
const stats={
  startedAt:performance.now(),requests:0,success:0,aborts:0,errors:0,evictions:0,
  swaps:0,bytesFetched:0,loadedTriangles:0,activeTriangles:0,peakActiveTriangles:0,
  activeTiles:0,peakActiveTiles:0,firstTileMs:null,uploads:[],
  peakHeapBytes:0,totalRequestedBytes:0,frameSteps:0
};
let tileset;
try{
  tileset=await Cesium.Cesium3DTileset.fromUrl('/native-3dtiles/tileset.json',{
    maximumScreenSpaceError:16,
    cacheBytes:512*1024*1024,
    skipLevelOfDetail:false,
    dynamicScreenSpaceError:false
  });
}catch(e){
  console.error('CESIUM_NATIVE_3DTILES_LOAD_FAILED',e);
  throw e;
}
tileset.tileLoad.addEventListener(tile=>{
  stats.success++;
  stats.requests++;
  stats.activeTiles++;
  stats.peakActiveTiles=Math.max(stats.peakActiveTiles,stats.activeTiles);
  if(stats.firstTileMs===null)stats.firstTileMs=performance.now()-stats.startedAt;
});
tileset.tileUnload.addEventListener(tile=>{
  stats.evictions++;
  stats.activeTiles=Math.max(0,stats.activeTiles-1);
});
tileset.tileFailed.addEventListener(error=>{
  stats.errors++;
  console.error('CESIUM_NATIVE_TILE_FAILED',error);
});
scene.primitives.add(tileset);
const gl=viewer.canvas.getContext('webgl2');
if(!gl)throw Error('WebGL2 unavailable for native Cesium');
const ext=gl.getExtension('WEBGL_debug_renderer_info');
const gpu={
  vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),
  renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)
};
const info=document.getElementById('info');
window.__streamBench={
  ready:true,engine:'cesium3dtileset',
  manifest:{
    area:manifest.area,dem:manifest.dataSource,buildingCount:manifest.buildingCount,
    grid:manifest.grid,tiles:manifest.tiles.length,triangles:manifest.totals,
    tileFormat:'OGC 3D Tiles 1.1 GLB',rendererPath:'Cesium3DTileset.fromUrl',
    lodPolicy:'screen-space error 16 px, REPLACE high/low per tile'
  },
  gpu,
  get rendered(){return rendered;},
  stats,
  get pending(){return 0;}, // Native Cesium scheduler is opaque.
  get activeTiles(){return stats.activeTiles;},
  move:(meters)=>{
    move(meters);
    stats.frameSteps++;
    if(performance.memory?.usedJSHeapSize)
      stats.peakHeapBytes=Math.max(stats.peakHeapBytes,performance.memory.usedJSHeapSize);
    info.textContent='CESIUM 3D TILES | '+stats.success+' loaded | '+stats.activeTiles+
      ' active | '+stats.evictions+' unloaded';
  },
  resetCounters:()=>{
    const copy={...stats};
    stats.requests=0;stats.success=0;stats.aborts=0;stats.errors=0;
    stats.evictions=0;stats.swaps=0;stats.bytesFetched=0;stats.totalRequestedBytes=0;
    stats.uploads=[];stats.peakHeapBytes=0;stats.firstTileMs=null;
    stats.peakActiveTiles=stats.activeTiles;stats.peakActiveTriangles=0;
    return copy;
  }
};
console.log('NATIVE_3DTILES_VIEWER_READY',JSON.stringify({
  gpu,tilesetRootGeometricError:tileset.root?.geometricError,
  maximumScreenSpaceError:tileset.maximumScreenSpaceError,
  url:'/native-3dtiles/tileset.json'
}));
