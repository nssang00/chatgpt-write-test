import * as Cesium from 'cesium';
import * as pc from 'playcanvas';
import * as THREE from 'three';
import * as BABYLON from '@babylonjs/core';
import 'cesium/Build/Cesium/Widgets/widgets.css';

const engineName=new URLSearchParams(location.search).get('engine')||'cesium';
const manifestResponse=await fetch('/stream-manifest.json',{cache:'no-store'});
if(!manifestResponse.ok)throw Error('Missing streamed Seoul manifest');
const manifest=await manifestResponse.json();
if(manifest.buildingCount<1000)throw Error('Dense Seoul test is not dense enough');
const mount=document.getElementById('mount');
const status=document.getElementById('info');
const center=manifest.center;
const lon=center[0],lat=center[1];
let renderCount=0;
const canvas=document.createElement('canvas');
canvas.width=1280;canvas.height=720;
canvas.style.width='100%';canvas.style.height='100%';
let api;
const materialCache=new Map();
const getColor=(key)=>manifest.palette[key];
const sequentialIndices=(n)=>Uint32Array.from({length:n},(_,i)=>i);
const flipped=(p)=>{
  const o=new Float32Array(p);
  for(let i=2;i<o.length;i+=3)o[i]=-o[i];
  return o;
};
const black=[.075,.14,.18],sky=[.674,.741,.796];
const [fx,fy,fz]=manifest.focus;
const theta=.18;
const baseEye=[fx+250*Math.sin(theta)+120,fy+155,fz-360*Math.cos(theta)];
const baseTarget=[fx,fy,fz];
function worldEye(pan){return [baseEye[0]+pan,baseEye[1],baseEye[2]];}
function worldTarget(pan){return [baseTarget[0]+pan,baseTarget[1],baseTarget[2]];}

