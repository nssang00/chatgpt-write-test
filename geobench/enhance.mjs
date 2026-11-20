import fs from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import earcut from 'earcut';

// Procedural architectural DETAIL, not surveyed facade or actual building heights.
// All coordinates stay in meters: x east, y up, z north.
// This file augments the SAME OSM + AWS Terrarium area from generate.mjs.
const base=JSON.parse(await fs.readFile('public/fixture.json','utf8'));
const [west,south,east,north]=base.metadata.bbox;
const [lon0,lat0]=base.metadata.center;
const cosLat=Math.cos(lat0*Math.PI/180);
const project=(lon,lat)=>[(lon-lon0)*111320*cosLat,(lat-lat0)*111320];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,f)=>a*(1-f)+b*f;
const toLocal=([lon,lat])=>project(lon,lat);
const NX=base.metadata.terrainGrid[0]-1,NZ=base.metadata.terrainGrid[1]-1;
const xMin=project(west,lat0)[0],xMax=project(east,lat0)[0];
const zMin=project(lon0,south)[1],zMax=project(lon0,north)[1];
function ground(x,z){
  const fx=clamp((x-xMin)/(xMax-xMin)*NX,0,NX-0.00001);
  const fz=clamp((z-zMin)/(zMax-zMin)*NZ,0,NZ-0.00001);
  const xi=Math.floor(fx),zi=Math.floor(fz);
  const index=(i,j)=>(j*(NX+1)+i)*3+1;
  const p=base.terrain.positions;
  const a=lerp(p[index(xi,zi)],p[index(xi+1,zi)],fx-xi);
  const b=lerp(p[index(xi,zi+1)],p[index(xi+1,zi+1)],fx-xi);
  return lerp(a,b,fz-zi);
}
const palette={
  'terrain':[0.43,0.49,0.38],
  'park':[0.31,0.42,0.31],
  'road-edge':[0.56,0.55,0.51],
  'road':[0.245,0.275,0.29],
  'road-marking':[0.84,0.78,0.63],
  'wall-ivory':[0.78,0.775,0.72],
  'wall-ivory-shade':[0.65,0.66,0.61],
  'wall-beige':[0.73,0.66,0.56],
  'wall-beige-shade':[0.60,0.55,0.48],
  'wall-brick':[0.54,0.39,0.34],
  'wall-brick-shade':[0.45,0.32,0.28],
  'wall-concrete':[0.65,0.70,0.71],
  'wall-concrete-shade':[0.53,0.59,0.62],
  'wall-dark':[0.32,0.41,0.46],
  'wall-dark-shade':[0.25,0.33,0.38],
  'window-deep':[0.105,0.21,0.27],
  'window-blue':[0.27,0.43,0.51],
  'window-reflect':[0.47,0.63,0.68],
  'window-warm':[0.62,0.54,0.37],
  'window-frame':[0.17,0.24,0.26],
  'window-white-frame':[0.76,0.77,0.72],
  'ledge':[0.53,0.55,0.51],
  'roof':[0.38,0.43,0.45],
  'roof-equipment':[0.64,0.66,0.63],
  'entrance':[0.18,0.28,0.31],
  'tree-trunk':[0.35,0.30,0.22],
  'tree-leaf':[0.29,0.43,0.32],
  'tree-leaf-light':[0.40,0.54,0.35]
};
const meshes=Object.fromEntries(Object.keys(palette).map(k=>[k,{positions:[],indices:[]}]));
const stats={roads:0,roadSegments:0,buildings:0,windows:0,trees:0,inferredHeights:0,rooftopUnits:0};
function tri(k,a,b,c){
  const m=meshes[k],i=m.positions.length/3;
  m.positions.push(...a,...b,...c);
  m.indices.push(i,i+1,i+2);
}
function quad(k,a,b,c,d){
  const m=meshes[k],i=m.positions.length/3;
  m.positions.push(...a,...b,...c,...d);
  m.indices.push(i,i+1,i+2,i,i+2,i+3);
}
function wall(k,A,B,bottom,top,normal,offset=0){
  const [nx,nz]=normal;
  quad(k,[A[0]+nx*offset,bottom,A[1]+nz*offset],
    [B[0]+nx*offset,bottom,B[1]+nz*offset],
    [B[0]+nx*offset,top,B[1]+nz*offset],
    [A[0]+nx*offset,top,A[1]+nz*offset]);
}
function box(k,x,y,z,wx,hy,wz){
  const x0=x-wx/2,x1=x+wx/2,z0=z-wz/2,z1=z+wz/2,y0=y,y1=y+hy;
  wall(k,[x0,z0],[x1,z0],y0,y1,[0,-1]);
  wall(k,[x1,z0],[x1,z1],y0,y1,[1,0]);
  wall(k,[x1,z1],[x0,z1],y0,y1,[0,1]);
  wall(k,[x0,z1],[x0,z0],y0,y1,[-1,0]);
  quad(k,[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]);
}
function hash(value){let n=2166136261;for(const ch of String(value)){n^=ch.charCodeAt(0);n=Math.imul(n,16777619)}return n>>>0;}
function smallCanopy(x,z,y,r,seed){
  const low=y+1.7,hi=y+2.8,off=r*.85;
  box('tree-trunk',x,ground(x,z)+0.08,z,0.32,2.5,0.32);
  const left=[x-off,low,z],right=[x+off,low,z],near=[x,low,z-off],far=[x,low,z+off];
  const top=[x,hi+r*.7,z],bottom=[x,low-r*.4,z];
  for(const [a,b] of [[left,near],[near,right],[right,far],[far,left]]) {
    tri('tree-leaf-light',top,a,b);tri('tree-leaf',bottom,b,a);
  }
  stats.trees++;
}
const osmUrl=base.metadata.osmEndpoint;
const res=await fetch(osmUrl,{headers:{'User-Agent':'geo-renderer-benchmark/1.0 (noncommercial single-area experiment)'}});
if(!res.ok)throw new Error('OSM '+res.status);
const parsed=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',isArray:tag=>['node','way','nd','tag'].includes(tag)})
  .parse(await res.text()).osm;
