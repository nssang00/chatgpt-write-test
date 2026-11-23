import assert from 'node:assert/strict';
import {buildBenchmarkPresentationTerrain} from './benchmark_presentation_terrain.mjs';
import {sampleTerrainGrid} from './roadbed_terrain.mjs';
const grid={xmin:-60,xmax:60,zmin:-60,zmax:60,nx:12,nz:12};
const terrain={positions:[],indices:[]};
for(let j=0;j<=12;j++)for(let i=0;i<=12;i++){
  const x=-60+i*10,z=-60+j*10;
  terrain.positions.push(x,65+.2*x-.11*z+12*Math.sin(x/5)*Math.cos(z/7),z);
}
for(let j=0;j<12;j++)for(let i=0;i<12;i++){
  const a=j*13+i,b=a+1,c=a+13,d=c+1;
  terrain.indices.push(a,c,b,b,c,d);
}
const sourceGround=(x,z)=>sampleTerrainGrid(terrain,grid,x,z);
const result=buildBenchmarkPresentationTerrain({terrain,sourceGround,grid,subdivisions:2});
assert.deepEqual(result.stats.outputGrid,[25,25]);
assert.equal(result.terrain.indices.length/3,1152);
assert.equal(result.stats.mode,'synthetic-visual-benchmark-NOT-REAL-SEOUL-ELEVATION');
assert.ok(result.stats.nominalBasePlaneSlope<=.035001);
assert.ok(result.stats.maximumTheoreticalSlope<=.125);
assert.ok(result.stats.maximumDeviationFromSourceMeters>1);
assert.ok(result.stats.maximumCutMeters>0&&result.stats.maximumFillMeters>0);
const {positions}=result.terrain;
let maxGrade=0;
for(let j=0;j<=24;j++)for(let i=0;i<=24;i++){
 const k=j*25+i, y=positions[3*k+1];
 assert.ok(Number.isFinite(y));
 if(i<24)maxGrade=Math.max(maxGrade,Math.abs(y-positions[3*(k+1)+1])/5);
 if(j<24)maxGrade=Math.max(maxGrade,Math.abs(y-positions[3*(k+25)+1])/5);
}
assert.ok(maxGrade<.07,'Synthetic benchmark must have visually smooth terrain');
for(const [x,z] of [[-60,-60],[0,0],[12,9],[55,48]]){
 assert.ok(Number.isFinite(result.ground(x,z)));
}
assert.ok(Math.abs(result.ground(0,0)-sourceGround(0,0))>.01);
console.log('SYNTHETIC_BENCHMARK_TERRAIN_UNIT_PASS',JSON.stringify({
  maxGridGrade:maxGrade,stats:result.stats
}));
