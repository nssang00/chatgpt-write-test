// Shared topological OSM road mesher for four engines and Cesium 3D Tiles.
// Uses actual OSM node IDs, continuous bounded-miter joins and ground-draped
// triangles, including roads crossing the region boundary.
// OSM bridges/tunnels/layers are never connected into an at-grade junction.
// Their accurate 3D bridge/underground elevations require separate data.
const EPS=1e-6;
const length=(x,z)=>Math.hypot(x,z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const near=(a,b,tol=1e-4)=>Math.hypot(a.x-b.x,a.z-b.z)<tol;
const sameLevel=tags=>{
  const bridge=tags.bridge&&tags.bridge!=='no';
  const tunnel=tags.tunnel&&tags.tunnel!=='no';
  const layer=Number.parseInt(tags.layer||'0',10)||0;
  return String(layer)+'|'+(bridge?'bridge':'')+'|'+(tunnel?'tunnel':'');
};
const flatMesh=()=>({positions:[],indices:[]});
function addTriangle(mesh,a,b,c){
  const offset=mesh.positions.length/3;
  mesh.positions.push(...a,...b,...c);
  mesh.indices.push(offset,offset+1,offset+2);
}
function addQuad(mesh,a,b,c,d){
  const offset=mesh.positions.length/3;
  mesh.positions.push(...a,...b,...c,...d);
  mesh.indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
}
function clip(a,b,bounds){
  const [xmin,zmin,xmax,zmax]=bounds;
  let t0=0,t1=1;
  const dx=b.x-a.x,dz=b.z-a.z;
  for(const [p,q] of [[-dx,a.x-xmin],[dx,xmax-a.x],[-dz,a.z-zmin],[dz,zmax-a.z]]){
    if(Math.abs(p)<EPS){
      if(q<0)return null;
    }else{
      const t=q/p;
      if(p<0)t0=Math.max(t0,t);
      else t1=Math.min(t1,t);
      if(t0>t1)return null;
    }
  }
  const point=t=>({x:mix(a.x,b.x,t),z:mix(a.z,b.z,t),
    id:t<EPS?a.id:t>1-EPS?b.id:null});
  return [point(t0),point(t1)];
}
function cleaned(pts){
  const result=[];
  for(const p of pts){
    if(!result.length||!near(result.at(-1),p))result.push(p);
  }
  return result;
}
function subdivide(path,maxStep){
  const out=[path[0]];
  for(let i=0;i<path.length-1;i++){
    const a=path[i],b=path[i+1],d=length(b.x-a.x,b.z-a.z);
    const n=Math.max(1,Math.ceil(d/maxStep));
    for(let j=1;j<=n;j++){
      const t=j/n;
      out.push(j===n?b:{x:mix(a.x,b.x,t),z:mix(a.z,b.z,t),id:null});
    }
  }
  return cleaned(out);
}
function normal(a,b){
  const dx=b.x-a.x,dz=b.z-a.z,d=length(dx,dz);
  if(d<EPS)return [0,0];
  return [dz/d,-dx/d];
}
function joinedEdge(pts,i,half,metric){
  const p=pts[i];
  if(i===0||i===pts.length-1){
    const n=i===0?normal(pts[0],pts[1]):normal(pts[i-1],pts[i]);
    return {r:{x:p.x+n[0]*half,z:p.z+n[1]*half},
      l:{x:p.x-n[0]*half,z:p.z-n[1]*half}};
  }
  const before=normal(pts[i-1],p),after=normal(p,pts[i+1]);
  const mx=before[0]+after[0],mz=before[1]+after[1],len=length(mx,mz);
  let direction,scale;
  if(len<.12){
    direction=after;scale=half;metric.reversalJoins++;
  }else{
    direction=[mx/len,mz/len];
    const dot=direction[0]*after[0]+direction[1]*after[1];
    const miter=half/Math.max(.05,dot);
    scale=Math.min(2.3*half,miter);
    if(miter>2.3*half)metric.bevelLimitedJoins++;
  }
  metric.joinVertices++;
  return {r:{x:p.x+direction[0]*scale,z:p.z+direction[1]*scale},
    l:{x:p.x-direction[0]*scale,z:p.z-direction[1]*scale}};
}
function parseRoad(road,project){
  const refs=road.refs||[];
  const ids=road.nodeIds||[];
  return refs.map((p,i)=>{
    const coords=project(...p);
    return {x:coords[0],z:coords[1],id:String(ids[i]??(road.id+'-'+i))};
  });
}
function clipPolyline(points,bounds){
  const paths=[];let path=[];
  const flush=()=>{if(path.length>=2)paths.push(cleaned(path));path=[]};
  for(let i=0;i<points.length-1;i++){
    const cut=clip(points[i],points[i+1],bounds);
    if(!cut){flush();continue}
    if(!path.length)path.push(cut[0]);
    else if(!near(path.at(-1),cut[0])){flush();path.push(cut[0])}
    path.push(cut[1]);
    if(!near(cut[1],points[i+1]))flush();
  }
  flush();
  return paths.filter(p=>p.length>=2);
}
// 2D convex hull of incident road corridor edges. This replaces the
// previous round disks, whose wide bulges looked like huge road blobs.
function convexHull(points){
  const pts=points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.z))
    .toSorted((a,b)=>a.x-b.x||a.z-b.z);
  const cross=(o,a,b)=>(a.x-o.x)*(b.z-o.z)-(a.z-o.z)*(b.x-o.x);
  const lower=[],upper=[];
  for(const p of pts){
    while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=1e-7)lower.pop();
    lower.push(p);
  }
  for(let k=pts.length-1;k>=0;k--){
    const p=pts[k];
    while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=1e-7)upper.pop();
    upper.push(p);
  }
  lower.pop();upper.pop();
  return lower.concat(upper);
}
function patchPolygon(mesh,junction,extraWidth,heightFn){
  const points=[];
  const maxHalf=Math.max(...junction.widths)/2;
  const reach=Math.min(maxHalf+2.5,14);
  for(const neighbor of junction.neighbors.values()){
    const d=length(neighbor.dx,neighbor.dz);
    if(d<EPS)continue;
    const ux=neighbor.dx/d,uz=neighbor.dz/d;
    const nx=uz,nz=-ux;
    const half=neighbor.width/2+extraWidth;
    // Butt-end cross-section at the actual OSM node, plus a small section
    // along each incident corridor. Their hull fills ONLY the local junction.
    for(const side of [-1,1]){
      points.push({x:junction.pos.x+side*nx*half,
        z:junction.pos.z+side*nz*half});
      points.push({x:junction.pos.x+ux*reach+side*nx*half,
        z:junction.pos.z+uz*reach+side*nz*half});
    }
  }
  const polygon=convexHull(points);
  if(polygon.length<3)return false;
  const center={x:polygon.reduce((a,p)=>a+p.x,0)/polygon.length,
    z:polygon.reduce((a,p)=>a+p.z,0)/polygon.length};
  const a=[center.x,heightFn(center.x,center.z),center.z];
  for(let k=0;k<polygon.length;k++){
    const p=polygon[k],q=polygon[(k+1)%polygon.length];
    addTriangle(mesh,a,[p.x,heightFn(p.x,p.z),p.z],[q.x,heightFn(q.x,q.z),q.z]);
  }
  return true;
}
/**
 * roads: {refs:[[lon,lat]...],nodeIds:[OSM IDs...],width:number,
 *         id:string,tags:{layer,bridge,tunnel,oneway,lanes...}}[].
 * ground(x,z) must match the actual triangulated ground surface.
 * bounds = local [xmin,zmin,xmax,zmax].
 */
