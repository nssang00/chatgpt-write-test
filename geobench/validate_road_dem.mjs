import fs from 'node:fs/promises';

// Validate the *actual generated* Seoul road surfaces, not only the small
// synthetic unit fixture. This checks the surface *inside* every triangle,
// since exactly draped vertices alone do not prove terrain conformance.
const scene=JSON.parse(await fs.readFile('public/fixture-detailed.json','utf8'));
const {bbox,center,terrainGrid}=scene.metadata;
const [west,south,east,north]=bbox, [lon0,lat0]=center;
const cosLat=Math.cos(lat0*Math.PI/180);
const project=(lon,lat)=>[(lon-lon0)*111320*cosLat,(lat-lat0)*111320];
const [nx,nz]=terrainGrid.map(n=>n-1);
const xmin=project(west,lat0)[0],xmax=project(east,lat0)[0];
const zmin=project(lon0,south)[1],zmax=project(lon0,north)[1];
const dx=(xmax-xmin)/nx,dz=(zmax-zmin)/nz;
const source=scene.terrain.positions;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function ground(x,z){
  const fx=clamp((x-xmin)/dx,0,nx-1e-7),fz=clamp((z-zmin)/dz,0,nz-1e-7);
  const i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j;
  const y=(di,dj)=>source[((j+dj)*(nx+1)+i+di)*3+1];
  return u+v<=1?y(0,0)*(1-u-v)+y(1,0)*u+y(0,1)*v:
    y(1,1)*(u+v-1)+y(1,0)*(1-v)+y(0,1)*(1-u);
}
const report={
  bbox,terrainGrid,terrainDiagonalMeters:Math.hypot(dx,dz),
  sourceRoadWays:scene.metadata.meshStats.roads,
  inputSource:scene.metadata.demSource,
  toleranceMeters:.01,
  materials:{}
};
let hasFailure=false;
for(const [name,offset] of [['road',.04],['road-edge',.025],['road-marking',.054]]){
  const mesh=scene.surfaces[name];
  if(!mesh)throw Error('Missing '+name+' material');
  let maxAbsError=0,maxEdge=0,badCoordinates=0,badArea=0,samples=0,outOfBounds=0;
  const v=mesh.positions,ind=mesh.indices;
  for(let i=0;i<ind.length;i+=3){
    const pts=[ind[i],ind[i+1],ind[i+2]].map(k=>v.slice(k*3,k*3+3));
    if(pts.some(p=>p.some(x=>!Number.isFinite(x)))){badCoordinates++;continue;}
    const [a,b,c]=pts;
    const area2=(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
    if(Math.abs(area2)<1e-8){badArea++;continue;}
    maxEdge=Math.max(maxEdge,
      Math.hypot(a[0]-b[0],a[2]-b[2]),
      Math.hypot(b[0]-c[0],b[2]-c[2]),
      Math.hypot(c[0]-a[0],c[2]-a[2]));
    for(const [u,w,t] of [[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]]){
      const x=u*a[0]+w*b[0]+t*c[0];
      const z=u*a[2]+w*b[2]+t*c[2];
      const height=u*a[1]+w*b[1]+t*c[1];
      maxAbsError=Math.max(maxAbsError,Math.abs(height-ground(x,z)-offset));
      if(x<xmin-.0001||x>xmax+.0001||z<zmin-.0001||z>zmax+.0001)outOfBounds++;
      samples++;
    }
  }
  const valid=samples>=100&&maxAbsError<=report.toleranceMeters&&
    maxEdge<=report.terrainDiagonalMeters+.001&&
    badCoordinates===0&&badArea===0&&outOfBounds===0;
  report.materials[name]={triangles:ind.length/3,samples,maxAbsError,maxEdge,
    badCoordinates,badArea,outOfBounds,pass:valid};
  hasFailure ||= !valid;
}
report.pass=!hasFailure;
await fs.mkdir('results',{recursive:true});
await fs.writeFile('results/road-dem-validation.json',JSON.stringify(report,null,2));
console.log('ROAD_DEM_REAL_SCENE_VALIDATION',JSON.stringify(report));
if(hasFailure)process.exitCode=1;
