// Opt-in visual benchmark terrain: deliberately NOT the original DEM.
// A simple, continuously differentiable low-frequency proxy makes the
// 4-renderer geometry benchmark reproducible without pretending that
// 2D OSM ways or noisy AWS Terrarium contain surveyed road grades.
//
// This is a separate dataset/mode, not a correction for actual Seoul
// elevations. The real DEM and OSM source are still kept as input files.
import {sampleTerrainGrid} from './roadbed_terrain.mjs';

export function buildBenchmarkPresentationTerrain({
  terrain,sourceGround,grid,subdivisions=2,maxBaseSlope=.035,
  lowFrequencyAmplitudeMeters=1.2
}){
  if(!(Number.isInteger(subdivisions)&&subdivisions>=1&&subdivisions<=4
    &&maxBaseSlope>=0&&maxBaseSlope<=.07
    &&lowFrequencyAmplitudeMeters>=0&&lowFrequencyAmplitudeMeters<=3))
    throw Error('Invalid synthetic presentation terrain parameters');
  const original=terrain.positions;
  const n=original.length/3;
  if(n!==((grid.nx+1)*(grid.nz+1)))
    throw Error('Expected original regular DEM grid');
  const cx=(grid.xmin+grid.xmax)/2,cz=(grid.zmin+grid.zmax)/2;
  let mean=0,sxx=0,sxz=0,szz=0,sxy=0,szy=0;
  for(let k=0;k<n;k++){
    const x=original[3*k]-cx,z=original[3*k+2]-cz,y=original[3*k+1];
    if(![x,z,y].every(Number.isFinite))throw Error('Nonfinite source DEM');
    mean+=y;sxx+=x*x;sxz+=x*z;szz+=z*z;sxy+=x*y;szy+=z*y;
  }
  mean/=n;
  // Centered grid means sum(x) = sum(z) ~ 0.
  const determinant=sxx*szz-sxz*sxz;
  if(!(determinant>1e-5))throw Error('Insufficient source grid extent');
  let gx=(sxy*szz-szy*sxz)/determinant;
  let gz=(szy*sxx-sxy*sxz)/determinant;
  const norm=Math.hypot(gx,gz);
  if(norm>maxBaseSlope){gx*=maxBaseSlope/norm;gz*=maxBaseSlope/norm;}
  const nx=grid.nx*subdivisions,nz=grid.nz*subdivisions;
  const bounds={...grid,nx,nz},positions=[],indices=[];
  const lx=grid.xmax-grid.xmin,lz=grid.zmax-grid.zmin;
  let maximumDeviation=0,meanAbsoluteDeviation=0,maxCut=0,maxFill=0;
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
    const x=grid.xmin+lx*i/nx,z=grid.zmin+lz*j/nz;
    const wide=lowFrequencyAmplitudeMeters*
      Math.sin(2*Math.PI*(x-grid.xmin)/lx)*
      Math.sin(2*Math.PI*(z-grid.zmin)/lz);
    const y=mean+gx*(x-cx)+gz*(z-cz)+wide;
    const delta=y-sourceGround(x,z);
    maximumDeviation=Math.max(maximumDeviation,Math.abs(delta));
    maxCut=Math.max(maxCut,-delta);maxFill=Math.max(maxFill,delta);
    meanAbsoluteDeviation+=Math.abs(delta);
    positions.push(x,y,z);
  }
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
    const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  const outTerrain={positions,indices};
  const ground=(x,z)=>sampleTerrainGrid(outTerrain,bounds,x,z);
  const gridVertices=(nx+1)*(nz+1);
  return {terrain:outTerrain,ground,grid:bounds,stats:{
    mode:'synthetic-visual-benchmark-NOT-REAL-SEOUL-ELEVATION',
    method:'least-squares planar DEM trend capped at 3.5% plus smooth broad 1.2m wave',
    inputGrid:[grid.nx+1,grid.nz+1],outputGrid:[nx+1,nz+1],
    terrainTriangles:indices.length/3,
    changedVertices:gridVertices,
    meanAbsoluteChangeOnModified:meanAbsoluteDeviation/gridVertices,
    maximumCutMeters:maxCut,maximumFillMeters:maxFill,
    maximumDeviationFromSourceMeters:maximumDeviation,
    nominalBasePlaneSlope:Math.hypot(gx,gz),
    maximumTheoreticalSlope:Math.hypot(gx,gz)+
      lowFrequencyAmplitudeMeters*2*Math.PI*Math.hypot(1/lx,1/lz),
    heightMeanMeters:mean,lowFrequencyAmplitudeMeters,
    terrainAccuracy:'synthetic - do not compare to Seoul surveyed heights',
    fourEngineComparability:'One common mesh set and material semantics for all benchmarked engines'
  }};
}
