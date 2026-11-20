import fs from 'node:fs/promises';
import path from 'node:path';

// Common shared tile store; no full-scene geometry loaded at runtime.
// Triangle centroid assignment is identical across all four engines.
// Controlled shared tile scheduler, not native 3D Tiles engine comparison.
const data=JSON.parse(await fs.readFile('public/fixture-detailed.json','utf8'));
const count=12;
const bbox=data.metadata.bbox,center=data.metadata.center;
const cos=Math.cos(center[1]*Math.PI/180);
const xmin=(bbox[0]-center[0])*111320*cos,xmax=(bbox[2]-center[0])*111320*cos;
const zmin=(bbox[1]-center[1])*111320,zmax=(bbox[3]-center[1])*111320;
const tileX=x=>Math.max(0,Math.min(count-1,Math.floor((x-xmin)/(xmax-xmin)*count)));
const tileZ=z=>Math.max(0,Math.min(count-1,Math.floor((z-zmin)/(zmax-zmin)*count)));
const ids=Array.from({length:count*count},(_,n)=>Math.floor(n/count)+'_'+n%count);
const storages=new Map(ids.map(k=>[k,{high:{},low:{}}]));
const lowNames=new Set(['terrain','road','road-edge','roof','wall-ivory','wall-ivory-shade',
 'wall-beige','wall-beige-shade','wall-brick','wall-brick-shade',
 'wall-concrete','wall-concrete-shade','wall-dark','wall-dark-shade']);
function appendMaterial(name,source){
  const v=source.positions,indices=source.indices;
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const x=(v[a]+v[b]+v[c])/3,z=(v[a+2]+v[b+2]+v[c+2])/3;
    const bucket=storages.get(tileX(x)+'_'+tileZ(z));
    if(!bucket)throw Error('No tile for triangle');
    const dst=bucket.high[name]??(bucket.high[name]=[]);
    dst.push(v[a],v[a+1],v[a+2],v[b],v[b+1],v[b+2],v[c],v[c+1],v[c+2]);
    if(lowNames.has(name)){
      const low=bucket.low[name]??(bucket.low[name]=[]);
      low.push(v[a],v[a+1],v[a+2],v[b],v[b+1],v[b+2],v[c],v[c+1],v[c+2]);
    }
  }
}
appendMaterial('terrain',data.terrain);
for(const [name,src] of Object.entries(data.surfaces))appendMaterial(name,src);
const dir='public/stream-tiles';await fs.mkdir(dir,{recursive:true});
const tiles=[],totals={high:0,low:0};
for(let r=0;r<count;r++)for(let c=0;c<count;c++){
  const id=r+'_'+c,v=storages.get(id);
  const xc=xmin+(c+.5)*(xmax-xmin)/count,zc=zmin+(r+.5)*(zmax-zmin)/count;
  const files={};
  for(const detail of ['high','low']){
    const content=JSON.stringify({id,detail,materials:v[detail]});
    const filename=id+'-'+detail+'.json';
    await fs.writeFile(path.join(dir,filename),content);
    const triangles=Object.values(v[detail]).reduce((t,a)=>t+a.length/9,0);
    files[detail]={url:'/stream-tiles/'+filename,bytes:Buffer.byteLength(content),triangles};
    totals[detail]+=triangles;
  }
  tiles.push({id,c,r,center:[xc,zc],files});
}
const manifest={
  area:'Seoul Gangnam Yeoksam',bbox,center,
  dataSource:data.metadata.demSource||'AWS Mapzen Terrarium',
  buildingCount:data.metadata.buildingCount,
  originalGeometryTriangles:Object.values(data.metadata.trianglesByMaterial).reduce((s,v)=>s+v,0)+data.metadata.terrainTriangles,
  grid:[count,count],localBounds:[xmin,zmin,xmax,zmax],
  palette:data.metadata.materialColors,tiles,totals,
  highMeans:'All original triangles including procedural facade windows and trees',
  lowMeans:'Terrain, roadway and basic wall/roof triangles; excludes windows trees equipment',
  assignment:'Triangle centroid to one grid tile; cross-boundary tris not clipped',
  note:'Identical tile files and JS tile selection for all four engines; not Cesium-native 3D Tiles'
};
await fs.writeFile('public/stream-manifest.json',JSON.stringify(manifest));
console.log('STREAM_PACK_RESULT',JSON.stringify({
  tileCount:tiles.length,buildings:manifest.buildingCount,
  triangleTotals:totals,bytes:tiles.reduce((t,v)=>t+v.files.high.bytes+v.files.low.bytes,0),
  maxTileHighBytes:Math.max(...tiles.map(t=>t.files.high.bytes)),
  totalManifestBytes:(await fs.stat('public/stream-manifest.json')).size
}));
