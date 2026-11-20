import assert from 'node:assert/strict';
import {urbanTerrainRepair,gridGradeStats} from './urban_terrain_repair.mjs';
const nx=49,nz=49,dx=13,dz=14,raw=[];
for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  const floor=41+.08*(x-24)*dx-.05*(z-24)*dz;
  // Dense artificial "roof" spike in a city block.
  const roof=(x>=22&&x<=26&&z>=22&&z<=26)?65:0;
  raw.push(floor+roof);
}
const original=gridGradeStats(raw,nx,nz,dx,dz);
assert.ok(original.maxAdjacentGrade>4,'synthetic roof should show a cliff');
const result=urbanTerrainRepair(raw,nx,nz,dx,dz);
const after=result.diagnostics.repaired;
assert.ok(after.maxAdjacentGrade<.252,'excessive post-repair grid slope');
const center=result.heights[24*nx+24];
assert.ok(Math.abs(center-41)<5,'building roof still appears as terrain '+center);
assert.ok(result.diagnostics.changedSamplesOver2m>0);
assert.ok(result.diagnostics.correctionMaxMeters>35);
for(const v of result.heights)assert.ok(Number.isFinite(v));
const flat=Array.from({length:25*25},()=>52);
const same=urbanTerrainRepair(flat,25,25,13,14);
assert.ok(same.heights.every(v=>Math.abs(v-52)<1e-7),'flat terrain damaged');
console.log('URBAN_GROUND_SPIKE_TEST_PASS',JSON.stringify({
  fakeRoofHeightMeters:65,originalMaxGrade:original.maxAdjacentGrade,
  repairedMaxGrade:after.maxAdjacentGrade,centerGroundMeters:center,
  maxCorrectionMeters:result.diagnostics.correctionMaxMeters,
  filterAlgorithm:result.diagnostics.method
}));
