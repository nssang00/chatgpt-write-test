import assert from 'node:assert/strict';
import pc from 'polygon-clipping';
import { roundedCorridor } from './road_offset_corridor.mjs';
import { unionRoadPolygons, subtractRoadPolygons, roadPolygonArea } from './road_polygon_union.mjs';
import { buildRoadGeometry } from './road_geometry.mjs';

const stat=()=>({joinVertices:0,reversalJoins:0,bevelLimitedJoins:0,
  roundedJoins:0,arcVertices:0,discardedRoadRings:0});
const road=(id,xy,nodes,width=8,tags={})=>({id,refs:xy,nodeIds:nodes,width,tags});
const perGrade=polys=>{
  const m=new Map();
  for(const x of polys){const p=m.get(x.grade)||[];p.push(x.rings);m.set(x.grade,p);}
  return m;
};
const scenarios=[
  ['right-angle',[road('bend',[[0,0],[0,20],[20,20]],['a','b','c'],8)]],
  ['T-junction',[
    road('a',[[-23,0],[0,0]],['a0','j'],8),
    road('b',[[0,0],[23,0]],['j','b0'],10),
    road('c',[[0,0],[0,23]],['j','c0'],7)
  ]],
  ['acute',[
    road('acute',[[-24,-10],[0,0],[20,2]],['a','b','c'],12),
    road('branch',[[0,0],[-4,23]],['b','d'],7)
  ]],
  ['hairpin',[road('hairpin',[[0,0],[20,0],[1,2]],['a','b','c'],8)]],
  ['bridge-grade',[
    road('street',[[-20,0],[20,0]],['s0','s1'],9),
    road('flyover',[[0,-25],[0,25]],['f0','f1'],8,{bridge:'yes',layer:'1'})
  ]]
];
for(const [label,roads] of scenarios){
  const stats=stat();
  const entriesRoad=[],entriesEdge=[];
  for(const r of roads){
    const pts=r.refs.map(([x,z])=>({x,z}));
    const grade=r.tags?.bridge?'1|bridge|':'0||';
    entriesRoad.push({grade,points:roundedCorridor(pts,r.width/2,stats)});
    entriesEdge.push({grade,points:roundedCorridor(pts,r.width/2+1.65,stat())});
  }
  const asphalt=unionRoadPolygons(entriesRoad,stats);
  const outer=unionRoadPolygons(entriesEdge,stats);
  const edge=subtractRoadPolygons(outer,asphalt,stats);
  assert.ok(roadPolygonArea(edge)>0,'missing border '+label);
  const outerArea=roadPolygonArea(outer),totalArea=roadPolygonArea(asphalt)+roadPolygonArea(edge);
  assert.ok(Math.abs(outerArea-totalArea)<.08*outerArea,
    'edge area not outer minus asphalt '+label+' '+JSON.stringify({outerArea,totalArea}));
  const a=perGrade(asphalt),e=perGrade(edge);
  for(const [grade,edges] of e){
    const overlap=a.has(grade)?pc.intersection(edges,a.get(grade)):[];
    const area=roadPolygonArea(overlap.map(rings=>({grade,rings})));
    assert.ok(area<.001,'road edge must not overlap asphalt '+label+' grade='+grade+' area='+area);
  }
  const render=buildRoadGeometry(roads,{
    project:(x,z)=>[x,z],ground:(x,z)=>10+.008*x-.006*z,
    bounds:[-30,-30,30,30],maxStep:4,roadRenderSmooth:true
  });
  assert.ok(render.stats.roadRenderSmooth);
  assert.ok(render.stats.roadEdgeVisibleAreaM2>0);
  assert.ok(render.meshes.road.indices.length>0);
  assert.ok(render.meshes['road-edge'].indices.length>0);
  assert.ok(render.meshes['road-marking'].indices.length>=0);
  for(const [name,mesh] of Object.entries(render.meshes)){
    assert.ok(mesh.positions.every(Number.isFinite),'invalid '+name+' '+label);
    assert.equal(mesh.indices.length%3,0,'bad triangles '+name+' '+label);
  }
  if(label==='right-angle')assert.ok(stats.roundedJoins>0,'outward round join missing');
  console.log('ROAD_RENDER_SCENARIO_PASS',JSON.stringify({
    label,roundJoins:stats.roundedJoins,
    borderArea:roadPolygonArea(edge),
    removedOverlapArea:stats.roadEdgeOverlapRemovedM2,
    triangles:render.stats.triangles
  }));
}
console.log('ROAD_RENDER_SHAPE_UNIT_PASS');
