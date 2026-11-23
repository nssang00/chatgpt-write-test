import fs from 'node:fs/promises';
import path from 'node:path';

// Converts the very SAME 144 Seoul OSM/DEM JSON tile assets to real, standards-
// compliant OGC 3D Tiles 1.1 glTF GLBs, with REPLACE LOD per spatial cell.
// Only Cesium's native Cesium3DTileset loads these: no custom Primitive scheduling.
//
// 3D Tiles coordinate convention: local tileset Cartesian is (east,north,up).
// glTF is (east,up,-north), transformed +90deg X by the 3D Tiles runtime.
const manifest=JSON.parse(await fs.readFile('public/stream-manifest.json','utf8'));
const out='public/native-3dtiles';
await fs.mkdir(out,{recursive:true});
const a=6378137,e2=6.69437999014e-3;
const rad=d=>d*Math.PI/180;
const [lon,lat]=manifest.center.map(rad);
const sinL=Math.sin(lon),cosL=Math.cos(lon),sinP=Math.sin(lat),cosP=Math.cos(lat);
const N=a/Math.sqrt(1-e2*sinP*sinP);
const ecef=[N*cosP*cosL,N*cosP*sinL,N*(1-e2)*sinP];
const transform=[
  -sinL,cosL,0,0,
  -sinP*cosL,-sinP*sinL,cosP,0,
  cosP*cosL,cosP*sinL,sinP,0,
  ...ecef,1
];
const pad4=n=>(n+3)&~3;
function glb(materials,palette) {
  const bufferViews=[],accessors=[],primitives=[],chunks=[];
  const materialList=[],materialIds=new Map();
  let cursor=0,vertices=0,triangleCount=0;
  const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(const [key,source] of Object.entries(materials)){
    if(!source.length)continue;
    if(source.length%9)throw Error('Expected unindexed triangle array: '+key);
    const positions=new Float32Array(source.length);
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<source.length;i+=3){
      const x=source[i],up=source[i+1],north=source[i+2];
      // glTF Y-up -> 3D Tiles Z-up is +90°X; restore geographic ENU.
      positions[i]=x;positions[i+1]=up;positions[i+2]=-north;
      min[0]=Math.min(min[0],x);min[1]=Math.min(min[1],up);min[2]=Math.min(min[2],-north);
      max[0]=Math.max(max[0],x);max[1]=Math.max(max[1],up);max[2]=Math.max(max[2],-north);
      bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],north);bounds[2]=Math.min(bounds[2],up);
      bounds[3]=Math.max(bounds[3],x);bounds[4]=Math.max(bounds[4],north);bounds[5]=Math.max(bounds[5],up);
    }
    const raw=Buffer.from(positions.buffer,positions.byteOffset,positions.byteLength);
    const accessorIndex=accessors.length;
    bufferViews.push({buffer:0,byteOffset:cursor,byteLength:raw.byteLength,target:34962});
    accessors.push({bufferView:bufferViews.length-1,componentType:5126,count:source.length/3,type:'VEC3',min,max});
    chunks.push(raw);
    cursor+=raw.byteLength;vertices+=source.length/3;triangleCount+=source.length/9;
    if(!materialIds.has(key)){
      const c=palette[key];
      if(!c||c.length!==3)throw Error('Palette missing '+key);
      materialIds.set(key,materialList.length);
      materialList.push({
        name:key,doubleSided:true,
        pbrMetallicRoughness:{baseColorFactor:[...c,1],metallicFactor:0,roughnessFactor:1},
        extensions:{KHR_materials_unlit:{}}
      });
    }
    primitives.push({attributes:{POSITION:accessorIndex},material:materialIds.get(key),mode:4});
  }
  if(!primitives.length)return {bytes:null,bounds:null,triangleCount:0};
  const gltf={
    asset:{version:'2.0',generator:'Seoul 4-engine Cesium native 3D Tiles benchmark'},
    extensionsUsed:['KHR_materials_unlit'],
    scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives}],materials:materialList,accessors,bufferViews,
    buffers:[{byteLength:cursor}]
  };
  let json=Buffer.from(JSON.stringify(gltf),'utf8');
  if(json.length%4)json=Buffer.concat([json,Buffer.alloc(pad4(json.length)-json.length,0x20)]);
  const bin=Buffer.concat(chunks);
  const binPad=pad4(bin.length)-bin.length;
  const total=12+8+json.length+8+bin.length+binPad;
  const header=Buffer.alloc(12);
  header.write('glTF',0,'ascii');header.writeUInt32LE(2,4);header.writeUInt32LE(total,8);
  const jsonHeader=Buffer.alloc(8);jsonHeader.writeUInt32LE(json.length,0);jsonHeader.write('JSON',4,'ascii');
  const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(bin.length+binPad,0);binHeader.write('BIN\0',4,'binary');
  return {bytes:Buffer.concat([header,jsonHeader,json,binHeader,bin,Buffer.alloc(binPad)]),bounds,triangleCount,vertices};
}
function box(bounds){
  const [xmin,ymin,zmin,xmax,ymax,zmax]=bounds;
  return [(xmin+xmax)/2,(ymin+ymax)/2,(zmin+zmax)/2,
    Math.max(1,(xmax-xmin)/2+.5),0,0,0,Math.max(1,(ymax-ymin)/2+.5),0,0,0,Math.max(1,(zmax-zmin)/2+.5)];
}
function union(a,b){
  if(!a)return b;if(!b)return a;
  return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.min(a[2],b[2]),
    Math.max(a[3],b[3]),Math.max(a[4],b[4]),Math.max(a[5],b[5])];
}
const children=[];let rootBounds=null,totalBytes=0,totalTriangles=0,nonempty=0;
const levelCounts={high:0,low:0};
for(const t of manifest.tiles){
  const tiles={};
  let b=null;
  for(const detail of ['low','high']){
    const source=JSON.parse(await fs.readFile('public'+t.files[detail].url,'utf8'));
    const result=glb(source.materials,manifest.palette);
    if(!result.bytes)continue;
    const filename=t.id+'-'+detail+'.glb';
    await fs.writeFile(path.join(out,filename),result.bytes);
    tiles[detail]={content:{uri:filename},geometricError:detail==='low'?7.5:0,refine:'REPLACE'};
    b=union(b,result.bounds);
    totalBytes+=result.bytes.length;totalTriangles+=result.triangleCount;
    levelCounts[detail]+=result.triangleCount;
  }
  if(!b)continue;
  nonempty++;
  const volume={box:box(b)};
  const high={...tiles.high,boundingVolume:volume};
  const low={...tiles.low,boundingVolume:volume,children:[high]};
  children.push(low);
  rootBounds=union(rootBounds,b);
}
if(nonempty<100)throw Error('Expected at least 100 nonempty tiles');
const terrainIsSynthetic=/SYNTHETIC BENCHMARK TERRAIN/i.test(manifest.dataSource||'');
const terrainProvenance=terrainIsSynthetic?
  'SYNTHETIC VISUAL BENCHMARK ONLY - NOT MEASURED SEOUL TERRAIN':
  'OSM footprints and approximate AWS Mapzen Terrarium elevations';
