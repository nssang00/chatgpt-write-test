// Shared integrated roadbed + ground: roads and surrounding terrain use
// precisely the same piecewise-planar height field, rather than punching
// jagged holes in an independent DEM mesh.
//
// This is a *visual modelling experiment*. It is not surveyed street grades,
// earthworks, or retaining-wall engineering. All deformation is quantified.
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const smoothstep=t=>t*t*(3-2*t);

export function sampleTerrainGrid(terrain,grid,x,z){
  const {xmin,xmax,zmin,zmax,nx,nz}=grid;
  const fx=clamp((x-xmin)/(xmax-xmin)*nx,0,nx-1e-8);
  const fz=clamp((z-zmin)/(zmax-zmin)*nz,0,nz-1e-8);
  const i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j;
  const positions=terrain.positions;
  const y=(di,dj)=>positions[((j+dj)*(nx+1)+i+di)*3+1];
  return u+v<=1?y(0,0)*(1-u-v)+y(1,0)*u+y(0,1)*v
    :y(1,1)*(u+v-1)+y(1,0)*(1-v)+y(0,1)*(1-u);
}

export function buildIntegratedRoadbed({
  terrain,sourceGround,profile,grid,subdivisions=2,shoulderMeters=50
}){
  if(!profile||typeof profile.sampleAt!=='function')
    throw Error('Roadbed requires a shared road centerline profile');
  if(!(Number.isInteger(subdivisions)&&subdivisions>=1&&subdivisions<=4&&shoulderMeters>=10))
    throw Error('Invalid integrated roadbed resolution / shoulder size');
  const nx=grid.nx*subdivisions,nz=grid.nz*subdivisions;
  const bounds={xmin:grid.xmin,xmax:grid.xmax,zmin:grid.zmin,zmax:grid.zmax,nx,nz};
  const positions=[],indices=[];
  let modified=0,plateau=0,maxCut=0,maxFill=0,sumAbsolute=0;
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
    const x=grid.xmin+(grid.xmax-grid.xmin)*i/nx;
    const z=grid.zmin+(grid.zmax-grid.zmin)*j/nz;
    const raw=sourceGround(x,z);
    // Only ordinary at-grade roadways modify the earth surface. Elevated
    // bridges and tunnels retain separate grade-layer semantics.
    const nearest=profile.sampleAt(x,z,'0||');
    let weight=0;
    if(Number.isFinite(nearest.distance)){
      // Largest bounded miter in the current mesher is 2.3 * halfWidth,
      // plus 1.65m road-edge skirt. Keep the whole polygon footprint on
      // the same roadbed before the shoulder transition begins.
      const inner=2.3*nearest.halfWidth+1.65+2.0;
      const outer=inner+shoulderMeters;
      if(nearest.distance<=inner)weight=1;
      else if(nearest.distance<outer)
        weight=1-smoothstep((nearest.distance-inner)/(outer-inner));
    }
    const height=raw+(nearest.height-raw)*weight;
    if(weight>1e-8){modified++;sumAbsolute+=Math.abs(height-raw);}
    if(weight>=1-1e-8)plateau++;
    maxCut=Math.max(maxCut,raw-height);
    maxFill=Math.max(maxFill,height-raw);
    positions.push(x,height,z);
  }
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
    const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
    // The same diagonal and winding as generate.mjs.
    indices.push(a,c,b,b,c,d);
  }
  const renderTerrain={positions,indices};
  const ground=(x,z)=>sampleTerrainGrid(renderTerrain,bounds,x,z);
  return {terrain:renderTerrain,ground,grid:bounds,stats:{
    inputGrid:[grid.nx+1,grid.nz+1],
    outputGrid:[nx+1,nz+1],
    terrainTriangles:indices.length/3,
    changedVertices:modified,
    fullRoadbedVertices:plateau,
    meanAbsoluteChangeOnModified:sumAbsolute/Math.max(1,modified),
    maximumCutMeters:maxCut,maximumFillMeters:maxFill,
    shoulderMeters,
    method:'shared heightfield: road and terrain triangulated on same grid; continuous smoothstep shoulder'
  }};
}