const nodes=new Map((parsed.node||[]).map(n=>[String(n['@_id']),[Number(n['@_lon']),Number(n['@_lat'])]]));
const inside=([x,z])=>x>=xMin&&x<=xMax&&z>=zMin&&z<=zMax;
const buildingCenters=[];
const roads=[];
for(const way of parsed.way||[]){
  const tags=Object.fromEntries((way.tag||[]).map(t=>[t['@_k'],t['@_v']]));
  const refs=(way.nd||[]).map(n=>nodes.get(String(n['@_ref']))).filter(Boolean);
  if(tags.highway && refs.length>=2){
    const level=tags.highway;
    if(!['footway','path','pedestrian','residential','service','tertiary','secondary','primary','living_street','unclassified','cycleway'].includes(level))continue;
    const width=level==='primary'?12:level==='secondary'?10:level==='tertiary'?9:level==='footway'?2:level==='path'?2:level==='cycleway'?2.3:level==='service'?5:7.5;
    roads.push({refs,width,id:String(way['@_id'])});
  }
  if(!tags.building || tags.building==='no'||refs.length<4)continue;
  const points=refs.map(toLocal);
  if(points.length>=2&&Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<.1)points.pop();
  if(points.length<3)continue;
  const cx=points.reduce((s,p)=>s+p[0],0)/points.length;
  const cz=points.reduce((s,p)=>s+p[1],0)/points.length;
  if(!inside([cx,cz]))continue;
  const tris=earcut(points.flat());
  if(tris.length<3)continue;
  const hTag=Number.parseFloat(tags.height);
  const lTag=Number.parseFloat(tags['building:levels']);
  const seed=hash(way['@_id']);
  const actual=Number.isFinite(hTag)&&hTag>0;
  const levels=Number.isFinite(lTag)&&lTag>0;
  const floors=actual?clamp(Math.round(hTag/3.05),1,35):levels?clamp(Math.round(lTag),1,35):3+seed%5;
  const height=actual?clamp(hTag,3,135):floors*3.05;
  if(!actual&&!levels)stats.inferredHeights++;
  const style=(seed>>>4)%5;
  const bases=['wall-ivory','wall-beige','wall-brick','wall-concrete','wall-dark'];
  const shades=['wall-ivory-shade','wall-beige-shade','wall-brick-shade','wall-concrete-shade','wall-dark-shade'];
  const yBase=ground(cx,cz)-0.06,yTop=yBase+height;
  const area=points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
  const sign=area>0?1:-1;
  for(let k=0;k<tris.length;k+=3){
    const a=points[tris[k]],b=points[tris[k+1]],c=points[tris[k+2]];
    tri('roof',[a[0],yTop,a[1]],[b[0],yTop,b[1]],[c[0],yTop,c[1]]);
  }
  for(let e=0;e<points.length;e++){
    const A=points[e],B=points[(e+1)%points.length];
    const dx=B[0]-A[0],dz=B[1]-A[1],length=Math.hypot(dx,dz);
    if(length<.35)continue;
    const n=[sign*dz/length,sign*(-dx)/length];
    const side=(dx*.65+dz*.76)>0?bases[style]:shades[style];
    wall(side,A,B,yBase,yTop,n);
    wall('ledge',A,B,yBase+0.15,yBase+0.40,n,.035);
    wall('ledge',A,B,yTop-.15,yTop+.35,n,.05);
    const bayCount=clamp(Math.floor(length/2.9),1,50);
    const step=length/bayCount;
    const topWindowRatio=style===4?.86:.78;
    for(let floor=0;floor<floors;floor++){
      const y0=yBase+floor*height/floors;
      const y1=yBase+(floor+1)*height/floors;
      if(floor>0 && length>5 && style!==4){
        wall('ledge',A,B,y0-.10,y0+.045,n,.065);
      }
      for(let bay=0;bay<bayCount;bay++){
        // Glass panes with dark mullions, a small specular strip and occasional warm interiors.
        const q0=(bay+.13)/bayCount,q1=(bay+.87)/bayCount;
        const P=[lerp(A[0],B[0],q0),lerp(A[1],B[1],q0)];
        const Q=[lerp(A[0],B[0],q1),lerp(A[1],B[1],q1)];
        const windowBottom=y0+(floor===0?.27:.25)*(y1-y0);
        const windowTop=y0+topWindowRatio*(y1-y0);
        wall('window-frame',P,Q,windowBottom-.10,windowTop+.10,n,.09);
        const inner0=[lerp(P[0],Q[0],.085),lerp(P[1],Q[1],.085)];
        const inner1=[lerp(P[0],Q[0],.915),lerp(P[1],Q[1],.915)];
        const choice=(seed+floor*13+bay*29+e*11)%17;
        const windowMat=choice===0?'window-warm':choice<4?'window-reflect':style===4?'window-blue':'window-deep';
        wall(windowMat,inner0,inner1,windowBottom,windowTop,n,.12);
        if(bayCount>1 && (bay+floor)%3===0){
          const stripe0=[lerp(inner0[0],inner1[0],.11),lerp(inner0[1],inner1[1],.11)];
          const stripe1=[lerp(inner0[0],inner1[0],.19),lerp(inner0[1],inner1[1],.19)];
          wall('window-reflect',stripe0,stripe1,windowBottom+.03,windowTop-.03,n,.135);
        }
        stats.windows++;
      }
    }
    if(style===4){
      const beam0=[lerp(A[0],B[0],.02),lerp(A[1],B[1],.02)];
      const beam1=[lerp(A[0],B[0],.98),lerp(A[1],B[1],.98)];
      wall('window-white-frame',beam0,beam1,yTop-.35,yTop-.11,n,.09);
    }
    if(length>5){
      const a=[lerp(A[0],B[0],.24),lerp(A[1],B[1],.24)];
      const b=[lerp(A[0],B[0],.76),lerp(A[1],B[1],.76)];
      wall('entrance',a,b,yBase+.35,yBase+Math.min(2.8,height*.23),n,.17);
    }
  }
  // Roof plant, ventilation housing, parapets; illustrative, not surveyed.
  const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0]));
  const minZ=Math.min(...points.map(p=>p[1])),maxZ=Math.max(...points.map(p=>p[1]));
  const roofWidth=maxX-minX,roofDepth=maxZ-minZ;
  if(roofWidth>6&&roofDepth>6){
    box('roof-equipment',cx,yTop+.05,cz,Math.min(roofWidth*.32,7),1.5+seed%3,Math.min(roofDepth*.26,6));
    stats.rooftopUnits++;
  }
  buildingCenters.push({x:cx,z:cz,y:yBase,height,footprint:roofWidth*roofDepth});
  stats.buildings++;
}
for(const road of roads){
  let segs=0;
  const pts=road.refs.map(toLocal);
  for(let i=0;i<pts.length-1;i++){
    const A=pts[i],B=pts[i+1],dx=B[0]-A[0],dz=B[1]-A[1],length=Math.hypot(dx,dz);
    if(length<.6 || length>300 || (!inside(A)&&!inside(B)))continue;
    const nx=dz/length,nz=-dx/length;
    const y0=ground(A[0],A[1])+0.22,y1=ground(B[0],B[1])+0.22;
    function strip(material,wide,offset){
      const half=wide/2;
      quad(material,[A[0]+nx*half,y0+offset,A[1]+nz*half],
        [B[0]+nx*half,y1+offset,B[1]+nz*half],
        [B[0]-nx*half,y1+offset,B[1]-nz*half],
        [A[0]-nx*half,y0+offset,A[1]-nz*half]);
    }
    strip('road-edge',road.width+3.3,-0.07);
    strip('road',road.width,0);
    if(road.width>=7 && length>10){
      for(let s=2;s<length-2;s+=12){
        const end=Math.min(s+5,length-2),t0=s/length,t1=end/length;
        const x0=lerp(A[0],B[0],t0),z0=lerp(A[1],B[1],t0);
        const x1=lerp(A[0],B[0],t1),z1=lerp(A[1],B[1],t1);
        const h0=lerp(y0,y1,t0)+.035,h1=lerp(y0,y1,t1)+.035;
        quad('road-marking',[x0+nx*.085,h0,z0+nz*.085],[x1+nx*.085,h1,z1+nz*.085],
           [x1-nx*.085,h1,z1-nz*.085],[x0-nx*.085,h0,z0-nz*.085]);
      }
    }
    segs++;stats.roadSegments++;
    if(road.width>=5 && length>14){
      for(let t=10;t<length-3;t+=21){
        if(((hash(road.id)+i*7+t)|0)%4===0)continue;
        const q=t/length,side=((hash(road.id)+i+Math.round(t))%2)?1:-1;
        const tx=lerp(A[0],B[0],q)+nx*(road.width/2+5)*side;
        const tz=lerp(A[1],B[1],q)+nz*(road.width/2+5)*side;
        if(inside([tx,tz]))smallCanopy(tx,tz,ground(tx,tz),1.4,hash(road.id)+i);
      }
    }
  }
  if(segs)stats.roads++;
}
if(stats.buildings<10)throw new Error('Building fixture unexpectedly empty');
// Focus near the business-district center so all engines show a dense skyline.
const focus=buildingCenters.toSorted((a,b)=>
  (Math.hypot(a.x,a.z)-Math.min(a.height,100)*.8)-
  (Math.hypot(b.x,b.z)-Math.min(b.height,100)*.8))[0];
const detailed={
  metadata:{
    ...base.metadata,style:'procedural-architectural-visualization',
    visualAccuracy:'Building footprints from OSM, terrain from Terrarium; facades/windows/colors/rooftop units/trees are stylized procedural inventions, NOT surveyed real buildings.',
    inferredBuildingHeights:stats.inferredHeights,
    buildingCount:stats.buildings,
    terrainTriangles:base.terrain.indices.length/3,
    materialColors:palette,
    meshStats:stats,
    focus:[focus.x,focus.y+focus.height*.40,focus.z],
    trianglesByMaterial:Object.fromEntries(Object.entries(meshes).map(([k,v])=>[k,v.indices.length/3]))
  },
  terrain:base.terrain,
  surfaces:Object.fromEntries(Object.entries(meshes).filter(([,v])=>v.indices.length>0))
};
await fs.writeFile('public/fixture-detailed.json',JSON.stringify(detailed));
console.log('DETAIL_RESULT',JSON.stringify({
  stats,focus:detailed.metadata.focus,
  triangles:Object.values(detailed.metadata.trianglesByMaterial).reduce((a,b)=>a+b,0),
  bytes:(await fs.stat('public/fixture-detailed.json')).size
}));
