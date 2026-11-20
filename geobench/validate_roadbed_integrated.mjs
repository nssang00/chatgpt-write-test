import fs from 'node:fs/promises';
import { sampleTerrainGrid } from './roadbed_terrain.mjs';

// Audit the *generated* Seoul 3D geometry: all asphalt, edge and paint
// triangles must lie on the *same* continuously rendered terrain height
// field, not independently interpolated raw Terrarium or a road profile.
const scene=JSON.parse(await fs.readFile('public/fixture-detailed.json','utf8'));
const base=JSON.parse(await fs.readFile('public/fixture.json','utf8'));
const roadbed=scene.metadata.roadbed;
if(!roadbed)throw Error('GEO_ROADBED_INTEGRATED=1 was not enabled');
if(scene.metadata.roadTerrainCut)throw Error('Integrated roadbed unexpectedly punched holes in the DEM');
const [west,south,east,north]=scene.metadata.bbox;
const [lon,lat]=scene.metadata.center;
const cos=Math.cos(lat*Math.PI/180);
const [nx,nz]=scene.metadata.terrainGrid.map(n=>n-1);
const grid={nx,nz,xmin:(west-lon)*111320*cos,xmax:(east-lon)*111320*cos,
  zmin:(south-lat)*111320,zmax:(north-lat)*111320};
const ground=(x,z)=>sampleTerrainGrid(scene.terrain,grid,x,z);
const sourceGrid={...grid,nx:base.metadata.terrainGrid[0]-1,
  nz:base.metadata.terrainGrid[1]-1};
const original=(x,z)=>sampleTerrainGrid(base.terrain,sourceGrid,x,z);
const report={
 input:'Seoul Gangnam OSM centerlines and AWS Mapzen Terrarium (NOT survey data)',
 bounds:scene.metadata.bbox,roadbed,
 grid:scene.metadata.terrainGrid,
 profile:scene.metadata.roadGeometryQuality.roadProfile,
 maxAllowedContactErrorMeters:.01,
 materials:{},terrain:{},pass:false
};
if(scene.terrain.indices.length!==2*nx*nz*3)throw Error('Roadbed terrain is not a watertight regular grid');
let bad=0,checked=0;
let gridMaxCut=0,gridMaxFill=0;
for(let i=0;i<scene.terrain.positions.length;i+=3){
 const [x,y,z]=scene.terrain.positions.slice(i,i+3);
 if(![x,y,z].every(Number.isFinite)){bad++;continue;}
 const diff=y-original(x,z);
 gridMaxCut=Math.max(gridMaxCut,-diff);
 gridMaxFill=Math.max(gridMaxFill,diff);
}
report.terrain={
 triangles:scene.terrain.indices.length/3,
 invalidVertices:bad,maximumCutMeters:gridMaxCut,maximumFillMeters:gridMaxFill,
 holes:0,method:'complete regular-grid terrain; road shares exact same triangles'
};
for(const [name,offset] of [['road',.22],['road-edge',.15],['road-marking',.285]]){
 const mesh=scene.surfaces[name];
 if(!mesh)throw Error('Missing road surface '+name);
 let maxAbs=0,invalid=0,degenerate=0,samples=0,area=0;
 let atGradeTriangles=0,separatedGradeTriangles=0,rangeIndex=0;
 const ranges=scene.metadata.roadGeometryQuality?.gradeRanges?.[name]??[];
 if(name!=='road-marking'&&!ranges.length)throw Error('Missing grade spans for '+name);
 let above20=0,above40=0;
 for(let i=0;i<mesh.indices.length;i+=3){
   // Only at-grade surfaces are required to lie on the roadbed. A bridge
   // or tunnel must NOT be tested against (or flattened onto) surface DEM.
   let checkContact=true;
   if(name!=='road-marking'){
     const triId=i/3;
     while(rangeIndex<ranges.length&&triId>=ranges[rangeIndex].to)rangeIndex++;
     const span=ranges[rangeIndex];
     if(!span||triId<span.from||triId>=span.to)
       throw Error('Road triangle is missing a grade classification '+triId);
     checkContact=span.grade==='0||';
   }
   if(checkContact)atGradeTriangles++;
   else separatedGradeTriangles++;
   const p=mesh.indices.slice(i,i+3).map(k=>mesh.positions.slice(k*3,k*3+3));
   if(p.some(a=>a.some(n=>!Number.isFinite(n)))){invalid++;continue;}
   const [a,b,c]=p;
   const abx=b[0]-a[0],abz=b[2]-a[2],acx=c[0]-a[0],acz=c[2]-a[2];
   const det=abx*acz-abz*acx,triArea=Math.abs(det)*.5;
   if(triArea<1e-10){degenerate++;continue;}
   area+=triArea;
   const dy1=b[1]-a[1],dy2=c[1]-a[1];
   const gradient=Math.hypot((dy1*acz-dy2*abz)/det,(abx*dy2-acx*dy1)/det);
   if(gradient>.20)above20+=triArea;
   if(gradient>.40)above40+=triArea;
   if(checkContact)for(const [u,v,w] of [[1,0,0],[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]]){
     const x=a[0]*u+b[0]*v+c[0]*w,z=a[2]*u+b[2]*v+c[2]*w;
     const y=a[1]*u+b[1]*v+c[1]*w;
     const error=Math.abs(y-ground(x,z)-offset);
     maxAbs=Math.max(maxAbs,error);
     samples++;
   }
 }
 report.materials[name]={
  triangles:mesh.indices.length/3,atGradeTriangles,separatedGradeTriangles,
  contactSamples:samples,
  maxContactErrorMeters:maxAbs,
  degenerateTriangles:degenerate,invalidTriangles:invalid,
  area,areaOver20Pct:above20/area*100,areaOver40Pct:above40/area*100,
  pass:samples>100&&maxAbs<=report.maxAllowedContactErrorMeters&&invalid===0&&degenerate===0
 };
 checked+=samples;
}
const stats=report.profile;
report.pass=bad===0&&checked>1000&&stats?.smoothedMaxGrade<=.12001&&
  report.terrain.holes===0&&Object.values(report.materials).every(x=>x.pass);
await fs.mkdir('results',{recursive:true});
await fs.writeFile('results/roadbed-integrated-validation.json',JSON.stringify(report,null,2));
console.log('ROADBED_INTEGRATED_REAL_SCENE_VALIDATION',JSON.stringify(report));
if(!report.pass)process.exitCode=1;
