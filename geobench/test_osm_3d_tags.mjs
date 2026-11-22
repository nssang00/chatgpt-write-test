import assert from 'node:assert/strict';
import {parseMeters,interpretBuildingTags,roofTriangles} from './osm_3d_buildings.mjs';

assert.equal(parseMeters('45'),45);
assert.equal(parseMeters('45 m'),45);
assert.equal(parseMeters('100ft'),30.48);
assert.equal(parseMeters('45-50'),null);
assert.equal(parseMeters('unknown'),null);
const measured=interpretBuildingTags({
  building:'office',height:'45', 'building:levels':'15',
  'roof:shape':'gabled','roof:height':'3','min_height':'5',
  name:'example',start_date:'1985'
},7);
assert.equal(measured.height,45);
assert.equal(measured.roofHeight,3);
assert.equal(measured.wallHeight,42);
assert.equal(measured.minHeight,5);
assert.equal(measured.floors,15);
assert.equal(measured.source,'height');
assert.equal(measured.roofHeightEstimated,false);
assert.equal(measured.datePresent,true);
const inferred=interpretBuildingTags({
 'building:levels':'3','roof:shape':'hipped','roof:levels':'1',
 'building:min_level':'1'
},1);
assert.equal(inferred.height,3*3.05+3);
assert.equal(inferred.minHeight,3.05);
assert.equal(inferred.floors,2);
assert.equal(inferred.roofHeight,3);
assert.equal(inferred.source,'building:levels');
const fallback=interpretBuildingTags({},2);
assert.equal(fallback.source,'inferred');
assert.equal(fallback.roofShape,'flat');
const rect=[[0,0],[16,0],[16,8],[0,8]];
for(const shape of ['gabled','hipped','pyramidal']){
 const geometry=roofTriangles(rect,10,13,shape);
 assert.ok(geometry,'supported '+shape+' roof geometry missing');
 assert.ok(geometry.roof.length>=4,'roof triangles missing');
 for(const triangle of [...geometry.roof,...geometry.gable]){
   assert.equal(triangle.length,3);
   for(const p of triangle){
     assert.equal(p.length,3);
     assert.ok(p.every(Number.isFinite));
     assert.ok(p[1]>=10&&p[1]<=13);
   }
 }
}
assert.equal(roofTriangles([[0,0],[15,0],[15,5],[8,3],[0,5]],10,13,'gabled'),null);
assert.equal(roofTriangles([[0,0],[15,0],[14,5],[0,5]],10,13,'gabled')?.roof.length,undefined);
console.log('OSM_3D_BUILDING_TAG_UNIT_PASS',{
  height:measured.height,roof:measured.roofShape,
  minHeight:measured.minHeight,levels:measured.floors
});
