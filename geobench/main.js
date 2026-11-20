import * as Cesium from 'cesium';
import * as pc from 'playcanvas';
import * as THREE from 'three';
import * as BABYLON from '@babylonjs/core';
import 'cesium/Build/Cesium/Widgets/widgets.css';

const engine=new URLSearchParams(location.search).get('engine') || 'cesium';
const style=new URLSearchParams(location.search).get('style') || 'detailed';
const demSource=new URLSearchParams(location.search).get('dem') || 'aws';
if(!['ngii','aws'].includes(demSource))throw new Error('Unsupported DEM source '+demSource);
const fixtureUrl=demSource==='ngii'?(style==='plain'?'/fixture-ngii.json':'/fixture-ngii-detailed.json'):(style==='plain'?'/fixture.json':'/fixture-detailed.json');
const response=await fetch(fixtureUrl);
if(!response.ok)throw new Error('Required DEM fixture missing: '+fixtureUrl+' / HTTP '+response.status);
const fixture=await response.json();
if(demSource==='ngii' && fixture.metadata.demSource!=='NGII')throw new Error('NGII provenance mismatch; refusing AWS fallback');
const mount=document.getElementById('mount');
document.getElementById('meta').textContent=engine.toUpperCase()+' | OSM buildings '+fixture.metadata.buildingCount+
  ' | '+(style==='detailed'?'procedural facades + windows + real roads':'plain extrusions')+
  ' | '+(style==='detailed'?Object.values(fixture.metadata.trianglesByMaterial).reduce((a,b)=>a+b,0):fixture.metadata.triangles.terrain+fixture.metadata.triangles.buildings)+' triangles';
const lon=fixture.metadata.center[0],lat=fixture.metadata.center[1];
let rendered=0, step, canvas, softwareRenderer=null;

