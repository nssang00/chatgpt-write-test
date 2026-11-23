// PLAN-BOUNDARY local road corridor. Unlike the old 50m centerline
// kernel that deformed almost every Seoul DEM node, this experimental
// roadbed uses the *unioned asphalt polygon boundary* as the zero-distance
// cut/fill boundary, and leaves the original DEM unchanged outside a
// bounded transition shoulder.
//
// IMPORTANT: this is a conservative visual benchmark fallback, not a
// surveyed road. A 3m vertical budget cannot guarantee smooth asphalt
// where the original Terrarium DEM is much noisier than that budget.
// Such roads must be flagged for real road-height/3D survey input.
import {sampleTerrainGrid} from './roadbed_terrain.mjs';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smoothstep=t=>t*t*(3-2*t);
const distSegment=(x,z,e)=>{
  const dx=e.bx-e.ax,dz=e.bz-e.az,den=dx*dx+dz*dz;
  if(den<1e-12)return Math.hypot(x-e.ax,z-e.az);
  const t=clamp(((x-e.ax)*dx+(z-e.az)*dz)/den,0,1);
  return Math.hypot(x-e.ax-t*dx,z-e.az-t*dz);
};

export function buildLocalRoadCorridor({
  terrain,sourceGround,profile,footprint,grid,
  subdivisions=2,shoulderMeters=12,maxVerticalAdjustmentMeters=3
}){
  if(!profile?.sampleAt||!footprint?.polygons?.length)
    throw Error('Local corridor needs a road profile and asphalt union');
  if(!(Number.isInteger(subdivisions)&&subdivisions>=1&&subdivisions<=4
    &&shoulderMeters>=2&&shoulderMeters<=50
    &&maxVerticalAdjustmentMeters>0&&maxVerticalAdjustmentMeters<=15))
    throw Error('Bad local corridor options');

  const edges=[];
  for(const {grade,rings} of footprint.polygons){
    if(grade!=='0||')throw Error('Cannot modify DEM beneath bridges or tunnels');
    for(const ring of rings){
      for(let i=0;i<ring.length-1;i++){
        const a=ring[i],b=ring[i+1];
        if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-7)continue;
        edges.push({ax:a[0],az:a[1],bx:b[0],bz:b[1],
          minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),
          minZ:Math.min(a[1],b[1]),maxZ:Math.max(a[1],b[1])});
      }
    }
  }
  if(!edges.length)throw Error('Invalid empty asphalt polygon boundary');

  const nx=grid.nx*subdivisions,nz=grid.nz*subdivisions;
  const bounds={xmin:grid.xmin,xmax:grid.xmax,zmin:grid.zmin,zmax:grid.zmax,nx,nz};
  const hashSize=Math.max(8,shoulderMeters),buckets=new Map();
  const cellKey=(i,j)=>i+':'+j;
  // Index only short-range segments for shoulder distance; the pavement
  // interior is computed from exact even-odd polygon scanlines.
  for(let k=0;k<edges.length;k++){
    const e=edges[k];
    const ia=Math.floor((e.minX-shoulderMeters)/hashSize);
    const ib=Math.floor((e.maxX+shoulderMeters)/hashSize);
    const ja=Math.floor((e.minZ-shoulderMeters)/hashSize);
    const jb=Math.floor((e.maxZ+shoulderMeters)/hashSize);
    for(let j=ja;j<=jb;j++)for(let i=ia;i<=ib;i++){
      const key=cellKey(i,j),list=buckets.get(key);
      if(list)list.push(k);else buckets.set(key,[k]);
    }
  }
  const positions=[],indices=[];
  let pavementVertices=0,shoulderVertices=0,unchangedVertices=0;
  let changedVertices=0,clampedVerticalVertices=0,profileDiscrepancyOverBudget=0;
  let maxCut=0,maxFill=0,maximumChange=0,sumAbsolute=0;
  let maxProfileDiscrepancy=0;

  for(let j=0;j<=nz;j++){
    const z=bounds.zmin+(bounds.zmax-bounds.zmin)*j/nz;
    // A union of non-overlapping polygons and holes can be scanned as
    // one even-odd boundary set. Unlike per-polygon point tests, this
    // is O(roadEdges * rows + intersections log intersections).
    const crossings=[];
    for(const e of edges){
      if((e.az<=z&&z<e.bz)||(e.bz<=z&&z<e.az))
        crossings.push(e.ax+(z-e.az)*(e.bx-e.ax)/(e.bz-e.az));
    }
    crossings.sort((a,b)=>a-b);
    let c=0;
    for(let i=0;i<=nx;i++){
      const x=bounds.xmin+(bounds.xmax-bounds.xmin)*i/nx;
      while(c<crossings.length&&crossings[c]<=x)c++;
      const inside=(c%2)===1;
      let weight=0;
      if(inside){weight=1;pavementVertices++;}
      else{
        const candidates=buckets.get(cellKey(Math.floor(x/hashSize),Math.floor(z/hashSize)))||[];
        let distance=Infinity;
        for(const k of candidates){
          const e=edges[k];
          if(x<e.minX-shoulderMeters||x>e.maxX+shoulderMeters||
             z<e.minZ-shoulderMeters||z>e.maxZ+shoulderMeters)continue;
          const d=distSegment(x,z,e);
          if(d<distance)distance=d;
        }
        if(distance<shoulderMeters){
          weight=1-smoothstep(distance/shoulderMeters);
          shoulderVertices++;
        }else unchangedVertices++;
      }
      const original=sourceGround(x,z);
      let newHeight=original;
      if(weight>0){
        const designHeight=profile.sampleAt(x,z,'0||').height;
        const desired=designHeight-original;
        const absolute=Math.abs(desired);
        maxProfileDiscrepancy=Math.max(maxProfileDiscrepancy,absolute);
        if(absolute>maxVerticalAdjustmentMeters){
          clampedVerticalVertices++;
          if(inside)profileDiscrepancyOverBudget++;
        }
        newHeight+=weight*clamp(desired,-maxVerticalAdjustmentMeters,maxVerticalAdjustmentMeters);
      }
      const diff=newHeight-original;
      if(Math.abs(diff)>1e-8)changedVertices++;
      maximumChange=Math.max(maximumChange,Math.abs(diff));
      maxCut=Math.max(maxCut,-diff);
      maxFill=Math.max(maxFill,diff);
      sumAbsolute+=Math.abs(diff);
      positions.push(x,newHeight,z);
    }
  }
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
    const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  const renderTerrain={positions,indices};
  const ground=(x,z)=>sampleTerrainGrid(renderTerrain,bounds,x,z);
  const total=(nx+1)*(nz+1);
  return {terrain:renderTerrain,ground,grid:bounds,stats:{
    method:'planar asphalt polygon boundary + local DEM transition + capped source discrepancy',
    terrainTriangles:indices.length/3,
    inputGrid:[grid.nx+1,grid.nz+1],
    outputGrid:[nx+1,nz+1],
    shoulderMeters,maxVerticalAdjustmentMeters,asphaltBoundarySegments:edges.length,
    footprintPolygons:footprint.polygons.length,
    pavementVertices,shoulderVertices,unchangedVertices,changedVertices,
    terrainUnchangedPct:unchangedVertices/total*100,
    profileDiscrepancyOverBudget,clampedVerticalVertices,
    maximumRoadProfileDiscrepancyMeters:maxProfileDiscrepancy,
    maximumActualAdjustmentMeters:maximumChange,
    maximumCutMeters:maxCut,maximumFillMeters:maxFill,
    meanAbsoluteHeightAdjustmentMeters:sumAbsolute/total,
    caveat:'A clamped footprint keeps original terrain close, but cannot guarantee visually flat roads on noisy DEM. No measured road grades are used.'
  }};
}
