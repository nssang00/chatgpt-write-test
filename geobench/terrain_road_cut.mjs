import polygonClipping from 'polygon-clipping';
import earcut from 'earcut';

// Experimental earthwork visibility pass: remove the rendered DEM surface
// *under* each at-grade polygon-unioned road edge, leaving road tiles visible
// even when the road elevation is below noisy Terrarium. This is strictly
// terrain subtraction, not a surveyed cut/fill/retaining-wall model.
// Road triangles are already clipped to each exact DEM triangle by the
// terrain_triangle_clip module; group their XY projections by source DEM
// triangle and subtract them only from that triangle.
const triArea2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const safeClosed=pts=>{
  const r=[];
  for(const p of pts)if(!r.length||Math.hypot(p[0]-r.at(-1)[0],p[1]-r.at(-1)[1])>1e-7)
    r.push(p);
  if(r.length<3)return null;
  if(Math.abs(triArea2(r[0],r[1],r[2]))<1e-9)return null;
  return [...r,r[0]];
};
export function cutTerrainUnderRoads(terrain,maskTriangles,grid,ground){
  const {xmin,zmin,xmax,zmax,nx,nz}=grid;
  if(!maskTriangles?.length)throw Error('Road masking needs at-grade road-edge triangles');
  const dx=(xmax-xmin)/nx,dz=(zmax-zmin)/nz;
  const masks=new Map();
  for(const raw of maskTriangles){
    const a=raw[0],b=raw[1],c=raw[2];
    const triangle=safeClosed([a,b,c]);
    if(!triangle)continue;
    const x=(a[0]+b[0]+c[0])/3,z=(a[1]+b[1]+c[1])/3;
    const u=Math.max(0,Math.min(nx-1e-8,(x-xmin)/dx));
    const v=Math.max(0,Math.min(nz-1e-8,(z-zmin)/dz));
    const i=Math.floor(u),j=Math.floor(v);
    const side=(u-i+v-j)<=1?0:1;
    const id=(j*nx+i)*2+side;
    const list=masks.get(id)||[];
    list.push([triangle]); // a polygon is an array of rings
    masks.set(id,list);
  }
  const mesh={positions:[],indices:[]};
  let clippedTriangles=0,clipFailures=0,outputTriangles=0,discarded=0;
  const append=(a,b,c)=>{
    if(Math.abs(triArea2(a,b,c))<1e-9){discarded++;return;}
    const n=mesh.positions.length/3;
    for(const [x,z] of [a,b,c])mesh.positions.push(x,ground(x,z),z);
    mesh.indices.push(n,n+1,n+2);
    outputTriangles++;
  };
  const v=terrain.positions,indices=terrain.indices;
  if(indices.length!==nx*nz*6)
    throw Error('Source terrain must be original 2-triangle-per-grid-cell mesh');
  for(let triId=0;triId<indices.length/3;triId++){
    const p=[0,1,2].map(k=>{
      const offset=indices[triId*3+k]*3;
      return [v[offset],v[offset+2]];
    });
    const list=masks.get(triId);
    if(!list?.length){
      append(...p);continue;
    }
    clippedTriangles++;
    const subject=safeClosed(p);
    if(!subject)continue;
    let result;
    try{
      // polygon-clipping accepts a polygon subject and a MultiPolygon clip.
      result=polygonClipping.difference([subject],list);
    }catch(e){
      clipFailures++;
      throw Error('Terrain road-hole subtraction failed at DEM triangle '+triId+': '+e);
    }
    for(const polygon of result){
      const points=[],holes=[];
      let offset=0;
      for(let i=0;i<polygon.length;i++){
        if(i>0)holes.push(offset);
        for(const point of polygon[i].slice(0,-1)){points.push(point[0],point[1]);offset++;}
      }
      if(points.length<6)continue;
      const tris=earcut(points,holes,2);
      for(let k=0;k<tris.length;k+=3){
        const xy=i=>[points[2*tris[i]],points[2*tris[i]+1]];
        append(xy(k),xy(k+1),xy(k+2));
      }
    }
  }
  return {terrain:mesh,stats:{sourceTriangles:indices.length/3,
    maskedRoadTriangles:maskTriangles.length,affectedTerrainTriangles:clippedTriangles,
    outputTriangles,discarded,clipFailures}};
}
