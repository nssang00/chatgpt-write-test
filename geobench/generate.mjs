import fs from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { PNG } from 'pngjs';
import earcut from 'earcut';
import {urbanTerrainRepair,gridGradeStats} from './urban_terrain_repair.mjs';

// Seoul Gangnam / Yeoksam business district, approximately 1.25 x 1.33 km.
// Dense OSM building district. All four engines receive exactly the same fixture.
const BBOX = [127.0310, 37.4960, 127.0450, 37.5080];
const TERR_Z = 13;
const [west, south, east, north] = BBOX;
const lon0 = (west + east) / 2, lat0 = (south + north) / 2;
const cosLat = Math.cos(lat0 * Math.PI / 180);
const project = (lon, lat) => [(lon - lon0) * 111320 * cosLat, (lat - lat0) * 111320];
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const tileXY = (lon,lat,z) => {
  const m=Math.pow(2,z);
  return [((lon+180)/360)*m, (1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*m];
};
async function download(url) {
  const response = await fetch(url,{headers:{'User-Agent':'geo-renderer-benchmark/1.0 (noncommercial single-area experiment)'}});
  if(!response.ok) throw new Error('HTTP '+response.status+' '+url);
  return Buffer.from(await response.arrayBuffer());
}
const tiles = new Map();
const [minX,minY] = tileXY(west,north,TERR_Z);
const [maxX,maxY] = tileXY(east,south,TERR_Z);
for (let y=Math.floor(minY);y<=Math.floor(maxY);y++) {
  for (let x=Math.floor(minX);x<=Math.floor(maxX);x++) {
    const url = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/'+TERR_Z+'/'+x+'/'+y+'.png';
    const data=PNG.sync.read(await download(url));
    tiles.set(x+':'+y,data);
    console.log('DEM',x,y,data.width,data.height);
  }
}
function sampleRawHeight(lon,lat) {
  const [tx,ty]=tileXY(lon,lat,TERR_Z), x=Math.floor(tx),y=Math.floor(ty),png=tiles.get(x+':'+y);
  if(!png) throw new Error('Missing DEM tile '+x+':'+y);
  const px=clamp(Math.floor((tx-x)*png.width),0,png.width-1);
  const py=clamp(Math.floor((ty-y)*png.height),0,png.height-1);
  const i=(py*png.width+px)*4;
  return png.data[i]*256+png.data[i+1]+png.data[i+2]/256-32768;
}
const terrain={positions:[],indices:[]};
const NX=96, NZ=96;
for(let j=0;j<=NZ;j++){
  for(let i=0;i<=NX;i++){
    const lon=west+(east-west)*i/NX,lat=south+(north-south)*j/NZ;
    const [x,z]=project(lon,lat);
    terrain.positions.push(x,sampleRawHeight(lon,lat),z);
  }
}
for(let j=0;j<NZ;j++)for(let i=0;i<NX;i++){
  const a=j*(NX+1)+i,b=a+1,c=a+(NX+1),d=c+1;
  terrain.indices.push(a,c,b,b,c,d);
}
// The raw Terrarium surface may contain tall DSM-like spikes; using these
// directly as road ground makes jagged vertical wedges (verified in Seoul GLBs).
// Filter the source BEFORE placing buildings and constructing joined roads.
const nx=NX+1,nz=NZ+1;
const sampleDx=(project(east,lat0)[0]-project(west,lat0)[0])/NX;
const sampleDz=(project(lon0,north)[1]-project(lon0,south)[1])/NZ;
const rawHeights=Float64Array.from({length:nx*nz},(_,i)=>terrain.positions[i*3+1]);
const filterMode=process.env.GEO_TERRAIN_FILTER||'urban';
if(!['urban','off'].includes(filterMode))throw Error('Invalid GEO_TERRAIN_FILTER');
const repaired=filterMode==='urban'
  ?urbanTerrainRepair(rawHeights,nx,nz,sampleDx,sampleDz)
  :{heights:rawHeights,diagnostics:{method:'none: raw AWS Mapzen elevation',original:gridGradeStats(rawHeights,nx,nz,sampleDx,sampleDz),
      repaired:gridGradeStats(rawHeights,nx,nz,sampleDx,sampleDz),visualizationOnly:true}};
for(let i=0;i<repaired.heights.length;i++)terrain.positions[i*3+1]=repaired.heights[i];
const terrainRepair={...repaired.diagnostics,filterMode,
  note:'Approximate urban ground correction for AWS terrain ONLY; not a surveyed NGII DTM.'};
// Buildings and roads sample the same terrain TRIANGLES that are rendered.
function sampleHeight(lon,lat){
  const [x,z]=project(lon,lat);
  const xMin=project(west,lat0)[0],zMin=project(lon0,south)[1];
  const fx=clamp((x-xMin)/sampleDx,0,NX-1e-7);
  const fz=clamp((z-zMin)/sampleDz,0,NZ-1e-7);
  const xi=Math.floor(fx),zi=Math.floor(fz),u=fx-xi,v=fz-zi;
  const h=(i,j)=>terrain.positions[(j*(NX+1)+i)*3+1];
  const a=h(xi,zi),b=h(xi+1,zi),c=h(xi,zi+1),d=h(xi+1,zi+1);
  return u+v<=1 ? a*(1-u-v)+b*u+c*v :
    d*(u+v-1)+b*(1-v)+c*(1-u);
}
console.log('TERRAIN_GROUND_REPAIR_RESULT',JSON.stringify(terrainRepair));

const osmUrl='https://api.openstreetmap.org/api/0.6/map?bbox='+BBOX.join(',');
const xml=(await download(osmUrl)).toString('utf8');
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',isArray:(tag)=>['node','way','nd','tag'].includes(tag)});
const parsed=parser.parse(xml).osm;
if(!parsed||!parsed.node||!parsed.way)throw new Error('OSM response missing nodes or ways');
const nodes=new Map(parsed.node.map(n=>[String(n['@_id']),[Number(n['@_lon']),Number(n['@_lat'])]]));
const buildings={positions:[],indices:[]};
let count=0, skipped=0, inferred=0;
for(const way of parsed.way){
  const tags=Object.fromEntries((way.tag||[]).map(t=>[t['@_k'],t['@_v']]));
  if(!tags.building || tags.building==='no')continue;
  const refs=(way.nd||[]).map(n=>nodes.get(String(n['@_ref']))).filter(Boolean);
  if(refs.length<4){skipped++;continue;}
  if(refs[0][0]===refs[refs.length-1][0] && refs[0][1]===refs[refs.length-1][1])refs.pop();
  if(refs.length<3){skipped++;continue;}
  const centerLon=refs.reduce((s,p)=>s+p[0],0)/refs.length;
  const centerLat=refs.reduce((s,p)=>s+p[1],0)/refs.length;
  if(centerLon<west||centerLon>east||centerLat<south||centerLat>north)continue;
  const hTag=Number.parseFloat(tags.height), levelTag=Number.parseFloat(tags['building:levels']);
  const height=Number.isFinite(hTag)&&hTag>0? hTag : (Number.isFinite(levelTag)&&levelTag>0 ? levelTag*3 : 12);
  if(!(Number.isFinite(hTag)&&hTag>0) && !(Number.isFinite(levelTag)&&levelTag>0))inferred++;
  const floor=sampleHeight(centerLon,centerLat);
  const pts=refs.map(([lon,lat])=>project(lon,lat));
  const triangles=earcut(pts.flat());
  if(!triangles.length){skipped++;continue;}
  const base=buildings.positions.length/3;
  for(const [x,z] of pts) buildings.positions.push(x,floor+height,z);
  for(const [x,z] of pts) buildings.positions.push(x,floor,z);
  for(let k=0;k<triangles.length;k+=3)buildings.indices.push(base+triangles[k],base+triangles[k+1],base+triangles[k+2]);
  const n=pts.length;
  for(let k=0;k<n;k++){
    const next=(k+1)%n;
    buildings.indices.push(base+k,base+n+k,base+next,base+next,base+n+k,base+n+next);
  }
  count++;
}
if(count<100)throw new Error('Expected dense Seoul district with 100+ OSM buildings, found only '+count+'; refusing fake building count');
const fixture={
  metadata:{
    areaLabel:'Seoul Gangnam / Yeoksam Teheran-ro',demSource:'AWS Mapzen Terrarium',
    bbox:BBOX,center:[lon0,lat0],terrainZoom:TERR_Z,terrainGrid:[NX+1,NZ+1],
    terrainRepair,
    osmEndpoint:osmUrl,demPrefix:'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/',
    generatedAt:new Date().toISOString(),buildingCount:count,skippedBuildings:skipped,
    inferredBuildingHeights:inferred,triangles:{terrain:terrain.indices.length/3,buildings:buildings.indices.length/3},
    coordinate:'local east/up/north meters, common mesh arrays',
    attribution:'© OpenStreetMap contributors (ODbL); AWS Terrain Tiles / Mapzen (respect upstream elevation-data attribution)'
  },terrain,buildings
};
await fs.mkdir('public',{recursive:true});
await fs.writeFile('public/fixture.json',JSON.stringify(fixture));
console.log(JSON.stringify(fixture.metadata,null,2));
console.log('fixture bytes:',(await fs.stat('public/fixture.json')).size);