const tileset={
  asset:{version:'1.1',tilesetVersion:'seoul-osm-20261120',
    extras:{terrainProvenance,sourceManifest:manifest.dataSource}},
  geometricError:5000,
  root:{boundingVolume:{box:box(rootBounds)},geometricError:5000,refine:'REPLACE',transform,children}
};
await fs.writeFile(path.join(out,'tileset.json'),JSON.stringify(tileset));
const validation={
  dataset:terrainIsSynthetic?
    'SYNTHETIC Seoul-inspired renderer benchmark: OSM 2D geometry; invented smooth elevations':
    'Seoul Gangnam OSM footprint procedural facade and AWS Mapzen DEM',
  terrainProvenance,
  sourceDEMIsUsedAsActualElevation:!terrainIsSynthetic,
  sourceManifest:'stream-manifest.json',tileCount:manifest.tiles.length,
  nonemptyTileCount:nonempty,geometricErrorLow:7.5,
  refinement:'REPLACE',assetVersion:'1.1',glTF:'2.0 GLB KHR_materials_unlit',
  rootCoordinateSystem:'WGS84 ECEF with ENU root transform; local glTF east/up/-north',
  totalBytes,totalTriangles,levelCounts,
  caveat:'Geometric LOD contents match custom shared loader high/low, but native SSE spatial selection differs from custom radius scheduler; data files are GLB vs JSON. Not an identically optimized/fair 3D Tiles comparison.'
};
await fs.writeFile(path.join(out,'build-report.json'),JSON.stringify(validation,null,2));
console.log('NATIVE_3DTILES_PACK_RESULT',JSON.stringify(validation));
