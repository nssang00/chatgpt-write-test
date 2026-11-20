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
// Bilinear interpolation over native Terrarium raster pixel CENTERS.
// Previously Math.floor selected the nearest tile cell and introduced sharp
// artificial steps (up to 38m height jumps inside one rendered triangle).
function terrariumPixel(x,y,i,j) {
  let xx=x,yy=y,px=i,py=j;
  while(px<0){xx--;px+=256;}
  while(px>=256){xx++;px-=256;}
  while(py<0){yy--;py+=256;}
  while(py>=256){yy++;py-=256;}
  const image=tiles.get(xx+':'+yy);
  if(!image) {
    const source=tiles.get(x+':'+y);
    if(!source)throw new Error('Missing DEM tile '+x+':'+y);
    const q=(clamp(j,0,source.height-1)*source.width+clamp(i,0,source.width-1))*4;
    return source.data[q]*256+source.data[q+1]+source.data[q+2]/256-32768;
  }
  const q=(py*image.width+px)*4;
  return image.data[q]*256+image.data[q+1]+image.data[q+2]/256-32768;
}
function sampleHeight(lon,lat) {
  const [tx,ty]=tileXY(lon,lat,TERR_Z);
  const x=Math.floor(tx),y=Math.floor(ty);
  const fx=(tx-x)*256-.5,fy=(ty-y)*256-.5;
  const i=Math.floor(fx),j=Math.floor(fy),u=fx-i,v=fy-j;
  const a=terrariumPixel(x,y,i,j),b=terrariumPixel(x,y,i+1,j);
  const c=terrariumPixel(x,y,i,j+1),d=terrariumPixel(x,y,i+1,j+1);
  return (a*(1-u)+b*u)*(1-v)+(c*(1-u)+d*u)*v;
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
// This scene needs a visually coherent city-scale surface, not the
// unsmoothed heightfield's steep pixel artifacts. Preserve source provenance,
// but explicitly label this as a VISUALIZATION-ONLY slope-limited DEM.
// Terrain is shared upstream by buildings, roads and all five render paths.
const terrainRawY=[];
for(let v=1;v<terrain.positions.length;v+=3)terrainRawY.push(terrain.positions[v]);
const terrainY=Float64Array.from(terrainRawY);
const EW=(east-west)*111320*cosLat/NX,NS=(north-south)*111320/NZ;
const sourceMaximumSlope=.18;
const neighborhood=[[1,0,EW],[0,1,NS],[1,-1,Math.hypot(EW,NS)]];
let gradientPasses=0,maxGradient=0;
for(let pass=0;pass<1200;pass++){
  let violation=0;
  for(let j=0;j<=NZ;j++)for(let i=0;i<=NX;i++){
    const at=j*(NX+1)+i;
    for(const [di,dj,meters] of neighborhood){
      const ni=i+di,nj=j+dj;
      if(ni<0||ni>NX||nj<0||nj>NZ)continue;
      const next=nj*(NX+1)+ni;
      const allowed=sourceMaximumSlope*meters;
      const difference=terrainY[at]-terrainY[next];
      const over=Math.abs(difference)-allowed;
      if(over>0){
        const correction=Math.sign(difference)*over/2;
        terrainY[at]-=correction;
        terrainY[next]+=correction;
        violation=Math.max(violation,over);
      }
    }
  }
  gradientPasses++;
  if(violation<1e-5)break;
}
let terrainElevationChanged=0,terrainElevationMaxAdjustment=0;
for(let i=0;i<terrainY.length;i++){
  const shift=terrainY[i]-terrainRawY[i];
  terrainElevationChanged+=Math.abs(shift)>.01?1:0;
  terrainElevationMaxAdjustment=Math.max(terrainElevationMaxAdjustment,Math.abs(shift));
  terrain.positions[i*3+1]=terrainY[i];
}
for(let j=0;j<=NZ;j++)for(let i=0;i<=NX;i++){
  const at=j*(NX+1)+i;
  for(const [di,dj,meters] of neighborhood){
    const ni=i+di,nj=j+dj;
    if(ni<0||ni>NX||nj<0||nj>NZ)continue;
    maxGradient=Math.max(maxGradient,Math.abs(terrainY[at]-terrainY[nj*(NX+1)+ni])/meters);
  }
}
if(maxGradient>sourceMaximumSlope+.0005)throw new Error('Terrain slope limiter did not converge: '+maxGradient);
// Exactly sample the rendered two-triangle surface for plain-mode buildings.
function terrainHeight(lon,lat){
  const fx=clamp((lon-west)/(east-west)*NX,0,NX-1e-7);
  const fz=clamp((lat-south)/(north-south)*NZ,0,NZ-1e-7);
  const i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j;
  const h=(x,z)=>terrain.positions[(z*(NX+1)+x)*3+1];
  const a=h(i,j),b=h(i+1,j),c=h(i,j+1),d=h(i+1,j+1);
  return u+v<=1?a*(1-u-v)+b*u+c*v:d*(u+v-1)+b*(1-v)+c*(1-u);
}
const terrainAudit={
  sourceSampleMethod:'Terrarium RGB, bilinear source-pixel-center interpolation',
  visualHeightfieldFilter:'neighbor edge slope limiting; VISUALIZATION ONLY, NOT surveyed heights',
  outputMaximumSlope:sourceMaximumSlope,observedMaximumSlope:maxGradient,
  filterIterations:gradientPasses,terrainChangedVertices:terrainElevationChanged,
  maxHeightAdjustmentMeters:terrainElevationMaxAdjustment,
  warning:'Do not use these filtered terrain elevations for engineering, navigation or surveying'
};
console.log('TERRAIN_SLOPE_AUDIT',JSON.stringify(terrainAudit));

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
  const floor=terrainHeight(centerLon,centerLat);
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
    areaLabel:'Seoul Gangnam / Yeoksam Teheran-ro',demSource:'AWS Mapzen Terrarium',terrainAudit,
    bbox:BBOX,center:[lon0,lat0],terrainZoom:TERR_Z,terrainGrid:[NX+1,NZ+1],
    demInterpolation:'bilinear on pixel centers across adjacent Terrarium tiles',
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
