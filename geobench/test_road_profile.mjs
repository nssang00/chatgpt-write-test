import assert from 'node:assert/strict';
import { buildRoadGeometry } from './road_geometry.mjs';
import { buildRoadElevationProfile } from './road_elevation_profile.mjs';

// A high-frequency noisy DEM does not imply an equally corrugated asphalt
// cross-section. The synthetic DEM deliberately includes abrupt bumps.
const ground=(x,z)=>50+.035*x+7*Math.sin(x/8)+3*Math.cos(z/4);
const profile=buildRoadElevationProfile([{
  grade:'0||',road:{id:'main'},
  pts:[{x:-35,z:0,id:'a'},{x:0,z:0,id:'junction'},{x:35,z:0,id:'b'}]
},{
  grade:'0||',road:{id:'side'},
  pts:[{x:0,z:-28,id:'south'},{x:0,z:0,id:'junction'}]
}],ground);
const stats=profile.stats();
assert.ok(stats.rawMaxGrade>.4,'synthetic DEM must be sufficiently rough');
assert.ok(stats.smoothedMaxGrade<=.120001,'road graph exceeds grade cap');
assert.ok(stats.segmentCount>10,'road centerline must be densified');
assert.equal(stats.unmatchedSamples,0);
for(const x of [-30,-20,-10,10,20,30]){
  const east=profile.heightAt(x,4,'0||');
  const west=profile.heightAt(x,-4,'0||');
  assert.ok(Math.abs(east-west)<.03,'road cross-section is not nearly level at x='+x);
}
for(const x of [-20,-10,0,10,20]){
  const left=profile.heightAt(x,0,'0||');
  assert.ok(Number.isFinite(left),'road profile is not finite');
}
const roads=[
  {id:'main',refs:[[-35,0],[0,0],[35,0]],nodeIds:['a','junction','b'],width:8,tags:{}},
  {id:'side',refs:[[0,-28],[0,0]],nodeIds:['south','junction'],width:8,tags:{}}
];
const grid={xmin:-40,zmin:-40,xmax:40,zmax:40,nx:16,nz:16};
const result=buildRoadGeometry(roads,{project:(x,z)=>[x,z],ground,
  bounds:[-40,-40,40,40],maxStep:5,terrainGrid:grid,roadProfile:true});
assert.ok(result.stats.roadProfile,'road profile was not enabled');
assert.ok(result.stats.roadProfile.smoothedMaxGrade<=.120001);
for(const [material,mesh] of Object.entries(result.meshes)){
  assert.ok(mesh.indices.length>0,'missing '+material);
  assert.ok(mesh.positions.every(Number.isFinite),'nonfinite '+material);
}
assert.equal(result.stats.protectedGradeWays,0);
console.log('ROAD_PROFILE_UNIT_PASS',JSON.stringify({
  ...stats,crossSlopeTarget:.03,
  finalMeshTriangles:result.stats.triangles
}));