if(engineName==='cesium'){
  const viewer=new Cesium.Viewer(mount,{
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
  scene.postRender.addEventListener(()=>renderCount++);
  api={
    canvas:viewer.canvas,
    move:(pan)=>{
      const pos=toWorld(worldEye(pan)),target=toWorld(worldTarget(pan));
      const dir=Cesium.Cartesian3.subtract(target,pos,new Cesium.Cartesian3());
      Cesium.Cartesian3.normalize(dir,dir);
      viewer.camera.setView({destination:pos,orientation:{direction:dir,up}});
    },
    add:(materials)=>{
      const primitives=[];
      for(const [name,p] of Object.entries(materials)){
        if(p.length===0)continue;
        const v=new Float64Array(p.length);
        const normal=new Float32Array(p.length);
        for(let i=0;i<p.length;i+=3){
          v[i]=p[i];v[i+1]=p[i+2];v[i+2]=p[i+1];
          normal[i]=0;normal[i+1]=0;normal[i+2]=1;
        }
        const g=new Cesium.Geometry({
          attributes:{
            position:new Cesium.GeometryAttribute({componentDatatype:Cesium.ComponentDatatype.DOUBLE,componentsPerAttribute:3,values:v}),
            normal:new Cesium.GeometryAttribute({componentDatatype:Cesium.ComponentDatatype.FLOAT,componentsPerAttribute:3,values:normal})
          },
          indices:sequentialIndices(p.length/3),
          primitiveType:Cesium.PrimitiveType.TRIANGLES,
          boundingSphere:Cesium.BoundingSphere.fromVertices(v)
        });
        const [r,gc,b]=getColor(name);
        const instance=new Cesium.GeometryInstance({geometry:g,attributes:{
          color:Cesium.ColorGeometryInstanceAttribute.fromColor(new Cesium.Color(r,gc,b,1))
        }});
        const primitive=scene.primitives.add(new Cesium.Primitive({
          geometryInstances:instance,modelMatrix:frame,asynchronous:false,
          compressVertices:false,cull:false,
          appearance:new Cesium.PerInstanceColorAppearance({flat:true,translucent:false,closed:false,faceForward:true})
        }));
        primitives.push(primitive);
      }
      return ()=>{for(const p of primitives)if(!p.isDestroyed())scene.primitives.remove(p);};
    }
  };
} else if(engineName==='playcanvas'){
  mount.appendChild(canvas);
  const app=new pc.Application(canvas,{graphicsDeviceOptions:{
    antialias:false,alpha:false,preserveDrawingBuffer:true
  }});
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  const camera=new pc.Entity('camera');
  camera.addComponent('camera',{clearColor:new pc.Color(...sky),fov:60,nearClip:.1,farClip:5000});
  app.root.addChild(camera);
  app.on('postrender',()=>renderCount++);
  app.start();
  const material=(key)=>{
    if(materialCache.has(key))return materialCache.get(key);
    const rgb=getColor(key),mat=new pc.StandardMaterial();
    mat.useLighting=false;mat.diffuse=new pc.Color(...rgb);
    mat.emissive=new pc.Color(...rgb);mat.emissiveIntensity=1;
    mat.cull=pc.CULLFACE_NONE;mat.update();
    materialCache.set(key,mat);return mat;
  };
  api={canvas,move:(pan)=>{
    const e=worldEye(pan),t=worldTarget(pan);
    camera.setPosition(e[0],e[1],-e[2]);camera.lookAt(t[0],t[1],-t[2]);
  },add:(materials)=>{
    const entities=[],meshes=[];
    for(const [name,p] of Object.entries(materials)){
      if(!p.length)continue;
      const mesh=new pc.Mesh(app.graphicsDevice);
      mesh.setPositions(flipped(p));mesh.setIndices(sequentialIndices(p.length/3));mesh.update();
      const entity=new pc.Entity('tile');
      const mi=new pc.MeshInstance(mesh,material(name),entity);
      entity.addComponent('render',{meshInstances:[mi]});
      app.root.addChild(entity);entities.push(entity);meshes.push(mesh);
    }
    return ()=>{for(const ent of entities)ent.destroy();for(const mesh of meshes)mesh.destroy();};
  }};
} else if(engineName==='three'){
  mount.appendChild(canvas);
  const renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(1);renderer.setSize(1280,720,false);
  renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  const scene=new THREE.Scene();scene.background=new THREE.Color(...sky);
  const camera=new THREE.PerspectiveCamera(60,1280/720,.1,5000);
  scene.add(camera);
  renderer.setAnimationLoop(()=>{renderer.render(scene,camera);renderCount++});
  const material=key=>{
    if(materialCache.has(key))return materialCache.get(key);
    const m=new THREE.MeshBasicMaterial({color:new THREE.Color(...getColor(key)),side:THREE.DoubleSide,toneMapped:false});
    materialCache.set(key,m);return m;
  };
  api={canvas,move:(pan)=>{
    const e=worldEye(pan),t=worldTarget(pan);
    camera.position.set(e[0],e[1],-e[2]);camera.lookAt(t[0],t[1],-t[2]);camera.updateMatrixWorld();
  },add:(materials)=>{
    const objects=[];
    for(const [name,p] of Object.entries(materials)){
      if(!p.length)continue;
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.BufferAttribute(flipped(p),3));
      const obj=new THREE.Mesh(g,material(name));obj.frustumCulled=false;scene.add(obj);objects.push(obj);
    }
    return ()=>{for(const obj of objects){scene.remove(obj);obj.geometry.dispose();}};
  }};
} else if(engineName==='babylon'){
  mount.appendChild(canvas);
  const engine=new BABYLON.Engine(canvas,false,{preserveDrawingBuffer:true,stencil:false,disableWebGL2Support:false,powerPreference:'high-performance'});
  const scene=new BABYLON.Scene(engine);
  scene.useRightHandedSystem=true;
  scene.clearColor=new BABYLON.Color4(...sky,1);
  const camera=new BABYLON.FreeCamera('camera',new BABYLON.Vector3(0,200,0),scene);
  camera.minZ=.1;camera.maxZ=5000;camera.fov=Math.PI/3;camera.fovMode=BABYLON.Camera.FOVMODE_VERTICAL_FIXED;
  scene.activeCamera=camera;
  engine.runRenderLoop(()=>{scene.render();renderCount++});
  const material=key=>{
    if(materialCache.has(key))return materialCache.get(key);
    const mat=new BABYLON.StandardMaterial(key,scene);
    mat.diffuseColor=BABYLON.Color3.Black();
    mat.emissiveColor=new BABYLON.Color3(...getColor(key));
    mat.specularColor=BABYLON.Color3.Black();
    mat.disableLighting=true;mat.backFaceCulling=false;
    materialCache.set(key,mat);return mat;
  };
  api={canvas,move:(pan)=>{
    const e=worldEye(pan),t=worldTarget(pan);
    camera.position.set(e[0],e[1],-e[2]);
    camera.setTarget(new BABYLON.Vector3(t[0],t[1],-t[2]));
  },add:(materials)=>{
    const meshes=[];
    for(const [name,p] of Object.entries(materials)){
      if(!p.length)continue;
      const mesh=new BABYLON.Mesh('stream-'+name,scene);
      const v=new BABYLON.VertexData();
      v.positions=Array.from(flipped(p));v.indices=Array.from(sequentialIndices(p.length/3));
      v.applyToMesh(mesh,false);
      mesh.material=material(name);mesh.alwaysSelectAsActiveMesh=true;
      meshes.push(mesh);
    }
    return ()=>{for(const mesh of meshes)mesh.dispose(false,false);};
  }};
} else throw Error('Unknown engine '+engineName);

const gl=api.canvas.getContext('webgl2');
if(!gl)throw Error('WebGL2 context unavailable '+engineName);
const ext=gl.getExtension('WEBGL_debug_renderer_info');
const gpu={vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),
  renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};

