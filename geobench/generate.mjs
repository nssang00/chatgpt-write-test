import fs from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { PNG } from 'pngjs';
import earcut from 'earcut';

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
// One-tile halo is needed for exact bilinear interpolation at tile edges.
for (let y=Math.floor(minY)-1;y<=Math.floor(maxY)+1;y++) {
  for (let x=Math.floor(minX)-1;x<=Math.floor(maxX)+1;x++) {
    const url = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/'+TERR_Z+'/'+x+'/'+y+'.png';
    const data=PNG.sync.read(await download(url));
    tiles.set(x+':'+y,data);
    console.log('DEM',x,y,data.width,data.height);
  }
}
// DEM tiles are pixel-centered. The old nearest-neighbour read caused
// artificial ~20m cliffs between adjacent 14m terrain grid vertices.
// Bilinear sampling of four TERRARIUM elevations makes a continuous terrain
// at tile seams, with a one-tile halo for neighbor sampling.
function sampleHeight(lon,lat) {
  const [tx,ty]=tileXY(lon,lat,TERR_Z);
  const px=tx*256-.5,py=ty*256-.5;
  const x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;
  function pixel(ix,iy){
    const tileX=Math.floor(ix/256),tileY=Math.floor(iy/256);
    const png=tiles.get(tileX+':'+tileY);
    if(!png)throw Error('Missing surrounding DEM tile '+tileX+':'+tileY);
    if(png.width!==256||png.height!==256)throw Error('Unexpected Terrarium tile size');
    const col=((ix%256)+256)%256,row=((iy%256)+256)%256;
    const i=(row*png.width+col)*4;
    return png.data[i]*256+png.data[i+1]+png.data[i+2]/256-32768;
  }
  const a=pixel(x0,y0),b=pixel(x0+1,y0),c=pixel(x0,y0+1),d=pixel(x0+1,y0+1);
  return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
}
const terrain={positions:[],indices:[]};
const NX=96, NZ=96;
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
// The source DEM can exhibit extremely steep local ridges in the urban area.
// This is explicitly an OPTIONAL VISUAL-ONLY low-pass filter, NOT a measured
// NGII terrain or improved source DEM. It must be enabled deliberately, and
// the raw elevation slope is always recorded for audit.
const visualSmooth=process.env.GEO_VISUAL_TERRAIN_SMOOTH==='1';
let unfilteredMaxSlope=0;
const gridDX=(east-west)*111320*cosLat/NX,gridDZ=(north-south)*111320/NZ;
const gridY=(i,j)=>terrain.positions[(j*(NX+1)+i)*3+1];
for(let j=0;j<=NZ;j++)for(let i=0;i<=NX;i++){
  if(i<NX)unfilteredMaxSlope=Math.max(unfilteredMaxSlope,Math.abs(gridY(i+1,j)-gridY(i,j))/gridDX);
  if(j<NZ)unfilteredMaxSlope=Math.max(unfilteredMaxSlope,Math.abs(gridY(i,j+1)-gridY(i,j))/gridDZ);
}
if(visualSmooth){
  const gaussian=[1,4,6,4,1],dimX=NX+1,dimZ=NZ+1;
  let values=Array.from({length:dimX*dimZ},(_,idx)=>terrain.positions[idx*3+1]);
  const axisPass=(data,axis)=>{
    const out=new Array(data.length);
    for(let j=0;j<dimZ;j++)for(let i=0;i<dimX;i++){
      let value=0;
      for(let k=-2;k<=2;k++){
        const ix=axis===0?clamp(i+k,0,NX):i;
        const jz=axis===1?clamp(j+k,0,NZ):j;
        value+=data[jz*dimX+ix]*gaussian[k+2]/16;
      }
      out[j*dimX+i]=value;
    }
    return out;
  };
  // Four separable 5-tap passes, sigma~2 terrain grid cells (~26m).
  // This is an illustrative presentation filter, NOT a surveying operation.
  for(let n=0;n<4;n++){values=axisPass(values,0);values=axisPass(values,1);}
  for(let i=0;i<values.length;i++)terrain.positions[i*3+1]=values[i];
}
function visualTerrainFloor(lon,lat){
  const [x,z]=project(lon,lat);
  const minPX=project(west,lat0)[0],minPZ=project(lon0,south)[1];
  const u=clamp((x-minPX)/((east-west)*111320*cosLat)*NX,0,NX-1e-8);
  const v=clamp((z-minPZ)/((north-south)*111320)*NZ,0,NZ-1e-8);
  const i=Math.floor(u),j=Math.floor(v),fx=u-i,fz=v-j;
  const a=gridY(i,j),b=gridY(i+1,j),c=gridY(i,j+1),d=gridY(i+1,j+1);
  return fx+fz<=1?a*(1-fx-fz)+b*fx+c*fz:d*(fx+fz-1)+b*(1-fz)+c*(1-fx);
}

const osmUrl='https://api.openstreetmap.org/api/0.6/map?bbox='+BBOX.join(',');
const xml=(await download(osmUrl)).toString('utf8');
if(process.env.GEO_CAPTURE_OSM_SNAPSHOT==='1')
  await fs.writeFile('public/osm-snapshot.xml',xml);
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
  const floor=visualTerrainFloor(centerLon,centerLat);
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
// Test-relevant terrain discontinuity diagnostics at the actual grid
// resolution.  Measured before OSM road draping or GLB export.
let maxGridSlope=0,maxAdjacentRise=0,steepGridEdges=0;
const dx=(east-west)*111320*cosLat/NX,dz=(north-south)*111320/NZ;
for(let j=0;j<=NZ;j++)for(let i=0;i<=NX;i++){
  const h=terrain.positions[(j*(NX+1)+i)*3+1];
  for(const [di,dj,d] of [[1,0,dx],[0,1,dz]]){
    if(i+di>NX||j+dj>NZ)continue;
    const next=terrain.positions[((j+dj)*(NX+1)+i+di)*3+1];
    const rise=Math.abs(next-h),slope=rise/d;
    maxAdjacentRise=Math.max(maxAdjacentRise,rise);
    maxGridSlope=Math.max(maxGridSlope,slope);
    if(slope>1)steepGridEdges++;
  }
}
if(maxGridSlope>1.2)throw Error('Unrealistic Seoul terrain slope >120%, inspect DEM sampling and source tiles: '+maxGridSlope);
const fixture={
  metadata:{
    areaLabel:'Seoul Gangnam / Yeoksam Teheran-ro',demSource:'AWS Mapzen Terrarium',
    bbox:BBOX,center:[lon0,lat0],terrainZoom:TERR_Z,terrainGrid:[NX+1,NZ+1],
    demInterpolation:'bilinear on pixel centers across adjacent Terrarium tiles',
    visualTerrainFilter:visualSmooth?'four separable 5-tap Gaussian passes (sigma approx 2 terrain cells); VISUAL ONLY, not NGII':'none',
    unfilteredMaxSlope,
    terrainDiagnostics:{maxGridSlope,maxAdjacentRise,steepGridEdges},
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
