import fs from 'node:fs/promises';
// Numeric audit for the experimental road-only profile. Unlike the previous
// DEM-conformance test, forcing the road to track the raw DEM is not the goal.
const data=JSON.parse(await fs.readFile('public/fixture-detailed.json','utf8'));
const profile=data.metadata.roadGeometryQuality?.roadProfile;
if(!profile)throw Error('Smooth road profile did not run: GEO_ROAD_PROFILE_SMOOTH=1 is required');
const [nx,nz]=data.metadata.terrainGrid.map(n=>n-1);
const [west,south,east,north]=data.metadata.bbox;
const [lon0,lat0]=data.metadata.center;
const cos=Math.cos(lat0*Math.PI/180);
const xmin=(west-lon0)*111320*cos,xmax=(east-lon0)*111320*cos;
const zmin=(south-lat0)*111320,zmax=(north-lat0)*111320;
const stepX=(xmax-xmin)/nx,stepZ=(zmax-zmin)/nz;
const source=data.terrain.positions;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const ground=(x,z)=>{
  const fx=clamp((x-xmin)/stepX,0,nx-1e-7);
  const fz=clamp((z-zmin)/stepZ,0,nz-1e-7);
  const i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j;
  const y=(di,dj)=>source[((j+dj)*(nx+1)+i+di)*3+1];
  return u+v<=1?y(0,0)*(1-u-v)+y(1,0)*u+y(0,1)*v:
    y(1,1)*(u+v-1)+y(1,0)*(1-v)+y(0,1)*(1-u);
};
function weightedPercentile(samples,total,percentile){
  samples.sort((a,b)=>a[0]-b[0]);
  let area=0;
  for(const [value,weight] of samples){
    area+=weight;
    if(area>=total*percentile)return value;
  }
  return samples.at(-1)?.[0]??0;
}
const result={profile,source:data.metadata.demSource,
  bbox:data.metadata.bbox,materials:{},note:
  'Surface triangle grade is not necessarily centerline longitudinal grade. Below-DEM fractions diagnose required local cut/fill, not proof of a geometry algorithm failure.'};
let invalid=0;
for(const [name,mesh] of Object.entries(data.surfaces).filter(([name])=>['road','road-edge'].includes(name))){
  let total=0,steep20=0,steep40=0,below=0,maxDepth=0,maxRise=0,
    samples=0,maxSlope=0;
  const slopeSamples=[];
  const v=mesh.positions,ind=mesh.indices;
  for(let i=0;i<ind.length;i+=3){
    const [[x0,y0,z0],[x1,y1,z1],[x2,y2,z2]]=
      [ind[i],ind[i+1],ind[i+2]].map(k=>v.slice(k*3,k*3+3));
    if(![x0,y0,z0,x1,y1,z1,x2,y2,z2].every(Number.isFinite)){invalid++;continue;}
    const abx=x1-x0,abz=z1-z0,acx=x2-x0,acz=z2-z0;
    const det=abx*acz-abz*acx,area=Math.abs(det)*.5;
    if(area<1e-10){invalid++;continue;}
    const aby=y1-y0,acy=y2-y0;
    const slope=Math.hypot((aby*acz-acy*abz)/det,
      (abx*acy-acx*aby)/det);
    const x=(x0+x1+x2)/3,z=(z0+z1+z2)/3;
    const height=(y0+y1+y2)/3;
    const offset=name==='road'?.22:.15;
    const gap=height-ground(x,z)-offset;
    total+=area;
    slopeSamples.push([slope,area]);
    if(slope>.20)steep20+=area;
    if(slope>.40)steep40+=area;
    if(gap<-.1)below+=area;
    maxDepth=Math.max(maxDepth,-gap);
    maxRise=Math.max(maxRise,gap);
    maxSlope=Math.max(maxSlope,slope);
    samples++;
  }
  result.materials[name]={triangles:ind.length/3,samples,area:total,
    medianSurfaceSlope:weightedPercentile(slopeSamples,total,.5),
    p95SurfaceSlope:weightedPercentile(slopeSamples,total,.95),
    over20Pct:steep20/total*100,over40Pct:steep40/total*100,
    belowDEMBy10cmPct:below/total*100,maxBelowDEM:maxDepth,maxAboveDEM:maxRise,
    maxSurfaceSlope:maxSlope};
}
result.pass=profile.nodeCount>100&&
  profile.smoothedMaxGrade<=profile.maximumGrade+.0002&&invalid===0&&
  Object.keys(result.materials).length===2;
result.invalidTriangles=invalid;
await fs.mkdir('results',{recursive:true});
await fs.writeFile('results/road-profile-validation.json',JSON.stringify(result,null,2));
console.log('ROAD_PROFILE_REAL_SCENE_VALIDATION',JSON.stringify(result));
if(!result.pass)process.exitCode=1;
