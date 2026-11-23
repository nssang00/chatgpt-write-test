import assert from 'node:assert/strict';
import {constrainRoadbedMesh} from './roadbed_grade_solver.mjs';
import {buildIntegratedRoadbed,sampleTerrainGrid} from './roadbed_terrain.mjs';

const grid={xmin:-60,xmax:60,zmin:-60,zmax:60,nx:24,nz:24};
const source={positions:[],indices:[]};
for(let j=0;j<=24;j++)for(let i=0;i<=24;i++){
  const x=-60+i*5,z=-60+j*5;
  source.positions.push(x,80+.05*x+2*Math.sin(x/7)+2*Math.cos(z/8),z);
}
for(let j=0;j<24;j++)for(let i=0;i<24;i++){
  const a=j*25+i,b=a+1,c=a+25,d=c+1;
  source.indices.push(a,c,b,b,c,d);
}
const sourceGround=(x,z)=>sampleTerrainGrid(source,grid,x,z);
const profile={
  sampleAt(x,z){
    return {height:81+.025*x,distance:Math.abs(z),halfWidth:7};
  }
};
const old=buildIntegratedRoadbed({terrain:source,sourceGround,profile,grid,
  subdivisions:2,shoulderMeters:35});
const next=buildIntegratedRoadbed({terrain:source,sourceGround,profile,grid,
  subdivisions:2,shoulderMeters:35,gradeConstrained:true});
assert.ok(next.stats.gradeSolver,'missing grade-constrained solver');
assert.equal(old.stats.gradeSolver,null);
const stats=next.stats.gradeSolver;
assert.ok(stats.roadCoreVertices>50);
assert.ok(stats.constrainedEdges>100);
assert.ok(stats.incomingEdgesOverLimit>0,'the noisy roadbed must have excess grade');
assert.ok(stats.finalEdgesOverLimit<stats.incomingEdgesOverLimit,
  'grade projection did not eliminate steeper road slopes');
assert.ok(stats.finalCoreMaxGrade<stats.incomingCoreMaxGrade,
  'core mesh max grade did not improve');
assert.ok(stats.verticesChanged>0);
for(let k=0;k<old.terrain.positions.length;k+=3){
 const [x,,z]=old.terrain.positions.slice(k,k+3);
 const a=old.terrain.positions[k+1],b=next.terrain.positions[k+1];
 assert.ok(Number.isFinite(b));
 if(Math.abs(z)>55)assert.ok(Math.abs(a-b)<1e-8,'unrelated terrain must remain unchanged');
}
for(const [x,z] of [[-12,0],[-3,3],[10,0],[17,-5]]){
 assert.ok(Number.isFinite(next.ground(x,z)));
}
console.log('GRADE_CONSTRAINED_ROADBED_UNIT_PASS',JSON.stringify(stats));
