// Experimental road-only vertical alignment. OSM carries centerlines, not
// survey-grade road elevations. Smooth longitudinal grades on the OSM graph;
// the same grade+OSM node shares one elevation at every connected junction.
// Sampling nearby centerline segments gives a level cross-section on straight
// roads, instead of independently draping left/right edges on the noisy DEM.
//
// This is a visual modelling experiment, NOT a civil-engineering road design.
// It must be paired with a terrain cut/fill solution if it penetrates the DEM.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function buildRoadElevationProfile(classified,ground,{step=6,maximumGrade=.12,
  smoothIterations=110,smoothAnchor=.025,cellSize=24}={}){
  if(!(step>0&&maximumGrade>0&&maximumGrade<1&&smoothIterations>0&&cellSize>0))
    throw Error('Invalid road profile configuration');
  const nodes=new Map(),edges=[];
  function node(key,x,z){
    let n=nodes.get(key);
    if(!n){
      const raw=ground(x,z);
      n={x,z,raw,y:raw,neighbors:new Set()};
      nodes.set(key,n);
    }
    return n;
  }
  for(const entry of classified){
    const {pts,grade,road}=entry;
    const width=Number(entry.width??road.width??8);
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i],b=pts[i+1];
      const d=distance(a,b);
      if(d<1e-5)continue;
      const count=Math.ceil(d/step);
      let last=null;
      for(let j=0;j<=count;j++){
        const t=j/count;
        const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
        // Artificial samples are unique per segment. Real OSM IDs are
        // shared *only* at the same bridge/tunnel/layer grade.
        const id=j===0?('osm:'+a.id):j===count?('osm:'+b.id):
          ('way:'+road.id+':'+i+':'+j);
        const n=node(grade+':'+id,x,z);
        if(last&&last!==n){
          const len=distance(last,n);
          edges.push({a:last,b:n,length:len,grade,width});
          last.neighbors.add(n);
          n.neighbors.add(last);
        }
        last=n;
      }
    }
  }
  const vertices=[...nodes.values()];
  // Graph Laplacian / Tikhonov smoothing with a weak raw DEM anchor.
  // Every shared intersection node is represented by exactly one vertex.
  for(let iteration=0;iteration<smoothIterations;iteration++){
    const next=new Float64Array(vertices.length);
    for(let k=0;k<vertices.length;k++){
      const n=vertices[k];
      if(!n.neighbors.size){next[k]=n.raw;continue;}
      let total=0;
      for(const q of n.neighbors)total+=q.y;
      next[k]=smoothAnchor*n.raw+(1-smoothAnchor)*(total/n.neighbors.size);
    }
    for(let k=0;k<vertices.length;k++)vertices[k].y=next[k];
  }
  // Exact graph Lipschitz projection: the infimum of slope-limited cones
  // from every node is maximumGrade-Lipschitz. The symmetric supremum is
  // also Lipschitz; their mean stays within the grade limit everywhere.
  // Unlike a fixed number of edge-relaxation sweeps, this converges in
  // O((vertices+edges) log vertices) even on dense real OSM junctions.
  for(let k=0;k<vertices.length;k++)vertices[k].index=k;
  function envelope(sign){
    const dist=vertices.map(n=>sign*n.y),heap=[];
    const push=(d,i)=>{
      let k=heap.length;heap.push([d,i]);
      while(k>0){
        const parent=(k-1)>>1;
        if(heap[parent][0]<=d)break;
        heap[k]=heap[parent];k=parent;
      }
      heap[k]=[d,i];
    };
    const pop=()=>{
      const top=heap[0],last=heap.pop();
      if(heap.length){
        let k=0;
        while((2*k+1)<heap.length){
          const left=2*k+1,right=left+1;
          const child=right<heap.length&&heap[right][0]<heap[left][0]?right:left;
          if(last[0]<=heap[child][0])break;
          heap[k]=heap[child];k=child;
        }
        heap[k]=last;
      }
      return top;
    };
    for(let k=0;k<dist.length;k++)push(dist[k],k);
    while(heap.length){
      const [d,i]=pop();
      if(d>dist[i]+1e-10)continue;
      const n=vertices[i];
      for(const q of n.neighbors){
        const next=d+maximumGrade*distance(n,q);
        if(next<dist[q.index]-1e-10){
          dist[q.index]=next;push(next,q.index);
        }
      }
    }
    return dist;
  }
  const upper=envelope(1),negLower=envelope(-1);
  for(let k=0;k<vertices.length;k++)
    vertices[k].y=(upper[k]-negLower[k])*.5;
  const buckets=new Map();
  const bucketKey=(ix,iz,grade)=>grade+':'+ix+':'+iz;
  // Store every segment into all buckets overlapping its lateral corridor.
  // Avoid scanning all OSM roads per triangulated road vertex.
  const margin=95; // includes road half-width, miter and a broad cut/fill transition
  for(const e of edges){
    const i0=Math.floor((Math.min(e.a.x,e.b.x)-margin)/cellSize);
    const i1=Math.floor((Math.max(e.a.x,e.b.x)+margin)/cellSize);
    const j0=Math.floor((Math.min(e.a.z,e.b.z)-margin)/cellSize);
    const j1=Math.floor((Math.max(e.a.z,e.b.z)+margin)/cellSize);
    for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){
      const k=bucketKey(i,j,e.grade);
      if(!buckets.has(k))buckets.set(k,[]);
      buckets.get(k).push(e);
    }
  }
  const cache=new Map();
  let cacheMiss=0,unmatched=0;
  function sampleAt(x,z,grade){
    const key=grade+':'+Math.round(x*1e4)+':'+Math.round(z*1e4);
    if(cache.has(key))return cache.get(key);
    const candidates=buckets.get(bucketKey(Math.floor(x/cellSize),Math.floor(z/cellSize),grade))||[];
    const nearby=[];
    let minDistance=Infinity,nearestWidth=0;
    for(const e of candidates){
      const dx=e.b.x-e.a.x,dz=e.b.z-e.a.z;
      const t=clamp(((x-e.a.x)*dx+(z-e.a.z)*dz)/(e.length*e.length),0,1);
      const px=e.a.x+t*dx,pz=e.a.z+t*dz;
      const d=Math.hypot(x-px,z-pz);
      if(d<minDistance){minDistance=d;nearestWidth=e.width;}
      nearby.push([d,e.a.y+t*(e.b.y-e.a.y)]);
    }
    let height;
    if(!nearby.length){
      height=ground(x,z);unmatched++;
    }else{
      let weighted=0,sum=0;
      for(const [d,y] of nearby){
        if(d>minDistance+2.5)continue;
        const w=1/Math.pow(.75+d,2);
        weighted+=w*y;sum+=w;
      }
      height=weighted/sum;
    }
    const result={height,distance:minDistance,halfWidth:nearestWidth/2};
    cacheMiss++;
    cache.set(key,result);
    return result;
  }
  function heightAt(x,z,grade){return sampleAt(x,z,grade).height;}
  let rawMaxGrade=0,maxResultGrade=0,maxChange=0;
  for(const e of edges){
    rawMaxGrade=Math.max(rawMaxGrade,Math.abs(e.b.raw-e.a.raw)/e.length);
    maxResultGrade=Math.max(maxResultGrade,Math.abs(e.b.y-e.a.y)/e.length);
  }
  for(const n of vertices)maxChange=Math.max(maxChange,Math.abs(n.y-n.raw));
  return {
    heightAt,
    sampleAt,
    segments:edges,
    vertices,
    stats:()=>({nodeCount:vertices.length,segmentCount:edges.length,
      rawMaxGrade,smoothedMaxGrade:maxResultGrade,maxElevationAdjustment:maxChange,
      maximumGrade,cacheQueries:cacheMiss,unmatchedSamples:unmatched})
  };
}
