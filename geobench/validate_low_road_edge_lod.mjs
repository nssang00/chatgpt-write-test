import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const manifest=JSON.parse(await fs.readFile('public/stream-manifest.json','utf8'));
assert.equal(manifest.lowRoadEdgePresent,false,'Low-LOD kerb geometry should be omitted');
assert.equal(manifest.tiles.length,144);
let sampled=0;
for(const tile of manifest.tiles){
  const url=tile.files.low.url.replace(/^\//,'public/');
  const json=JSON.parse(await fs.readFile(url,'utf8'));
  assert.ok(!('road-edge' in json.materials),'Low-LOD tile includes expensive road edge '+tile.id);
  sampled++;
}
console.log('LOW_LOD_ROAD_EDGE_OPTIMIZATION_PASS',JSON.stringify({
  sampledTiles:sampled,highTriangles:manifest.totals.high,
  lowTriangles:manifest.totals.low,
  lowRoadEdgePresent:manifest.lowRoadEdgePresent
}));
