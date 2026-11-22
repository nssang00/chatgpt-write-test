import fs from 'node:fs/promises';
import { sampleTerrainGrid } from './roadbed_terrain.mjs';
// Read the actual Seoul 3D Tiles source fixture generated using the
// experimental rounded road joins and 2D edge-minus-asphalt difference.
const d=JSON.parse(await fs.readFile('public/fixture-detailed.json','utf8'));
const {meshStats,roadGeometryQuality,terrainGrid,bbox,center}=d.metadata;
const stats=roadGeometryQuality;
if(!stats.roadRenderSmooth)throw Error('GEO_ROAD_RENDER_SMOOTH=1 not enabled');
const [west,south,east,north]=bbox,[lon,lat]=center;
const cos=Math.cos(lat*Math.PI/180),[nx,nz]=terrainGrid.map(x=>x-1);
const grid={nx,nz,xmin:(west-lon)*111320*cos,xmax:(east-lon)*111320*cos,
  zmin:(south-lat)*111320,zmax:(north-lat)*111320};
const ground=(x,z)=>sampleTerrainGrid(d.terrain,grid,x,z);
const report={area:bbox,source:'OSM way centerlines and existing smoothed Terrarium roadbed',
  roadWays:meshStats.roads,roundedJoins:stats.roundedJoins,
  arcVertices:stats.arcVertices,
  asphaltPlanAreaM2:stats.roadAsphaltAreaM2,
  edgeOuterPlanAreaM2:stats.roadEdgeOuterAreaM2,
  edgeVisiblePlanAreaM2:stats.roadEdgeVisibleAreaM2,
  edgeOverlapRemovedM2:stats.roadEdgeOverlapRemovedM2,
  edgePolygons:stats.roadEdgeDifferencePolygons,
  surfaceContact:{},pass:false,
  note:'Road edges are planar differences per OSM layer, not independently surveyed carriageways.'};
let ok=stats.roundedJoins>5&&
  stats.roadEdgeVisibleAreaM2>1000&&
  stats.roadEdgeOverlapRemovedM2>10000&&
  stats.roadEdgeVisibleAreaM2<stats.roadEdgeOuterAreaM2&&
  stats.roadAsphaltAreaM2>10000;
for(const [name,offset] of [['road',.22],['road-edge',.15]]){
 const m=d.surfaces[name];if(!m)throw Error('Missing '+name);
 const ranges=stats.gradeRanges[name];if(!ranges?.length)throw Error('Missing grade span '+name);
 let samples=0,maxAbs=0,invalid=0,separatedGrade=0,atGrade=0,rangeIndex=0;
 for(let i=0;i<m.indices.length;i+=3){
  const triangleIndex=i/3;
  while(rangeIndex<ranges.length&&triangleIndex>=ranges[rangeIndex].to)rangeIndex++;
  const r=ranges[rangeIndex];
  if(!r||triangleIndex<r.from)throw Error('Unclassified triangle '+name+' #'+triangleIndex);
  const a=[m.indices[i],m.indices[i+1],m.indices[i+2]].map(k=>m.positions.slice(3*k,3*k+3));
  if(a.some(p=>p.some(v=>!Number.isFinite(v)))){invalid++;continue;}
  if(r.grade!=='0||'){separatedGrade++;continue;}
  atGrade++;
  for(const [u,v,w] of [[1/3,1/3,1/3],[.5,.5,0],[.5,0,.5],[0,.5,.5]]){
   const x=u*a[0][0]+v*a[1][0]+w*a[2][0];
   const z=u*a[0][2]+v*a[1][2]+w*a[2][2];
   const y=u*a[0][1]+v*a[1][1]+w*a[2][1];
   const err=Math.abs(y-ground(x,z)-offset);
   maxAbs=Math.max(err,maxAbs);samples++;
  }
 }
 report.surfaceContact[name]={triangles:m.indices.length/3,atGrade,separatedGrade,
   checkedSamples:samples,maxAbsErrorM:maxAbs,invalid};
 ok&&=samples>1000&&maxAbs<.01&&invalid===0;
}
report.pass=ok;
await fs.mkdir('results',{recursive:true});
await fs.writeFile('results/road-render-shape-qa.json',JSON.stringify(report,null,2));
console.log('ROAD_RENDER_SHAPE_REAL_SCENE_QA',JSON.stringify(report));
if(!report.pass)process.exitCode=1;
