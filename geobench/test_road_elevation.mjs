import fs from 'node:fs';
import assert from 'node:assert/strict';
const d=JSON.parse(fs.readFileSync('public/fixture-detailed.json','utf8'));
const audit=d.metadata.terrainAudit;
assert.ok(audit,'Missing terrain provenance');
assert.ok(audit.observedMaximumSlope<=.181,'Rendered terrain violates 18% gradient cap');
const materials={terrain:d.terrain,...d.surfaces};
const quality={};
for(const name of ['terrain','road','road-edge','road-marking']){
 const m=materials[name];
 let maxVertical=0,maxDistance=0,steep=0,maxGradient=0;
 for(let i=0;i<m.indices.length;i+=3){
  const ix=m.indices.slice(i,i+3);
  const v=ix.map(n=>m.positions.slice(3*n,3*n+3));
  const y=v.map(x=>x[1]);
  maxVertical=Math.max(maxVertical,Math.max(...y)-Math.min(...y));
  let length=0;
  for(let j=0;j<3;j++){
    const a=v[j],b=v[(j+1)%3];
    const dist=Math.hypot(b[0]-a[0],b[2]-a[2]);
    length=Math.max(length,dist);
    if(dist>1e-5)maxGradient=Math.max(maxGradient,Math.abs(a[1]-b[1])/dist);
  }
  maxDistance=Math.max(maxDistance,length);
  if(Math.max(...y)-Math.min(...y)>8)steep++;
 }
 quality[name]={triangles:m.indices.length/3,maxVerticalMeters:maxVertical,maxEdgeMeters:maxDistance,maxGradient,trianglesOver8mHeight:steep};
}
assert.equal(quality.terrain.trianglesOver8mHeight,0,'Terrain still contains dramatic elevation cliffs');
assert.equal(quality.road.trianglesOver8mHeight,0,'Road triangles still contain dramatic vertical jumps');
assert.equal(quality['road-edge'].trianglesOver8mHeight,0,'Road shoulder triangles still contain cliff jumps');
assert.ok(quality.terrain.maxGradient<.182);
assert.ok(d.metadata.meshStats.roadJunctions>=100);
console.log('ROAD_ELEVATION_TRIANGLE_QA_PASS',JSON.stringify({terrainAudit:audit,quality}));
