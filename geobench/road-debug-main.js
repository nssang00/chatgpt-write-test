import * as THREE from 'three';
// True triangle-level diagnostic modes: terrain only, roads only + wireframe,
// and combined; no height smoothing, offset recomputation or visual tricks.
const response=await fetch('/road-debug-geometry.json');
if(!response.ok)throw Error('No road debug scene; run extract_road_debug.mjs');
const d=await response.json();
const mode=new URLSearchParams(location.search).get('mode')||'combined';
if(!['terrain','road','combined'].includes(mode))throw Error('Unknown debug mode '+mode);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);
renderer.setSize(1280,720);
renderer.setClearColor(0x162b3a,1);
document.getElementById('mount').append(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(d.camera.fov,1280/720,.5,1000);
camera.position.set(...d.camera.position);
camera.lookAt(...d.camera.target);
const count={};
function make(name,visible,wire=false){
 const values=d.materials[name];
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(values,3));
 g.computeVertexNormals();
 const colors=d.colors[name]||[.8,.8,.8];
 const basic=new THREE.MeshBasicMaterial({
   color:new THREE.Color(...colors),side:THREE.DoubleSide,
   polygonOffset:true,polygonOffsetFactor:wire?-2:0,polygonOffsetUnits:wire?-2:0
 });
 const mesh=new THREE.Mesh(g,basic);
 mesh.visible=visible;
 scene.add(mesh);
 count[name]=values.length/9;
 return g;
}
if(mode!=='road')make('terrain',true);
if(mode!=='terrain'){
  for(const name of ['road-edge','road','road-marking']){
    const g=make(name,true);
    if(mode==='road'){
      // Wireframe only in road-only mode so the planar triangulation can be
      // inspected independently of the relief below it.
      const lines=new THREE.LineSegments(
        new THREE.WireframeGeometry(g),
        new THREE.LineBasicMaterial({color:name==='road'?0xf6b65f:0xe8eff7,depthTest:false,transparent:true,opacity:.46})
      );
      lines.renderOrder=10;scene.add(lines);
    }
  }
}
const names={terrain:'① SOURCE TERRAIN ONLY',road:'② ROAD MESH ONLY + TRIANGLES',combined:'③ TERRAIN + ROAD'};
document.getElementById('meta').innerHTML=
  '<b>'+names[mode]+'</b> | 동일 카메라<br>'+
  '<span id="source">실제 OSM 교차로 / 원본 Terrarium DEM / 지형 절토·성토 없음 / 지상 도로 고도 추정</span>';
renderer.render(scene,camera);
window.__roadDebug={ready:true,mode,counts:d.counts,focus:d.focus,source:d.source};
console.log('ROAD_DEBUG_VIEW_READY',JSON.stringify(window.__roadDebug));