const tiles=manifest.tiles;
const records=new Map(),pending=new Map();
const stats={
  startedAt:performance.now(),requests:0,success:0,aborts:0,errors:0,evictions:0,
  swaps:0,bytesFetched:0,loadedTriangles:0,activeTriangles:0,peakActiveTriangles:0,
  activeTiles:0,peakActiveTiles:0,firstTileMs:null,uploads:[],
  peakHeapBytes:0,totalRequestedBytes:0,frameSteps:0
};
let pan=0;
let detailRadius=240,loadRadius=490,concurrency=3,epoch=0;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function desired(tile){
  const d=distance(tile.center,[fx+pan,fz]);
  if(d<detailRadius)return 'high';
  if(d<loadRadius)return 'low';
  return null;
}
async function fetchTile(tile,detail,controller,version){
  const asset=tile.files[detail];
  stats.requests++;stats.totalRequestedBytes+=asset.bytes;
  try{
    const r=await fetch(asset.url,{signal:controller.signal,cache:'no-store'});
    if(!r.ok)throw Error('Tile '+asset.url+' HTTP '+r.status);
    const content=await r.json();
    if(controller.signal.aborted||pending.get(tile.id)?.version!==version)return;
    if(desired(tile)!==detail)return;
    const t0=performance.now();
    const disposer=api.add(content.materials);
    const ms=performance.now()-t0;
    stats.uploads.push(ms);
    const old=records.get(tile.id);
    if(old){old.dispose();stats.activeTriangles-=old.triangles;stats.swaps++;}
    records.set(tile.id,{detail,triangles:asset.triangles,dispose:disposer});
    stats.loadedTriangles+=asset.triangles;
    stats.activeTriangles+=asset.triangles;
    stats.activeTiles=records.size;
    stats.peakActiveTiles=Math.max(stats.peakActiveTiles,stats.activeTiles);
    stats.peakActiveTriangles=Math.max(stats.peakActiveTriangles,stats.activeTriangles);
    stats.bytesFetched+=asset.bytes;stats.success++;
    if(stats.firstTileMs===null)stats.firstTileMs=performance.now()-stats.startedAt;
  }catch(err){
    if(controller.signal.aborted)stats.aborts++;
    else{stats.errors++;console.error('stream tile failed',tile.id,detail,err);}
  }finally{
    if(pending.get(tile.id)?.version===version)pending.delete(tile.id);
  }
}
function schedule(){
  epoch++;stats.frameSteps++;
  if(performance.memory?.usedJSHeapSize){
    stats.peakHeapBytes=Math.max(stats.peakHeapBytes,performance.memory.usedJSHeapSize);
  }
  // Drop distant tiles. Keep old LOD visible until replacement arrives.
  for(const [id,r] of records){
    const tile=tiles.find(t=>t.id===id);
    if(!desired(tile)){
      r.dispose();records.delete(id);stats.evictions++;stats.activeTriangles-=r.triangles;
    }
  }
  for(const [id,job] of pending){
    const tile=tiles.find(t=>t.id===id);
    if(desired(tile)!==job.detail){job.controller.abort();pending.delete(id);}
  }
  const candidates=tiles.filter(t=>{
    const d=desired(t);
    return d&&records.get(t.id)?.detail!==d&&!pending.has(t.id);
  }).sort((a,b)=>distance(a.center,[fx+pan,fz])-distance(b.center,[fx+pan,fz]));
  const slots=Math.max(0,concurrency-pending.size);
  for(const tile of candidates.slice(0,slots)){
    const detail=desired(tile);
    const controller=new AbortController();
    const version=epoch;
    pending.set(tile.id,{detail,controller,version});
    void fetchTile(tile,detail,controller,version);
  }
  stats.activeTiles=records.size;
  const visible=stats.activeTiles;
  status.textContent=engineName+' | streaming Seoul | active tiles '+visible+
    ' | '+Math.round(stats.activeTriangles/1000)+'k triangles | '+stats.success+' loaded';
}
api.move(0);
schedule();
window.__streamBench={
  ready:true,engine:engineName,manifest:{
    area:manifest.area,dem:manifest.dataSource,buildingCount:manifest.buildingCount,
    grid:manifest.grid,tiles:manifest.tiles.length,triangles:manifest.totals
  },gpu,
  get rendered(){return renderCount},
  stats,
  get pending(){return pending.size},
  get activeTiles(){return records.size},
  move:(meters,options={})=>{
    pan=meters;
    if(options.detailRadius)detailRadius=options.detailRadius;
    if(options.loadRadius)loadRadius=options.loadRadius;
    if(options.concurrency)concurrency=options.concurrency;
    api.move(pan);
    schedule();
  },
  resetCounters:()=>{
    const copy={...stats};
    stats.requests=0;stats.success=0;stats.aborts=0;stats.errors=0;
    stats.evictions=0;stats.swaps=0;stats.bytesFetched=0;stats.totalRequestedBytes=0;
    stats.uploads=[];stats.peakHeapBytes=0;stats.firstTileMs=null;
    stats.peakActiveTiles=records.size;stats.peakActiveTriangles=stats.activeTriangles;
    return copy;
  }
};