export function buildRoadGeometry(roads,{project,ground,bounds,maxStep=6}){
  if(maxStep<=0)throw Error('maxStep must be positive');
  const meshes={'road':flatMesh(),'road-edge':flatMesh(),'road-marking':flatMesh()};
  const stats={sourceWays:0,clippedPaths:0,sourceSegments:0,emittedSubsegments:0,
    joinVertices:0,bevelLimitedJoins:0,reversalJoins:0,
    junctionPatches:0,junctionsByDegree:{},markingDashes:0,
    protectedGradeWays:0,crossingWithoutSharedNodeNotAutoJoined:true};
  const expanded=[bounds[0]-12,bounds[1]-12,bounds[2]+12,bounds[3]+12];
  const nodes=new Map(),classified=[];
  for(const road of roads){
    const pts=cleaned(parseRoad(road,project));
    if(pts.length<2)continue;
    const width=clamp(Number(road.width)||6,1.8,35);
    const tags=road.tags||{},grade=sameLevel(tags);
    if((tags.bridge&&tags.bridge!=='no')||(tags.tunnel&&tags.tunnel!=='no')||(Number(tags.layer)||0)!==0)stats.protectedGradeWays++;
    const paths=clipPolyline(pts,expanded);
    if(!paths.length)continue;
    stats.sourceWays++;stats.sourceSegments+=pts.length-1;
    classified.push({road,pts,width,tags,grade,paths});
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i],b=pts[i+1];
      if(length(b.x-a.x,b.z-a.z)<EPS)continue;
      for(const [node,other] of [[a,b],[b,a]]){
        if(!node.id||!other.id)continue;
        if(node.x<expanded[0]||node.x>expanded[2]||node.z<expanded[1]||node.z>expanded[3])continue;
        const key=grade+':'+node.id;
        const record=nodes.get(key)||{pos:node,neighbors:new Map(),widths:[],ways:new Set(),grade};
        record.neighbors.set(other.id,{dx:other.x-node.x,dz:other.z-node.z,width});
        record.ways.add(road.id);
        record.widths.push(width);
        nodes.set(key,record);
      }
    }
  }
  const junctionCoords=[];
  for(const n of nodes.values()){
    const degree=n.neighbors.size;
    let isJunction=degree>=3;
    if(degree===2&&n.ways.size>=2){
      const directions=[...n.neighbors.values()],a=directions[0],b=directions[1];
      const dot=(a.dx*b.dx+a.dz*b.dz)/(length(a.dx,a.dz)*length(b.dx,b.dz));
      if(dot>-.72)isJunction=true;
    }
    if(!isJunction)continue;
    const half=Math.max(...n.widths)/2;
    // Bounded local polygons derived from actual incident roadway widths,
    // replacing the previous bulbous circular patches. Not yet a full road
    // polygon union or lane-accurate intersection model.
    const borderBuilt=patchPolygon(meshes['road-edge'],n,1.65,
      (x,z)=>ground(x,z)+.155);
    const roadBuilt=patchPolygon(meshes.road,n,.15,
      (x,z)=>ground(x,z)+.245);
    if(!roadBuilt||!borderBuilt)continue;
    junctionCoords.push({x:n.pos.x,z:n.pos.z,r:Math.min(half+5,17),grade:n.grade});
    stats.junctionPatches++;stats.junctionsByDegree[degree]=(stats.junctionsByDegree[degree]||0)+1;
  }
  for(const entry of classified){
    const {width,grade,tags,paths}=entry;
    const yRoad=(x,z)=>ground(x,z)+.22;
    const yEdge=(x,z)=>ground(x,z)+.15;
    const yMark=(x,z)=>ground(x,z)+.285;
    let distanceAlong=0;
    for(const path of paths){
      const pts=subdivide(path,maxStep);
      if(pts.length<2)continue;
      stats.clippedPaths++;
      const boundary=pts.map((p,i)=>joinedEdge(pts,i,width/2,stats));
      const dummy={joinVertices:0,bevelLimitedJoins:0,reversalJoins:0};
      const border=pts.map((p,i)=>joinedEdge(pts,i,width/2+1.65,dummy));
      for(let i=0;i<pts.length-1;i++){
        const a=pts[i],b=pts[i+1],dist=length(b.x-a.x,b.z-a.z);
        if(dist<EPS)continue;
        const r0=boundary[i].r,l0=boundary[i].l,r1=boundary[i+1].r,l1=boundary[i+1].l;
        const e0=border[i].r,f0=border[i].l,e1=border[i+1].r,f1=border[i+1].l;
        addQuad(meshes['road-edge'],
          [e0.x,yEdge(e0.x,e0.z),e0.z],[e1.x,yEdge(e1.x,e1.z),e1.z],
          [f1.x,yEdge(f1.x,f1.z),f1.z],[f0.x,yEdge(f0.x,f0.z),f0.z]);
        addQuad(meshes.road,
          [r0.x,yRoad(r0.x,r0.z),r0.z],[r1.x,yRoad(r1.x,r1.z),r1.z],
          [l1.x,yRoad(l1.x,l1.z),l1.z],[l0.x,yRoad(l0.x,l0.z),l0.z]);
        stats.emittedSubsegments++;
        const oneway=['yes','1','-1','true'].includes(tags.oneway);
        const laneCount=Number(tags.lanes);
        if(width>=7&&!oneway&&laneCount!==1){
          const part=10,lit=4.5,s0=distanceAlong,s1=distanceAlong+dist;
          for(let dash=Math.floor(s0/part);dash<=Math.floor(s1/part);dash++){
            const from=Math.max(s0,dash*part+1.5);
            const to=Math.min(s1,dash*part+1.5+lit);
            if(to-from<.25)continue;
            const t0=(from-s0)/dist,t1=(to-s0)/dist;
            const p0={x:mix(a.x,b.x,t0),z:mix(a.z,b.z,t0)};
            const p1={x:mix(a.x,b.x,t1),z:mix(a.z,b.z,t1)};
            const mid={x:(p0.x+p1.x)/2,z:(p0.z+p1.z)/2};
            if(junctionCoords.some(n=>n.grade===grade&&length(mid.x-n.x,mid.z-n.z)<n.r+3))continue;
            const [nx,nz]=normal(a,b),w=.09;
            const a0={x:p0.x+nx*w,z:p0.z+nz*w};
            const a1={x:p1.x+nx*w,z:p1.z+nz*w};
            const b0={x:p0.x-nx*w,z:p0.z-nz*w};
            const b1={x:p1.x-nx*w,z:p1.z-nz*w};
            addQuad(meshes['road-marking'],
              [a0.x,yMark(a0.x,a0.z),a0.z],[a1.x,yMark(a1.x,a1.z),a1.z],
              [b1.x,yMark(b1.x,b1.z),b1.z],[b0.x,yMark(b0.x,b0.z),b0.z]);
            stats.markingDashes++;
          }
        }
        distanceAlong+=dist;
      }
    }
  }
  for(const [name,mesh] of Object.entries(meshes)){
    if(mesh.positions.some(v=>!Number.isFinite(v)))throw Error('Nonfinite road mesh '+name);
    if(mesh.indices.length%3!==0)throw Error('Bad road indices '+name);
  }
  stats.triangles=Object.fromEntries(Object.entries(meshes).map(([k,v])=>[k,v.indices.length/3]));
  return {meshes,stats};
}
