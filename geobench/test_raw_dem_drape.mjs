import assert from 'node:assert/strict';
import {buildRoadGeometry} from './road_geometry.mjs';
const N=18,xmin=-45,xmax=45,zmin=-45,zmax=45,step=5;
const heights=[];
for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
 const x=xmin+i*step,z=zmin+j*step;
 heights.push(45+3.5*Math.sin(x/5.3)+2.8*Math.cos(z/4.7)+.13*x);
}
const heightsBefore=JSON.stringify(heights);
function ground(x,z){
 const fx=Math.min(N-1e-8,Math.max(0,(x-xmin)/step));
 const fz=Math.min(N-1e-8,Math.max(0,(z-zmin)/step));
 const i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j;
 const y=(di,dj)=>heights[(j+dj)*(N+1)+i+di];
 return u+v<=1?y(0,0)*(1-u-v)+y(1,0)*u+y(0,1)*v:
   y(1,1)*(u+v-1)+y(1,0)*(1-v)+y(0,1)*(1-u);
}
const road=(id,refs,nodeIds)=>({id,refs,nodeIds,width:12,tags:{highway:'secondary',lanes:'2'}});
const output=buildRoadGeometry([
  road('ew',[[-39,0],[0,0],[39,0]],['west','center','east']),
  road('ns',[[0,-39],[0,0],[0,39]],['south','center','north'])
],{
 project:(x,z)=>[x,z],ground,bounds:[xmin,zmin,xmax,zmax],
 maxStep:6,terrainGrid:{xmin,xmax,zmin,zmax,nx:N,nz:N}
});
assert.equal(JSON.stringify(heights),heightsBefore,'road generator modified source DEM');
assert.ok(output.stats.debugJunctions.length>0,'must have true OSM junction diagnostic');
for(const [material,offset] of [['road',.04],['road-edge',.025],['road-marking',.054]]){
 const mesh=output.meshes[material];assert.ok(mesh.indices.length>40,'Missing '+material+' triangles');
 let samples=0,maxError=0;
 for(let i=0;i<mesh.indices.length;i+=3){
   const pts=mesh.indices.slice(i,i+3).map(k=>mesh.positions.slice(k*3,k*3+3));
   for(const [a,b,c] of [[1/3,1/3,1/3],[.5,.5,0],[.5,0,.5],[0,.5,.5]]){
     const x=pts[0][0]*a+pts[1][0]*b+pts[2][0]*c;
     const z=pts[0][2]*a+pts[1][2]*b+pts[2][2]*c;
     const y=pts[0][1]*a+pts[1][1]*b+pts[2][1]*c;
     maxError=Math.max(maxError,Math.abs(y-ground(x,z)-offset));samples++;
   }
 }
 assert.ok(samples>=30);
 assert.ok(maxError<1e-7,'Mesh '+material+' cuts into piecewise DEM; error '+maxError);
 console.log('DEM_DRAPE_SYNTHETIC_MATERIAL_PASS',JSON.stringify({
   material,triangles:mesh.indices.length/3,samples,maxError
 }));
}
console.log('DEM_DRAPE_RAW_SOURCE_UNIT_PASS');
