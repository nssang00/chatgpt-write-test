import fs from 'node:fs/promises';
// Build a tiny ROAD-ONLY diagnostic scene from the exact source triangles.
// The three visual modes share camera and coordinates. No invented terrain
// or hidden remeshing for the debug images.
const fixture=JSON.parse(await fs.readFile('public/fixture-detailed.json','utf8'));
const focus=fixture.metadata.roadDebugFocus;
if(!focus?.every(Number.isFinite))throw Error('No surveyed? No: require actual OSM shared-node junction focus');
const [fx,fy,fz]=focus;
const radius=100;
function triangles(mesh){
  const result=[],indices=mesh.indices,p=mesh.positions;
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const x=(p[a]+p[b]+p[c])/3,z=(p[a+2]+p[b+2]+p[c+2])/3;
    if(Math.abs(x-fx)>radius||Math.abs(z-fz)>radius)continue;
    result.push(p[a]-fx,p[a+1]-fy,p[a+2]-fz,
      p[b]-fx,p[b+1]-fy,p[b+2]-fz,
      p[c]-fx,p[c+1]-fy,p[c+2]-fz);
  }
  return result;
}
const materials={terrain:triangles(fixture.terrain)};
for(const key of ['road-edge','road','road-marking']){
  const m=fixture.surfaces[key];
  if(!m)throw Error('Missing road diagnostic material '+key);
  materials[key]=triangles(m);
}
const counts=Object.fromEntries(Object.entries(materials).map(([name,p])=>[name,p.length/9]));
if(counts.terrain<30||counts.road<30||counts['road-marking']<3)
 throw Error('Diagnostic subscene misses actual road/terrain geometry '+JSON.stringify(counts));
const data={
  source:'exact original Terrarium DEM, no Gaussian filter, no roadbed earthworks',
  focus, radius, counts,
  colors:fixture.metadata.materialColors,materials,
  camera:{position:[90,125,85],target:[0,0,0],fov:46},
  limitation:'Shared OSM node and source DEM; bridge/tunnel vertical grades are not surveyed'
};
await fs.writeFile('public/road-debug-geometry.json',JSON.stringify(data));
await fs.mkdir('results',{recursive:true});
await fs.writeFile('results/road-debug-extract.json',JSON.stringify({
  focus,radius,counts,source:data.source,limitation:data.limitation
},null,2));
console.log('ROAD_DEBUG_EXTRACT_RESULT',JSON.stringify({focus,radius,counts}));
