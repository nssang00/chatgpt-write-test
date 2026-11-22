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
// Preserve 2D plan geometry separately from terrain-aligned triangulation.
// This lets us remove the asphalt footprint from the road-edge strip rather
// than drawing a second large overlapping grey asphalt-shaped polygon.
export function unionRoadPolygons(entries,stats=null){
  const grouped=new Map();
  for(const item of entries){
    const r=ring(item.points);
    if(!r||polygonArea(r)<.01){
      if(stats)stats.discardedRoadRings=(stats.discardedRoadRings||0)+1;
      continue;
    }
    const items=grouped.get(item.grade)||[];
    items.push([r]);grouped.set(item.grade,items);
  }
  const output=[];
  for(const [grade,polygons] of grouped){
    let merged;
    try{merged=pc.union(...polygons);}
    catch(e){throw Error('Road union failed grade='+grade+' polygons='+polygons.length+' '+String(e));}
    for(const rings of merged)output.push({grade,rings});
  }
  if(stats){
    stats.roadPolygonInput=(stats.roadPolygonInput||0)+entries.length;
    stats.roadPlanarUnions=(stats.roadPlanarUnions||0)+1;
  }
  return output;
}
export function roadPolygonArea(polygons){
  let sum=0;
  for(const {rings} of polygons){
    if(!rings.length)continue;
    sum+=polygonArea(rings[0]);
    for(const hole of rings.slice(1))sum-=polygonArea(hole);
  }
  return sum;
}
export function subtractRoadPolygons(outer,inner,stats=null){
  const innerByGrade=new Map();
  for(const item of inner){
    const list=innerByGrade.get(item.grade)||[];
    list.push(item.rings);innerByGrade.set(item.grade,list);
  }
  const outerByGrade=new Map();
  for(const item of outer){
    const list=outerByGrade.get(item.grade)||[];
    list.push(item.rings);outerByGrade.set(item.grade,list);
  }
  const result=[];
  for(const [grade,polys] of outerByGrade){
    const cuts=innerByGrade.get(grade)||[];
    let differences;
    try{differences=cuts.length?pc.difference(polys,cuts):polys;}
    catch(e){throw Error('Road-edge difference failed grade='+grade+' '+String(e));}
    for(const rings of differences)result.push({grade,rings});
  }
  if(stats){
    stats.roadEdgeOuterAreaM2=roadPolygonArea(outer);
    stats.roadAsphaltAreaM2=roadPolygonArea(inner);
    stats.roadEdgeVisibleAreaM2=roadPolygonArea(result);
    stats.roadEdgeOverlapRemovedM2=stats.roadEdgeOuterAreaM2-stats.roadEdgeVisibleAreaM2;
    stats.roadEdgeDifferencePolygons=result.length;
  }
  return result;
}
export function mergedRoadSurface(entries,ground,elevation,stats,terrainGrid=null,roadHeight=null,atGradeMask=null,gradeRanges=null,premerged=null){
  const mesh={positions:[],indices:[]};
  const unionPolygons=premerged??unionRoadPolygons(entries,stats);
  stats.mergedRoadPolygons=(stats.mergedRoadPolygons||0)+unionPolygons.length;
  for(const item of unionPolygons){
    const firstTriangle=mesh.indices.length/3;
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
          if(addTriangle(mesh,u,v,w,sampledHeight,elevation)){
            stats.terrainAlignedTriangles=(stats.terrainAlignedTriangles||0)+1;
            if(atGradeMask&&item.grade==='0||')atGradeMask.push([u,v,w]);
          }
        });
      }else{
        if(addTriangle(mesh,a,b,c,sampledHeight,elevation)&&atGradeMask&&item.grade==='0||')
          atGradeMask.push([a,b,c]);
      }
    }
    if(gradeRanges&&mesh.indices.length/3>firstTriangle)
      gradeRanges.push({grade:item.grade,from:firstTriangle,to:mesh.indices.length/3});
  }
  if(!mesh.indices.length&&entries.length)throw Error('No valid triangles from road polygon union');
  return mesh;
}
