import assert from 'node:assert/strict';
import {buildRoadElevationProfile} from './road_elevation_profile.mjs';
import {buildIntegratedRoadbed,sampleTerrainGrid} from './roadbed_terrain.mjs';
import {buildRoadGeometry} from './road_geometry.mjs';

const grid={xmin:-40,zmin:-40,xmax:40,zmax:40,nx:16,nz:16};
const sourceTerrain={positions:[],indices:[]};
const originalGround=(x,z)=>40+.05*x+8*Math.sin(x/6)+5*Math.cos(z/7);
for(let j=0;j<=16;j++)for(let i=0;i<=16;i++){
  const x=-40+5*i,z=-40+5*j;
  sourceTerrain.positions.push(x,originalGround(x,z),z);
}
for(let j=0;j<16;j++)for(let i=0;i<16;i++){
  const a=j*17+i,b=a+1,c=a+17,d=c+1;
  sourceTerrain.indices.push(a,c,b,b,c,d);
}
const sourceGround=(x,z)=>sampleTerrainGrid(sourceTerrain,grid,x,z);
const roads=[
 {id:'east-west',refs:[[-35,0],[0,0],[35,0]],nodeIds:['a','center','b'],width:10,tags:{}},
 {id:'north-south',refs:[[0,-35],[0,0],[0,35]],nodeIds:['c','center','d'],width:8,tags:{}}
];
const classified=roads.map(road=>({
 road,grade:'0||',width:road.width,
 pts:road.refs.map(([x,z],i)=>({x,z,id:road.nodeIds[i]}))
}));
const profile=buildRoadElevationProfile(classified,sourceGround,{step:5});
assert.ok(profile.stats().smoothedMaxGrade<=.12000001);
const roadbed=buildIntegratedRoadbed({
 terrain:sourceTerrain,sourceGround,profile,grid,subdivisions:2,shoulderMeters:25
});
assert.deepEqual(roadbed.stats.outputGrid,[33,33]);
assert.equal(roadbed.terrain.indices.length/3,2048);
assert.ok(roadbed.stats.changedVertices>0);
assert.ok(roadbed.stats.maximumCutMeters>0);
assert.ok(roadbed.stats.maximumFillMeters>0);
const scene=buildRoadGeometry(roads,{
 project:(x,z)=>[x,z],ground:roadbed.ground,
 terrainGrid:roadbed.grid,bounds:[-40,-40,40,40],
 maxStep:5,roadProfile:profile,roadbedIntegrated:true
});
assert.equal(scene.atGradeMask,null,'integrated roadbed must not punch terrain holes');
assert.equal(scene.stats.integratedRoadbed,true);
let samples=0,maxAbsError=0;
for(const [name,offset] of [['road',.22],['road-edge',.15],['road-marking',.285]]){
 const mesh=scene.meshes[name];
 assert.ok(mesh.indices.length>0,'missing '+name);
 const v=mesh.positions;
 for(let i=0;i<mesh.indices.length;i+=3){
   const a=mesh.indices.slice(i,i+3).map(k=>v.slice(3*k,3*k+3));
   for(const [u,w,t] of [[1,0,0],[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]]){
     const x=u*a[0][0]+w*a[1][0]+t*a[2][0];
     const z=u*a[0][2]+w*a[1][2]+t*a[2][2];
     const y=u*a[0][1]+w*a[1][1]+t*a[2][1];
     const error=Math.abs(y-roadbed.ground(x,z)-offset);
     maxAbsError=Math.max(error,maxAbsError);
     samples++;
   }
 }
}
assert.ok(samples>100,'insufficient roadbed tests');
assert.ok(maxAbsError<.001,'road is not on integrated terrain at triangle interior, max error='+maxAbsError);
for(const [x,z] of [[-40,-40],[40,40],[-10,7],[5,-14]]){
 assert.ok(Number.isFinite(roadbed.ground(x,z)));
}
console.log('INTEGRATED_ROADBED_UNIT_PASS',JSON.stringify({
 samples,maxAbsError,
 terrainTriangles:roadbed.terrain.indices.length/3,
 roadTriangles:scene.stats.triangles,
 ...roadbed.stats
}));
