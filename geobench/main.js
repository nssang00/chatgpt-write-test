import * as Cesium from 'cesium';
import * as pc from 'playcanvas';
import 'cesium/Build/Cesium/Widgets/widgets.css';

const engine=new URLSearchParams(location.search).get('engine') || 'cesium';
const fixture=await (await fetch('/fixture.json')).json();
const mount=document.getElementById('mount');
document.getElementById('meta').textContent=engine+' | OSM buildings '+fixture.metadata.buildingCount+
  ' | triangles '+(fixture.metadata.triangles.terrain+fixture.metadata.triangles.buildings);
const lon=fixture.metadata.center[0],lat=fixture.metadata.center[1];
let rendered=0, step, canvas, softwareRenderer=null;

function cameraTrack(n){
  const angle=0.20+0.12*Math.sin(n/90);
  return {
    eye:[670*Math.sin(angle),440+28*Math.sin(n/150),-670*Math.cos(angle)],
    target:[0,120,0]
  };
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
  scene.backgroundColor=Cesium.Color.fromCssColorString('#101c29');
  scene.screenSpaceCameraController.enableInputs=false;
  const frame=Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(lon,lat,0));
  scene.primitives.add(createCesiumPrimitive(fixture.terrain,Cesium.Color.fromCssColorString('#75876b'),frame));
  scene.primitives.add(createCesiumPrimitive(fixture.buildings,Cesium.Color.fromCssColorString('#c7b6a1'),frame));
  viewer.camera.frustum.fov=Math.PI/3;
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
    mesh.setPositions(input.positions);
    mesh.setIndices(input.indices);
    mesh.update();
    const entity=new pc.Entity('geometry');
    const mi=new pc.MeshInstance(mesh,mat,entity);
    entity.addComponent('render',{meshInstances:[mi]});
    app.root.addChild(entity);
  }
  addMesh(fixture.terrain,makeMaterial(0.459,0.529,0.420));
  addMesh(fixture.buildings,makeMaterial(0.780,0.714,0.631));
  const camera=new pc.Entity('camera');
  camera.addComponent('camera',{clearColor:new pc.Color(0.063,0.110,0.161),fov:60,nearClip:0.1,farClip:5000});
  app.root.addChild(camera);
  step=(n)=>{
    const {eye,target}=cameraTrack(n);
    camera.setPosition(...eye);
    camera.lookAt(...target);
  };
  app.on('postrender',()=>rendered++);
  app.start();
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
