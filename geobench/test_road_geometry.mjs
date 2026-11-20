import assert from 'node:assert/strict';
import { buildRoadGeometry } from './road_geometry.mjs';

const ground=(x,z)=>27+.08*x-.12*z;
const settings={project:(x,z)=>[x,z],ground,bounds:[-30,-30,30,30],maxStep:6};
const road=(id,coords,nodeIds,width=8,tags={})=>({id,refs:coords,nodeIds,width,tags});
const eps=(a,b)=>Math.abs(a-b)<1e-5;
const triCount=mesh=>mesh.indices.length/3;
function run(name,roads,options=settings){
  const result=buildRoadGeometry(roads,options);
  for(const [material,m] of Object.entries(result.meshes)){
    assert.equal(m.positions.length%3,0,'invalid vertex count '+name+material);
    assert.equal(m.indices.length%3,0,'invalid triangle count '+name+material);
    for(const v of m.positions)assert.ok(Number.isFinite(v),name+' nonfinite '+material);
    if(m.indices.length)assert.ok(Math.max(...m.indices)<m.positions.length/3,name+' invalid index');
  }
  return result;
}
function vertex(mesh,index){
  return mesh.positions.slice(index*3,index*3+3);
}
function nearXYZ(a,b){
  assert.ok(a.every((x,i)=>eps(x,b[i])),JSON.stringify({a,b}));
}
// 90-degree centerline turn should be truly connected at both edges.
{
  const r=run('right angle',[road('w1',[[0,0],[0,10],[10,10]],['a','bend','c'])],
      {...settings,maxStep:100});
  assert.equal(triCount(r.meshes.road),4);
  assert.deepEqual(r.stats.junctionPatches,0);
  nearXYZ(vertex(r.meshes.road,1),vertex(r.meshes.road,4));
  nearXYZ(vertex(r.meshes.road,2),vertex(r.meshes.road,7));
  assert.ok(r.stats.joinVertices>=1);
}
// At-grade T-junction uses a polygon fan, and no centerlines go across it.
{
  const r=run('T intersection',[
    road('east',[[-20,0],[0,0]],['e','junction'],8),
    road('west',[[0,0],[20,0]],['junction','w'],10),
    road('north',[[0,0],[0,20]],['junction','n'],6)
  ]);
  assert.equal(r.stats.junctionPatches,1);
  assert.equal(r.stats.junctionsByDegree['3'],1);
  assert.ok(triCount(r.meshes.road)>=6);
  // An intersection patch should follow incident road widths, not create
  // unbounded circular fan triangles or extreme side protrusions.
  const p=r.meshes.road.positions;
  for(let v=0;v<p.length;v+=3){
    assert.ok(Math.abs(p[v])<38&&Math.abs(p[v+2])<38);
  }
}
// Roads with a shared x/z crossing but different OSM node IDs are not
// accidentally made into a graph intersection.
{
  const r=run('grade-separated crossing with no common node',[
    road('a',[[-20,0],[20,0]],['a0','a1'],9),
    road('b',[[0,-20],[0,20]],['b0','b1'],9,{bridge:'yes',layer:'1'})
  ]);
  assert.equal(r.stats.junctionPatches,0);
  assert.equal(r.stats.protectedGradeWays,1);
}
// Even a shared OSM ID may not combine roads with different grade keys.
{
  const r=run('shared node separate grade',[
    road('a',[[-20,0],[0,0]],['a0','shared'],9),
    road('b',[[0,0],[20,0]],['shared','b1'],9),
    road('c',[[0,0],[0,20]],['shared','c1'],9,{bridge:'yes',layer:'1'})
  ]);
  assert.equal(r.stats.junctionPatches,0);
}
// Both way endpoints are outside the bbox, but the line crosses it.
// Old road mesher omitted these, causing abruptly missing roads.
{
  const r=run('cross-bbox',[road('long',[[-70,0],[70,0]],['a','b'],8)]);
  assert.equal(r.stats.sourceWays,1);
  assert.ok(r.stats.emittedSubsegments>5);
  for(let i=0;i<r.meshes.road.positions.length;i+=3){
    assert.ok(Math.abs(r.meshes.road.positions[i])<=42+8,'not clipped');
  }
}
// Surface lies 22cm above the exact terrain height at EACH offset vertex,
// not interpolated from road centerline endpoints.
{
  const r=run('terrain',[
    road('bend',[[-19,-13],[5,0],[14,19]],['a','b','c'],8)
  ]);
  for(let i=0;i<r.meshes.road.positions.length;i+=3){
    const [x,y,z]=r.meshes.road.positions.slice(i,i+3);
    assert.ok(eps(y,ground(x,z)+.22),'road is not properly terrain-draped '+JSON.stringify([x,y,z]));
  }
  assert.ok(r.stats.emittedSubsegments>=8);
}
// Extreme turn must be bounded rather than produce unbounded spike geometry.
{
  const r=run('extreme turn',[road('u',[[0,0],[10,0],[.3,.2]],['a','b','c'],8)],{...settings,maxStep:100});
  assert.ok(r.stats.bevelLimitedJoins>0||r.stats.reversalJoins>0);
  assert.ok(triCount(r.meshes.road)>0);
}
// Center marking is continuous but skipped for one-way or single-lane roads.
{
  const two=run('two-way',[road('two',[[-25,0],[25,0]],['a','b'],9)]);
  const one=run('oneway',[road('one',[[-25,0],[25,0]],['a','b'],9,{oneway:'yes'})]);
  const oneLane=run('one lane',[road('one',[[-25,0],[25,0]],['a','b'],9,{lanes:'1'})]);
  assert.ok(two.stats.markingDashes>0);
  assert.equal(triCount(one.meshes['road-marking']),0);
  assert.equal(triCount(oneLane.meshes['road-marking']),0);
}
console.log('ROAD_TOPOLOGY_UNIT_TEST_PASS',{
  tests:8,
  algorithms:['continuous miter','T junction','shared-node topology',
    'layer/bridge separation','bbox clipping','triangulated terrain drape',
    'miter spike bounds','one-way markings']
});
