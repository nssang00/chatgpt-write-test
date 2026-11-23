// EXPERIMENTAL visual-grade constraint for a terrain integrated with
// approximate OSM 2D road centerlines. This is not a surveyed road surface.
// Distinguishes the *height of the mesh* from contact: having asphalt exactly
// on a DEM does not mean the DEM has reasonable longitudinal/cross slopes.
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smoothstep=t=>t*t*(3-2*t);

export function constrainRoadbedMesh(positions,grid,profile,{
  maximumGrade=.12,projectionPasses=30,shoulderMeters=30
}={}){
  const {nx,nz,xmin,xmax,zmin,zmax}=grid;
  if(!(nx>1&&nz>1&&xmax>xmin&&zmax>zmin&&
      maximumGrade>0&&maximumGrade<.3&&
      Number.isInteger(projectionPasses)&&projectionPasses>=1&&projectionPasses<=150))
    throw Error('Invalid roadbed grade projection inputs');
  const stride=nx+1,N=stride*(nz+1),dx=(xmax-xmin)/nx,dz=(zmax-zmin)/nz;
  if(positions.length!==N*3)throw Error('Unexpected integrated terrain geometry');
  const core=new Uint8Array(N),fade=new Float64Array(N);
  const before=new Float64Array(N),values=new Float64Array(N);
  let coreCount=0,transitionCount=0;
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
    const k=j*stride+i,x=xmin+i*dx,z=zmin+j*dz;
    before[k]=values[k]=positions[k*3+1];
    const s=profile.sampleAt(x,z,'0||');
    if(!Number.isFinite(s.distance)||!Number.isFinite(s.halfWidth)||
       !(s.halfWidth>0))continue;
    // This is intentionally wider than the OSM-way buffer and corner-miter
    // cap, so triangles near the outside of a junction stay constrained.
    const inner=2.3*s.halfWidth+3.65;
    if(s.distance<=inner){
      core[k]=1;fade[k]=1;coreCount++;
    }else if(s.distance<inner+shoulderMeters){
      const t=(s.distance-inner)/shoulderMeters;
      fade[k]=1-smoothstep(clamp(t,0,1));
      transitionCount++;
    }
  }
  // Four undirected mesh edge families. The two diagonals are required:
  // a cardinal-only grade limit cannot bound the diagonal of the terrain
  // and road-mesh triangulation at intersections.
  const pairs=[],lengths=[];
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
    const k=j*stride+i;
    for(const [di,dj,d] of [[1,0,dx],[0,1,dz],[1,1,Math.hypot(dx,dz)],
      [-1,1,Math.hypot(dx,dz)]]){
      const ix=i+di,jz=j+dj;
      if(ix<0||ix>nx||jz<0||jz>nz)continue;
      const q=jz*stride+ix;
      if(core[k]&&core[q]){pairs.push(k,q);lengths.push(maximumGrade*d);}
    }
  }
  const grades=(v)=>{
    let max=0,over=0;
    for(let e=0;e<lengths.length;e++){
      const slope=Math.abs(v[pairs[2*e]]-v[pairs[2*e+1]])/
        (lengths[e]/maximumGrade);
      max=Math.max(max,slope);
      if(slope>maximumGrade+1e-8)over++;
    }
    return {max,over};
  };
  const incoming=grades(before);
  // Pairwise symmetric projection on |h_i-h_j| <= maxGrade*distance.
  // Each pair preserves its midpoint, avoiding arbitrary level drift.
  // Alternate traversal order to reduce Gauss-Seidel directional bias.
  for(let iteration=0;iteration<projectionPasses;iteration++){
    const reverse=iteration%2===1;
    for(let k=0;k<lengths.length;k++){
      const index=reverse?lengths.length-1-k:k;
      const a=pairs[2*index],b=pairs[2*index+1],limit=lengths[index];
      const difference=values[b]-values[a];
      const excess=Math.abs(difference)-limit;
      if(excess<=0)continue;
      const correction=Math.sign(difference)*excess*.5;
      values[a]+=correction;
      values[b]-=correction;
    }
  }
  const projected=grades(values);
  const correction=new Float64Array(N),initialCorrection=new Float64Array(N);
  let maxCoreAdjustment=0;
  for(let k=0;k<N;k++){
    if(core[k]){
      correction[k]=values[k]-before[k];
      maxCoreAdjustment=Math.max(maxCoreAdjustment,Math.abs(correction[k]));
    }
  }
  // Diffuse only the *correction* into a short shoulder. The original
  // heightfield is unchanged beyond the shoulder. This avoids a step at
  // the edge of the constrained road while protecting distant parcels.
  const diffusionPasses=35;
  for(let pass=0;pass<diffusionPasses;pass++){
    initialCorrection.set(correction);
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
      const k=j*stride+i;
      if(core[k]||fade[k]<=0)continue;
      let sum=0,n=0;
      for(const [di,dj] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const ix=i+di,jz=j+dj;
        if(ix<0||ix>nx||jz<0||jz>nz)continue;
        sum+=initialCorrection[jz*stride+ix];n++;
      }
      correction[k]=fade[k]*sum/n;
    }
  }
  let changed=0,maxCorrection=0,meanCorrection=0;
  for(let k=0;k<N;k++){
    const diff=correction[k];
    if(Math.abs(diff)>1e-8)changed++;
    maxCorrection=Math.max(maxCorrection,Math.abs(diff));
    meanCorrection+=Math.abs(diff);
    positions[k*3+1]=before[k]+diff;
  }
  const resultGrades=grades(positions.filter((_,i)=>i%3===1));
  return {
    method:'road-core 8-neighbor maximum-grade projection and finite-range correction diffusion; visual only',
    maximumGrade,projectionPasses,shoulderMeters,
    roadCoreVertices:coreCount,shoulderVertices:transitionCount,
    constrainedEdges:lengths.length,
    incomingCoreMaxGrade:incoming.max,
    incomingEdgesOverLimit:incoming.over,
    projectedCoreMaxGrade:projected.max,
    projectedEdgesOverLimit:projected.over,
    finalCoreMaxGrade:resultGrades.max,
    finalEdgesOverLimit:resultGrades.over,
    verticesChanged:changed,maxCorrectionMeters:maxCorrection,
    meanAbsoluteCorrectionMeters:meanCorrection/N,
    maximumCoreCorrectionMeters:maxCoreAdjustment,
    caveat:'No surveyed road grade input. More gradual mesh slopes may increase earthwork versus the same Terrarium DEM.'
  };
}
