import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
// Hard gate: the display terrain must be exactly the source Mapzen
// Terrarium mesh generated in fixture.json, without any smoothing/roadbed
// mutations. Merely claiming that the road "matches" the DEM is not enough.
const base=JSON.parse(await fs.readFile('public/fixture.json','utf8'));
const scene=JSON.parse(await fs.readFile('public/fixture-detailed.json','utf8'));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const identicalPositionHash=hash(base.terrain.positions)===hash(scene.terrain.positions);
const identicalIndexHash=hash(base.terrain.indices)===hash(scene.terrain.indices);
const rawDem=base.metadata.visualTerrainFilter==='none';
const roadOffsets=scene.metadata.diagnosticRoadOffsetMeters;
const report={
  bbox:base.metadata.bbox,
  terrainSource:base.metadata.demSource,
  rawDEMFilter:base.metadata.visualTerrainFilter,
  originalTerrain:{
    vertices:base.terrain.positions.length/3,
    triangles:base.terrain.indices.length/3,
    positionsSHA256:hash(base.terrain.positions),
    indicesSHA256:hash(base.terrain.indices),
    originalEqualDetailedPositions:identicalPositionHash,
    originalEqualDetailedIndices:identicalIndexHash,
    changedTerrainVertices:identicalPositionHash?0:null
  },
  sourceRoadWays:scene.metadata.meshStats.roads,
  roadOffsets,materials:{},pass:false
};
const [west,south,east,north]=base.metadata.bbox,[lon,lat]=base.metadata.center;
const cos=Math.cos(lat*Math.PI/180);
const xmin=(west-lon)*111320*cos,xmax=(east-lon)*111320*cos;
const zmin=(south-lat)*111320,zmax=(north-lat)*111320;
const nx=base.metadata.terrainGrid[0]-1,nz=base.metadata.terrainGrid[1]-1;
const dx=(xmax-xmin)/nx,dz=(zmax-zmin)/nz;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const source=base.terrain.positions;
function ground(x,z){
  const fx=clamp((x-xmin)/dx,0,nx-1e-7);
  const fz=clamp((z-zmin)/dz,0,nz-1e-7);
  const i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j;
  const y=(di,dj)=>source[((j+dj)*(nx+1)+i+di)*3+1];
  return u+v<=1?y(0,0)*(1-u-v)+y(1,0)*u+y(0,1)*v:
    y(1,1)*(u+v-1)+y(1,0)*(1-v)+y(0,1)*(1-u);
}
let pass=identicalPositionHash&&identicalIndexHash&&rawDem&&
  !!scene.metadata.roadDebugFocus?.every(Number.isFinite);
for(const [name,offset] of Object.entries(roadOffsets)){
 const m=scene.surfaces[name];
 if(!m)throw Error('Missing road mesh '+name);
 let errors=0,samples=0,maxAbs=0,degenerate=0,invalid=0,areaOver20=0,areaOver40=0,area=0;
 for(let i=0;i<m.indices.length;i+=3){
   const pts=m.indices.slice(i,i+3).map(k=>m.positions.slice(k*3,k*3+3));
   if(pts.some(a=>a.some(x=>!Number.isFinite(x)))){invalid++;continue;}
   const [a,b,c]=pts;
   const cross=(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
   const planArea=Math.abs(cross)*.5;
   if(planArea<1e-10){degenerate++;continue;}
   area+=planArea;
   const ay=b[1]-a[1],by=c[1]-a[1];
   const ax=b[0]-a[0],bx=c[0]-a[0],az=b[2]-a[2],bz=c[2]-a[2];
   const denominator=ax*bz-bx*az;
   const gx=(ay*bz-by*az)/denominator,gz=(by*ax-ay*bx)/denominator;
   const grade=Math.hypot(gx,gz);
   if(grade>.2)areaOver20+=planArea;
   if(grade>.4)areaOver40+=planArea;
   for(const [u,v,w] of [[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]]){
     const x=u*a[0]+v*b[0]+w*c[0],z=u*a[2]+v*b[2]+w*c[2];
     const y=u*a[1]+v*b[1]+w*c[1];
     const err=Math.abs(y-ground(x,z)-offset);
     maxAbs=Math.max(maxAbs,err);samples++;
     if(err>.01)errors++;
   }
 }
 const ok=samples>100&&maxAbs<.01&&errors===0&&degenerate===0&&invalid===0;
 report.materials[name]={
   triangles:m.indices.length/3,samples,maxAbsErrorMeters:maxAbs,
   terrainContactFailures:errors,invalidVertices:invalid,degenerateTriangles:degenerate,
   areaSquareMeters:area,areaGradeOver20Pct:area>0?areaOver20/area*100:null,
   areaGradeOver40Pct:area>0?areaOver40/area*100:null,pass:ok
 };
 pass&&=ok;
}
report.pass=pass;
report.note='Road slope statistics are evidence of the raw input DEM. Their excess does not prove the road draping mesher is wrong.';
report.caveat='OSM bridge/tunnel layer tags do NOT supply physical vertical clearance; survey accuracy is not claimed.';
await fs.mkdir('results',{recursive:true});
await fs.writeFile('results/raw-dem-drape-audit.json',JSON.stringify(report,null,2));
console.log('RAW_DEM_DRAPE_AUDIT',JSON.stringify(report));
if(!pass)process.exitCode=1;
