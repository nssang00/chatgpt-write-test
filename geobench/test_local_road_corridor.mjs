import assert from 'node:assert/strict';
import {buildLocalRoadCorridor} from './road_corridor_terrain.mjs';
import {buildAtGradeRoadFootprint} from './road_geometry.mjs';
import {sampleTerrainGrid} from './roadbed_terrain.mjs';

const grid={xmin:-50,xmax:50,zmin:-50,zmax:50,nx:20,nz:20};
const terrain={positions:[],indices:[]};
const source=(x,z)=>32+.03*x+5*Math.sin(x/8)+3*Math.cos(z/9);
for(let j=0;j<=20;j++)for(let i=0;i<=20;i++){
  const x=-50+i*5,z=-50+j*5;
  terrain.positions.push(x,source(x,z),z);
}
for(let j=0;j<20;j++)for(let i=0;i<20;i++){
  const a=j*21+i,b=a+1,c=a+21,d=c+1;
  terrain.indices.push(a,c,b,b,c,d);
}
const sourceGround=(x,z)=>sampleTerrainGrid(terrain,grid,x,z);
const road={
  refs:[[-35,0],[0,0],[35,0]],nodeIds:['a','junction','b'],
  tags:{highway:'primary'},width:11,id:'at-grade'
};
const bridge={
  refs:[[0,-35],[0,35]],nodeIds:['bridge-a','bridge-b'],
  tags:{bridge:'yes',layer:'1'},width:10,id:'overpass'
};
const footprint=buildAtGradeRoadFootprint([road,bridge],{
  project:(x,z)=>[x,z],bounds:[-50,-50,50,50],maxStep:5
});
assert.equal(footprint.stats.ways,1,'bridge must not cut DEM');
assert.ok(footprint.polygons.length>=1);
const profile={sampleAt(x,z){
  return {height:31+.015*x,distance:Math.abs(z),halfWidth:5.5};
}};
const result=buildLocalRoadCorridor({
  terrain,sourceGround,profile,footprint,grid,
  subdivisions:2,shoulderMeters:9,maxVerticalAdjustmentMeters:2.5
});
const {stats}=result;
assert.ok(stats.pavementVertices>15);
assert.ok(stats.shoulderVertices>15);
assert.ok(stats.unchangedVertices>0);
assert.ok(stats.terrainUnchangedPct>15);
assert.ok(stats.maximumActualAdjustmentMeters<=2.500001);
assert.ok(stats.profileDiscrepancyOverBudget>0);
assert.ok(stats.changedVertices<stats.pavementVertices+stats.shoulderVertices+1);
assert.equal(result.terrain.indices.length/3,3200);
for(let k=0;k<result.terrain.positions.length;k+=3){
  const [x,y,z]=result.terrain.positions.slice(k,k+3);
  assert.ok(Number.isFinite(y));
  assert.ok(Math.abs(y-sourceGround(x,z))<=2.500001);
  if(Math.abs(z)>35)assert.ok(Math.abs(y-sourceGround(x,z))<1e-6,
    'far side terrain changed');
}
const ring=(points)=>[...points,points[0]];
const donut={
  polygons:[{grade:'0||',rings:[
    ring([[-40,-40],[40,-40],[40,40],[-40,40]]),
    ring([[-18,-18],[18,-18],[18,18],[-18,18]])
  ]}]
};
const d=buildLocalRoadCorridor({terrain,sourceGround,profile,footprint:donut,grid,
  subdivisions:2,shoulderMeters:7,maxVerticalAdjustmentMeters:2});
assert.ok(Math.abs(d.ground(0,0)-sourceGround(0,0))<1e-7,
  'an interior polygon hole must not receive earthworks');
assert.ok(d.stats.pavementVertices>0);
console.log('LOCAL_ROAD_CORRIDOR_UNIT_PASS',JSON.stringify({
  stats,donutHoleUnmodified:true
}));