function cameraTrack(n){
  if(style==='detailed'){
    const [x,y,z]=fixture.metadata.focus;
    const theta=.18+.065*Math.sin(n/120);
    return {eye:[x+118*Math.sin(theta)+72,y+80,z-178*Math.cos(theta)],target:[x,y,z]};
  }
  const angle=0.20+0.12*Math.sin(n/90);
  return {eye:[670*Math.sin(angle),440+28*Math.sin(n/150),-670*Math.cos(angle)],target:[0,120,0]};
}
function createCesiumPrimitive(input,color,modelMatrix){
  // Common input coordinates: east, up, north. Cesium ENU: east, north, up.
  const v=new Float64Array(input.positions.length);
  for(let i=0;i<v.length;i+=3){v[i]=input.positions[i];v[i+1]=input.positions[i+2];v[i+2]=input.positions[i+1];}
  const normals=new Float32Array(v.length);
  for(let i=0;i<normals.length;i+=3){normals[i]=0;normals[i+1]=0;normals[i+2]=1;}
  const geometry=new Cesium.Geometry({
    attributes:{
      position:new Cesium.GeometryAttribute({
        componentDatatype:Cesium.ComponentDatatype.DOUBLE,componentsPerAttribute:3,values:v
      }),
      normal:new Cesium.GeometryAttribute({
        componentDatatype:Cesium.ComponentDatatype.FLOAT,componentsPerAttribute:3,values:normals
      })
    },
    indices:new Uint32Array(input.indices),
    primitiveType:Cesium.PrimitiveType.TRIANGLES,
    boundingSphere:Cesium.BoundingSphere.fromVertices(v)
  });
  const instance=new Cesium.GeometryInstance({
    geometry,attributes:{color:Cesium.ColorGeometryInstanceAttribute.fromColor(color)}
  });
  return new Cesium.Primitive({
    geometryInstances:instance,
    modelMatrix,asynchronous:false,compressVertices:false,cull:false,
    appearance:new Cesium.PerInstanceColorAppearance({
      flat:true,translucent:false,closed:false,faceForward:true
    })
  });
}
if(engine==='cesium'){
  const viewer=new Cesium.Viewer(mount,{
    animation:false,timeline:false,geocoder:false,homeButton:false,
    baseLayerPicker:false,sceneModePicker:false,navigationHelpButton:false,
    selectionIndicator:false,infoBox:false,fullscreenButton:false,
    baseLayer:false,globe:false,skyBox:false,skyAtmosphere:false,
    requestRenderMode:false,
    contextOptions:{webgl:{alpha:false,antialias:false,preserveDrawingBuffer:true}}
  });
  const scene=viewer.scene;
  scene.backgroundColor=Cesium.Color.fromCssColorString(style==='detailed'?'#acbdcb':'#101c29');
  scene.screenSpaceCameraController.enableInputs=false;
  const frame=Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(lon,lat,0));
  if(style==='detailed'){
    const colors=fixture.metadata.materialColors;
    const terrainColor=colors.terrain;
    scene.primitives.add(createCesiumPrimitive(fixture.terrain,new Cesium.Color(...terrainColor,1),frame));
    for(const [material,mesh] of Object.entries(fixture.surfaces)){
      scene.primitives.add(createCesiumPrimitive(mesh,new Cesium.Color(...colors[material],1),frame));
    }
  } else {
    scene.primitives.add(createCesiumPrimitive(fixture.terrain,Cesium.Color.fromCssColorString('#75876b'),frame));
    scene.primitives.add(createCesiumPrimitive(fixture.buildings,Cesium.Color.fromCssColorString('#c7b6a1'),frame));
  }
  // Cesium's fov is horizontal for landscape view; PlayCanvas uses vertical fov.
  viewer.camera.frustum.fov=2*Math.atan(Math.tan(Math.PI/6)*(1280/720));
  const up=Cesium.Matrix4.multiplyByPointAsVector(frame,new Cesium.Cartesian3(0,0,1),new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(up,up);
  const toWorld=([x,y,z])=>Cesium.Matrix4.multiplyByPoint(frame,new Cesium.Cartesian3(x,z,y),new Cesium.Cartesian3());
  step=(n)=>{
    const {eye,target}=cameraTrack(n),pos=toWorld(eye),toward=toWorld(target);
    const dir=Cesium.Cartesian3.subtract(toward,pos,new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(dir,dir);
    viewer.camera.setView({destination:pos,orientation:{direction:dir,up}});
  };
  canvas=viewer.canvas;
  scene.postRender.addEventListener(()=>rendered++);
} else if(engine==='playcanvas'){
  canvas=document.createElement('canvas');
  canvas.width=1280;canvas.height=720;
  canvas.style.width='100%';canvas.style.height='100%';
  mount.appendChild(canvas);
  const app=new pc.Application(canvas,{graphicsDeviceOptions:{
    antialias:false,alpha:false,preserveDrawingBuffer:true
  }});
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  const makeMaterial=(r,g,b)=>{
    const mat=new pc.StandardMaterial();
    mat.useLighting=false;
    mat.diffuse=new pc.Color(r,g,b);
    mat.emissive=new pc.Color(r,g,b);
    mat.emissiveIntensity=1;
    mat.cull=pc.CULLFACE_NONE;
    mat.update();
    return mat;
  };
  function addMesh(input,mat){
    const mesh=new pc.Mesh(app.graphicsDevice);
    // Mirror local north to -Z to keep PlayCanvas right-handed and align Cesium ENU.
    const positions=new Float32Array(input.positions);
    for(let i=2;i<positions.length;i+=3)positions[i]=-positions[i];
    mesh.setPositions(positions);
    mesh.setIndices(input.indices);
    mesh.update();
    const entity=new pc.Entity('geometry');
    const mi=new pc.MeshInstance(mesh,mat,entity);
    entity.addComponent('render',{meshInstances:[mi]});
    app.root.addChild(entity);
  }
  if(style==='detailed'){
    const colors=fixture.metadata.materialColors;
    addMesh(fixture.terrain,makeMaterial(...colors.terrain));
    for(const [material,mesh] of Object.entries(fixture.surfaces))addMesh(mesh,makeMaterial(...colors[material]));
  } else {
    addMesh(fixture.terrain,makeMaterial(0.459,0.529,0.420));
    addMesh(fixture.buildings,makeMaterial(0.780,0.714,0.631));
  }
  const camera=new pc.Entity('camera');
  camera.addComponent('camera',{clearColor:style==='detailed'?new pc.Color(.674,.741,.796):new pc.Color(0.063,0.110,0.161),fov:60,nearClip:0.1,farClip:5000});
  app.root.addChild(camera);
  step=(n)=>{
    const {eye,target}=cameraTrack(n);
    camera.setPosition(eye[0],eye[1],-eye[2]);
    camera.lookAt(target[0],target[1],-target[2]);
  };
  app.on('postrender',()=>rendered++);
  app.start();
} else if(engine==='three'){
  canvas=document.createElement('canvas');
  canvas.width=1280; canvas.height=720;
  canvas.style.width='100%'; canvas.style.height='100%';
  mount.appendChild(canvas);
  const renderer=new THREE.WebGLRenderer({
    canvas,antialias:false,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'
  });
  renderer.setPixelRatio(1);
  renderer.setSize(1280,720,false);
  // Numeric colors are used as unlit linear RGB in all four viewers.
  renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
  renderer.toneMapping=THREE.NoToneMapping;
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(...(style==='detailed'?[.674,.741,.796]:[.063,.110,.161]));
  const camera=new THREE.PerspectiveCamera(60,1280/720,.1,5000);
  scene.add(camera);
  const makeMaterial=(color)=>new THREE.MeshBasicMaterial({
    color:new THREE.Color(...color),side:THREE.DoubleSide,
    transparent:false,depthTest:true,depthWrite:true,toneMapped:false
  });
  function addMesh(input,material){
    const geometry=new THREE.BufferGeometry();
    const positions=new Float32Array(input.positions);
    // Same right-handed coordinates as the PlayCanvas viewer.
    for(let i=2;i<positions.length;i+=3)positions[i]=-positions[i];
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(input.indices),1));
    geometry.computeBoundingSphere();
    const object=new THREE.Mesh(geometry,material);
    object.frustumCulled=false;
    scene.add(object);
  }
  if(style==='detailed'){
    const colors=fixture.metadata.materialColors;
    addMesh(fixture.terrain,makeMaterial(colors.terrain));
    for(const [material,mesh] of Object.entries(fixture.surfaces)){
      addMesh(mesh,makeMaterial(colors[material]));
    }
  } else {
    addMesh(fixture.terrain,makeMaterial([.459,.529,.420]));
    addMesh(fixture.buildings,makeMaterial([.780,.714,.631]));
  }
  step=(n)=>{
    const {eye,target}=cameraTrack(n);
    camera.position.set(eye[0],eye[1],-eye[2]);
    camera.lookAt(target[0],target[1],-target[2]);
    camera.updateMatrixWorld();
  };
  renderer.setAnimationLoop(()=>{renderer.render(scene,camera);rendered++});
} else if(engine==='babylon'){
  canvas=document.createElement('canvas');
  canvas.width=1280;canvas.height=720;
  canvas.style.width='100%';canvas.style.height='100%';
  mount.appendChild(canvas);
  const engine3d=new BABYLON.Engine(canvas,false,{
    preserveDrawingBuffer:true,stencil:false,disableWebGL2Support:false,
    powerPreference:'high-performance'
  });
  const scene=new BABYLON.Scene(engine3d);
  scene.useRightHandedSystem=true;
  const background=style==='detailed'?[.674,.741,.796]:[.063,.110,.161];
  scene.clearColor=new BABYLON.Color4(...background,1);
  const camera=new BABYLON.FreeCamera('camera',new BABYLON.Vector3(0,200,0),scene);
  camera.minZ=.1;camera.maxZ=5000;
  camera.fov=Math.PI/3;
  camera.fovMode=BABYLON.Camera.FOVMODE_VERTICAL_FIXED;
  scene.activeCamera=camera;
  const materialFor=(rgb,name)=>{
    const m=new BABYLON.StandardMaterial(name,scene);
    m.diffuseColor=BABYLON.Color3.Black();
    m.emissiveColor=new BABYLON.Color3(...rgb);
    m.specularColor=BABYLON.Color3.Black();
    m.disableLighting=true;
    m.backFaceCulling=false;
    return m;
  };
  function addMesh(input,material,label){
    const mesh=new BABYLON.Mesh(label,scene);
    const vd=new BABYLON.VertexData();
    const p=new Float32Array(input.positions);
    for(let i=2;i<p.length;i+=3)p[i]=-p[i];
    vd.positions=Array.from(p);
    vd.indices=input.indices;
    vd.applyToMesh(mesh,false);
    mesh.material=material;
    mesh.alwaysSelectAsActiveMesh=true;
  }
  if(style==='detailed'){
    const colors=fixture.metadata.materialColors;
    addMesh(fixture.terrain,materialFor(colors.terrain,'terrain'),'terrain');
    for(const [material,mesh] of Object.entries(fixture.surfaces)){
      addMesh(mesh,materialFor(colors[material],material),material);
    }
  } else {
    addMesh(fixture.terrain,materialFor([.459,.529,.420],'terrain'),'terrain');
    addMesh(fixture.buildings,materialFor([.780,.714,.631],'buildings'),'buildings');
  }
  step=(n)=>{
    const {eye,target}=cameraTrack(n);
    camera.position.set(eye[0],eye[1],-eye[2]);
    camera.setTarget(new BABYLON.Vector3(target[0],target[1],-target[2]));
  };
  engine3d.runRenderLoop(()=>{scene.render();rendered++});
} else {
  throw new Error('Unknown engine '+engine);
}
step(0);
const gl=canvas.getContext('webgl2');
if(!gl)throw new Error('WebGL2 unavailable for '+engine);
const ext=gl.getExtension('WEBGL_debug_renderer_info');
const vendor=ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR);
softwareRenderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
window.__geoBench={
  ready:true,engine,fixture:fixture.metadata,
  get rendered(){return rendered},
  gpu:{vendor,renderer:softwareRenderer,version:gl.getParameter(gl.VERSION)},
  step
};
