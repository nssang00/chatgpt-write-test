// Experimental road-only DEM visibility mask, not surveyed cut/fill.
// Exact polygon boolean subtraction with a thousand touching coplanar
// road triangles was numerically unstable. Instead, split only the DEM
// triangles occupied by roads into a regular 8x8 subtriangle grid, and
// omit patches whose centroids fall within the road-edge footprint.
// This is sub-metre-to-metre approximate clipping; real terrain-road
// grade/retaining walls and accurate junction polygons remain future work.
const area2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const middle=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
const pointInside=(x,z,a,b,c)=>{
  const s0=(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]);
  const s1=(c[0]-b[0])*(z-b[1])-(c[1]-b[1])*(x-b[0]);
  const s2=(a[0]-c[0])*(z-c[1])-(a[1]-c[1])*(x-c[0]);
  return (s0>=-1e-7&&s1>=-1e-7&&s2>=-1e-7)||
    (s0<=1e-7&&s1<=1e-7&&s2<=1e-7);
};
export function cutTerrainUnderRoads(terrain,maskTriangles,grid,ground,{subdivisions=3}={}){
  const {xmin,zmin,xmax,zmax,nx,nz}=grid;
  if(!maskTriangles?.length)throw Error('Road masking needs at-grade road-edge triangles');
  if(!(Number.isInteger(subdivisions)&&subdivisions>=1&&subdivisions<=5))
    throw Error('Invalid terrain road-mask subdivisions');
  const dx=(xmax-xmin)/nx,dz=(zmax-zmin)/nz;
  const masks=new Map();
  for(const tri of maskTriangles){
    if(Math.abs(area2(...tri))<1e-9)continue;
    const x=(tri[0][0]+tri[1][0]+tri[2][0])/3;
    const z=(tri[0][1]+tri[1][1]+tri[2][1])/3;
    const u=Math.max(0,Math.min(nx-1e-8,(x-xmin)/dx));
    const v=Math.max(0,Math.min(nz-1e-8,(z-zmin)/dz));
    const i=Math.floor(u),j=Math.floor(v);
    const side=(u-i+v-j)<=1?0:1;
    const id=(j*nx+i)*2+side;
    if(!masks.has(id))masks.set(id,[]);
    masks.get(id).push({
      tri,
      xmin:Math.min(...tri.map(p=>p[0])),
      xmax:Math.max(...tri.map(p=>p[0])),
      zmin:Math.min(...tri.map(p=>p[1])),
      zmax:Math.max(...tri.map(p=>p[1]))
    });
  }
  const mesh={positions:[],indices:[]};
  let affected=0,removed=0,appended=0,discarded=0;
  function append(a,b,c){
    if(Math.abs(area2(a,b,c))<1e-10){discarded++;return;}
    const n=mesh.positions.length/3;
    for(const [x,z] of [a,b,c])mesh.positions.push(x,ground(x,z),z);
    mesh.indices.push(n,n+1,n+2);
    appended++;
  }
  function process(a,b,c,depth,candidates){
    const minX=Math.min(a[0],b[0],c[0]),maxX=Math.max(a[0],b[0],c[0]);
    const minZ=Math.min(a[1],b[1],c[1]),maxZ=Math.max(a[1],b[1],c[1]);
    const nearby=candidates.filter(q=>q.xmax>=minX&&q.xmin<=maxX&&q.zmax>=minZ&&q.zmin<=maxZ);
    if(!nearby.length){append(a,b,c);return;}
    if(!depth){
      const x=(a[0]+b[0]+c[0])/3,z=(a[1]+b[1]+c[1])/3;
      if(nearby.some(q=>pointInside(x,z,...q.tri))){removed++;return;}
      append(a,b,c);return;
    }
    const ab=middle(a,b),bc=middle(b,c),ca=middle(c,a);
    process(a,ab,ca,depth-1,nearby);
    process(ab,b,bc,depth-1,nearby);
    process(ca,bc,c,depth-1,nearby);
    process(ab,bc,ca,depth-1,nearby);
  }
  const v=terrain.positions,indices=terrain.indices;
  if(indices.length!==nx*nz*6)
    throw Error('Source terrain must be original 2-triangle-per-cell grid');
  for(let triId=0;triId<indices.length/3;triId++){
    const p=[0,1,2].map(k=>{
      const n=indices[triId*3+k]*3;
      return [v[n],v[n+2]];
    });
    const candidates=masks.get(triId);
    if(!candidates?.length){append(...p);continue;}
    affected++;
    process(p[0],p[1],p[2],subdivisions,candidates);
  }
  return {terrain:mesh,stats:{
    sourceTriangles:indices.length/3,
    maskedRoadTriangles:maskTriangles.length,
    affectedTerrainTriangles:affected,
    outputTriangles:appended,removedSubtriangles:removed,
    maskResolution:'3 recursive splits (~1.5-2m for 13m DEM cells); approximate',
    discarded,clipFailures:0
  }};
}
