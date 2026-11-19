import fs from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { PNG } from 'pngjs';
import earcut from 'earcut';

// Fixed ~800m x 780m urban area in Daejeon. Both renderers use this exact fixture.
const BBOX = [127.3810, 36.3450, 127.3900, 36.3520];
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
function sampleHeight(lon,lat) {
  const [tx,ty]=tileXY(lon,lat,TERR_Z), x=Math.floor(tx),y=Math.floor(ty),png=tiles.get(x+':'+y);
  if(!png) throw new Error('Missing DEM tile '+x+':'+y);
  const px=clamp(Math.floor((tx-x)*png.width),0,png.width-1);
  const py=clamp(Math.floor((ty-y)*png.height),0,png.height-1);
  const i=(py*png.width+px)*4;
  return png.data[i]*256+png.data[i+1]+png.data[i+2]/256-32768;
}
const terrain={positions:[],indices:[]};
const NX=64, NZ=64;
for(let j=0;j<=NZ;j++){
  for(let i=0;i<=NX;i++){
    const lon=west+(east-west)*i/NX,lat=south+(north-south)*j/NZ;
    const [x,z]=project(lon,lat);
    terrain.positions.push(x,sampleHeight(lon,lat),z);
  }
}
for(let j=0;j<NZ;j++)for(let i=0;i<NX;i++){
  const a=j*(NX+1)+i,b=a+1,c=a+(NX+1),d=c+1;
  terrain.indices.push(a,c,b,b,c,d);
}
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
if(count<10)throw new Error('Too few OSM buildings; refusing synthetic fallback: '+count);
const fixture={
  metadata:{
    bbox:BBOX,center:[lon0,lat0],terrainZoom:TERR_Z,terrainGrid:[NX+1,NZ+1],
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
