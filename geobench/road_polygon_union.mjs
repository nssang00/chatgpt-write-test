import pc from 'polygon-clipping';
import earcut from 'earcut';
import { emitTerrainAlignedTriangle } from './terrain_triangle_clip.mjs';

// Validated planar polygon union (per OSM grade) to avoid overlapping road
// strip triangles, disc junction patches, and stretched/overlapping joins.
// Source polygons already contain sampled <=6m boundaries.
const small=1e-5;
const q=v=>Math.round(v*10000)/10000;
function ring(points){
  const out=[];
  for(const p of points){
    const c=[q(p.x),q(p.z)];
    if(!out.length||Math.hypot(c[0]-out.at(-1)[0],c[1]-out.at(-1)[1])>.0005)out.push(c);
  }
  if(out.length>2&&Math.hypot(out[0][0]-out.at(-1)[0],out[0][1]-out.at(-1)[1])>.0005)out.push([...out[0]]);
  return out.length>=4?out:null;
}
function polygonArea(points){
  let sum=0;
  for(let i=0;i<points.length-1;i++)sum+=points[i][0]*points[i+1][1]-points[i+1][0]*points[i][1];
  return Math.abs(sum)*.5;
}
function addTriangle(mesh,a,b,c,sampledHeight,elevation){
  const cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if(Math.abs(cross)<small)return false;
  const offset=mesh.positions.length/3;
  for(const [x,z] of [a,b,c])mesh.positions.push(x,sampledHeight(x,z)+elevation,z);
  mesh.indices.push(offset,offset+1,offset+2);
  return true;
}
export function mergedRoadSurface(entries,ground,elevation,stats,terrainGrid=null,roadHeight=null){
  const mesh={positions:[],indices:[]};
  const grouped=new Map();
  for(const item of entries){
    const r=ring(item.points);
    if(!r||polygonArea(r)<.01){stats.discardedRoadRings++;continue;}
    const items=grouped.get(item.grade)||[];
    items.push([r]);grouped.set(item.grade,items);
  }
  stats.roadPolygonInput=entries.length;
  const unionPolygons=[];
  for(const [grade,polygons] of grouped){
    // Unary polygon union is performed per grade: a tunnel is never silently
    // connected to surface ways, even if geometrically overlapping.
    let geometry=[];
    try{
      // Grouping by layer keeps one large union from mixing grade separation.
      geometry=pc.union(...polygons);
    }catch(err){
      throw Error('Road union failed at grade='+grade+' polygons='+polygons.length+
        ' '+String(err));
    }
    for(const poly of geometry)unionPolygons.push({grade,rings:poly});
  }
  stats.mergedRoadPolygons=unionPolygons.length;
  for(const item of unionPolygons){
    const sampledHeight=roadHeight?((x,z)=>roadHeight(x,z,item.grade)):ground;
    const flat=[],holes=[];
    let index=0;
    for(let r=0;r<item.rings.length;r++){
      const loop=item.rings[r];
      if(r>0)holes.push(index);
      // Last vertex is repeated first vertex in polygon-clipping output.
      for(const p of loop.slice(0,-1)){flat.push(p[0],p[1]);index++;}
    }
    if(flat.length<6)continue;
    const triangles=earcut(flat,holes,2);
    for(let i=0;i<triangles.length;i+=3){
      const indexToPt=k=>[flat[k*2],flat[k*2+1]];
      const a=indexToPt(triangles[i]);
      const b=indexToPt(triangles[i+1]);
      const c=indexToPt(triangles[i+2]);
      if(terrainGrid){
        // Union/earcut can make 500m road triangles. Matching only the three
        // vertex heights lets those planes cut through real terrain between
        // vertices. Split at *both* terrain grid diagonals and cell edges.
        // A 2D polygon outside the DEM bbox is clipped at its boundary.
        emitTerrainAlignedTriangle(a,b,c,terrainGrid,(u,v,w)=>{
          if(addTriangle(mesh,u,v,w,sampledHeight,elevation))
            stats.terrainAlignedTriangles=(stats.terrainAlignedTriangles||0)+1;
        });
      }else{
        addTriangle(mesh,a,b,c,sampledHeight,elevation);
      }
    }
  }
  if(!mesh.indices.length&&entries.length)throw Error('No valid triangles from road polygon union');
  return mesh;
}
