// Round the *outside* of a centerline bend instead of extending a long
// mitered wedge into adjoining carriageways. Keep the inside join as the
// intersection of its offset lines, capped for near-reversals.
// A continuous 2D polygon is emitted for each OSM way, ready for per-grade
// polygon union. Real surveyed road boundaries are NOT supplied by OSM.
const PI=Math.PI;
const dist=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);
const normal=(a,b)=>{
  const dx=b.x-a.x,dz=b.z-a.z,n=Math.hypot(dx,dz);
  return n>1e-8?[dz/n,-dx/n]:[0,0];
};
function push(points,p){
  if(!points.length||dist(points.at(-1),p)>1e-6)points.push(p);
}
function miter(p,prev,next,half,side,limit,stats){
  const n0=normal(prev,p),n1=normal(p,next);
  const mx=side*(n0[0]+n1[0]),mz=side*(n0[1]+n1[1]);
  const mag=Math.hypot(mx,mz);
  if(mag<.07){ // near hairpin: avoid infinite intersection
    stats.reversalJoins++;
    return {x:p.x+n1[0]*side*half,z:p.z+n1[1]*side*half};
  }
  const ux=mx/mag,uz=mz/mag;
  const dot=ux*n1[0]*side+uz*n1[1]*side;
  const unbounded=half/Math.max(.04,dot);
  const length=Math.min(limit*half,unbounded);
  if(unbounded>limit*half)stats.bevelLimitedJoins++;
  return {x:p.x+ux*length,z:p.z+uz*length};
}
function arc(points,p,from,to,half,turn,maxAngle,stats){
  // The signed centerline turn is the same as the outer normal rotation.
  const a0=Math.atan2(from[1],from[0]);
  const a1=Math.atan2(to[1],to[0]);
  let delta=a1-a0;
  if(turn>0){while(delta<0)delta+=2*PI;}
  else{while(delta>0)delta-=2*PI;}
  // A near-U-turn can produce a folded corridor ring. Prefer short bevels.
  if(Math.abs(delta)>PI-.07){
    push(points,{x:p.x+from[0]*half,z:p.z+from[1]*half});
    push(points,{x:p.x+to[0]*half,z:p.z+to[1]*half});
    stats.bevelLimitedJoins++;
    return;
  }
  const count=Math.max(2,Math.ceil(Math.abs(delta)/maxAngle));
  for(let j=0;j<=count;j++){
    const angle=a0+delta*j/count;
    push(points,{x:p.x+Math.cos(angle)*half,z:p.z+Math.sin(angle)*half});
  }
  stats.roundedJoins++;
  stats.arcVertices+=count+1;
}
export function roundedCorridor(path,half,stats,{angleStep=PI/12,insideMiterLimit=1.45}={}){
  if(path.length<2||half<=0)throw Error('Invalid rounded corridor');
  if(!(angleStep>0&&angleStep<PI/2&&insideMiterLimit>=1))
    throw Error('Invalid corridor join settings');
  const right=[],left=[];
  const startNormal=normal(path[0],path[1]);
  const finishNormal=normal(path.at(-2),path.at(-1));
  push(right,{x:path[0].x+startNormal[0]*half,z:path[0].z+startNormal[1]*half});
  push(left,{x:path[0].x-startNormal[0]*half,z:path[0].z-startNormal[1]*half});
  for(let i=1;i<path.length-1;i++){
    const p=path[i],prev=path[i-1],next=path[i+1];
    const inX=p.x-prev.x,inZ=p.z-prev.z;
    const outX=next.x-p.x,outZ=next.z-p.z;
    const cross=inX*outZ-inZ*outX;
    const angle=Math.atan2(cross,inX*outX+inZ*outZ);
    const n0=normal(prev,p),n1=normal(p,next);
    stats.joinVertices++;
    if(Math.abs(angle)<.12){
      push(right,miter(p,prev,next,half,+1,insideMiterLimit,stats));
      push(left,miter(p,prev,next,half,-1,insideMiterLimit,stats));
    }else if(angle>0){
      arc(right,p,n0,n1,half,+1,angleStep,stats);
      push(left,miter(p,prev,next,half,-1,insideMiterLimit,stats));
    }else{
      push(right,miter(p,prev,next,half,+1,insideMiterLimit,stats));
      arc(left,p,[-n0[0],-n0[1]],[-n1[0],-n1[1]],half,-1,angleStep,stats);
    }
  }
  const end=path.at(-1);
  push(right,{x:end.x+finishNormal[0]*half,z:end.z+finishNormal[1]*half});
  push(left,{x:end.x-finishNormal[0]*half,z:end.z-finishNormal[1]*half});
  const poly=[...right,...left.reverse()];
  if(poly.length<4)throw Error('Degenerate rounded corridor');
  return poly;
}
