// Visualization-only fallback when a REAL bare-earth DTM is unavailable.
// The raw AWS/Mapzen Terrarium surface in Seoul contains false-looking urban
// spikes: adjacent DEM samples can differ by > 30 m over ~ 14 m. Rendering
// those as ground and draping roads onto them creates vertical road shards.
// This robustly estimates a plausible ground: 9x9 local median (rejecting
// narrow roofs/spikes) + Gaussian blend + a bounded adjacent slope projection.
//
// This is NOT a national ground elevation data product or a replacement for
// verified NGII bare-earth DTM. Preserve elevation provenance and diagnostics.
// Do not apply this filter to genuine NGII DTM inputs.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function percentile(values,q){
  const sorted=values.toSorted((a,b)=>a-b);
  if(!sorted.length)return 0;
  return sorted[Math.min(sorted.length-1,Math.floor(q*(sorted.length-1)))];
}
export function gridGradeStats(data,nx,nz,stepX,stepZ){
  const values=[];
  let maxStep=0,over35=0,over100=0;
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
    const a=data[j*nx+i];
    for(const [t,step] of [
      [i+1<nx?data[j*nx+i+1]:undefined,stepX],
      [j+1<nz?data[(j+1)*nx+i]:undefined,stepZ]
    ]){
      if(t===undefined)continue;
      const d=Math.abs(t-a);
      maxStep=Math.max(maxStep,d);
      const g=d/step;
      values.push(g);
      if(g>.35)over35++;
      if(g>1)over100++;
    }
  }
  return {
    maxAdjacentGrade:Math.max(...values),
    p99AdjacentGrade:percentile(values,.99),
    edgesAbove35Percent:over35,edgesAbove100Percent:over100,
    maxAdjacentHeightStepMeters:maxStep,edgeCount:values.length
  };
}
export function urbanTerrainRepair(input,nx,nz,stepX,stepZ,opts={}){
  const radius=opts.medianRadius??4; // 9x9 samples ~= 110x125m around Seoul
  const sigma=opts.gaussianSigma??2.0;
  const maxGrade=opts.maxGrade??.25; // plausible urban map (not surveyed)
  const maxRelaxPasses=opts.maxRelaxPasses??350;
  if(nx*nz!==input.length || nx<3 || nz<3)throw Error('Invalid terrain grid');
  if(!(stepX>0&&stepZ>0&&sigma>0&&maxGrade>0))throw Error('Invalid terrain grid spacings/filter');
  const raw=Float64Array.from(input);
  if(raw.some(x=>!Number.isFinite(x)))throw Error('Nonfinite raw DEM');
  const before=gridGradeStats(raw,nx,nz,stepX,stepZ);
  const med=new Float64Array(raw.length);
  const sample=(data,x,z)=>data[clamp(z,0,nz-1)*nx+clamp(x,0,nx-1)];
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const box=[];
    for(let dz=-radius;dz<=radius;dz++)
      for(let dx=-radius;dx<=radius;dx++)
        box.push(sample(raw,x+dx,z+dz));
    box.sort((a,b)=>a-b);
    med[z*nx+x]=box[Math.floor(box.length/2)];
  }
  const kernelRadius=Math.ceil(3*sigma);
  const weights=Array.from({length:kernelRadius*2+1},(_,i)=>{
    const delta=i-kernelRadius;
    return Math.exp(-.5*delta*delta/(sigma*sigma));
  });
  const sum=weights.reduce((a,b)=>a+b,0);
  for(let k=0;k<weights.length;k++)weights[k]/=sum;
  const smoothPass=(src,axis)=>{
    const next=new Float64Array(src.length);
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      let h=0;
      for(let k=-kernelRadius;k<=kernelRadius;k++){
        h+=weights[k+kernelRadius]*sample(src,
          axis==='x'?x+k:x,
          axis==='z'?z+k:z);
      }
      next[z*nx+x]=h;
    }
    return next;
  };
  const smooth=smoothPass(smoothPass(med,'x'),'z');
  const target=Float64Array.from(smooth);
  const capX=maxGrade*stepX,capZ=maxGrade*stepZ;
  let passes=0;
  // Repeated pair projection. A small residual tolerance allows early exit.
  for(let p=0;p<maxRelaxPasses;p++){
    passes++;
    let excess=0;
    for(let z=0;z<nz;z++)for(let x=0;x<nx-1;x++){
      const a=z*nx+x,b=a+1;
      const diff=target[a]-target[b];
      if(Math.abs(diff)>capX){
        const over=Math.abs(diff)-capX;
        const adjust=Math.sign(diff)*over*.5;
        target[a]-=adjust;target[b]+=adjust;
        excess=Math.max(excess,over);
      }
    }
    for(let z=0;z<nz-1;z++)for(let x=0;x<nx;x++){
      const a=z*nx+x,b=a+nx;
      const diff=target[a]-target[b];
      if(Math.abs(diff)>capZ){
        const over=Math.abs(diff)-capZ;
        const adjust=Math.sign(diff)*over*.5;
        target[a]-=adjust;target[b]+=adjust;
        excess=Math.max(excess,over);
      }
    }
    if(excess<1e-4)break;
  }
  const after=gridGradeStats(target,nx,nz,stepX,stepZ);
  if(after.maxAdjacentGrade>maxGrade+.002){
    throw Error('Terrain slope limiter did not converge: '+JSON.stringify({after,passes}));
  }
  const changes=Array.from(target,(v,i)=>Math.abs(v-raw[i]));
  return {heights:target,diagnostics:{
    method:'median9 Gaussian sigma2 + bounded-grade projection',
    isSurveyedBareEarth:false,
    visualizationOnly:true,
    medianSamples:(radius*2+1)**2,gaussianSigmaSamples:sigma,
    maxTargetGrade:maxGrade,iterations:passes,
    changedSamplesOver2m:changes.filter(v=>v>2).length,
    correctionMedianMeters:percentile(changes,.5),
    correctionP95Meters:percentile(changes,.95),
    correctionMaxMeters:Math.max(...changes),
    original:before,repaired:after
  }};
}
