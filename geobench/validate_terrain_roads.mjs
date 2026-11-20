import fs from 'node:fs';
const detailed=JSON.parse(fs.readFileSync('public/fixture-detailed.json','utf8'));
const {metadata,terrain,surfaces}=detailed;
if(metadata.buildingCount<1000)throw Error('Expected real dense Seoul OSM fixture');
const repair=metadata.terrainRepair;
if(!repair || repair.filterMode!=='urban')throw Error('Urban DEM spike repair not activated');
if(repair.repaired.maxAdjacentGrade>.252)
  throw Error('Terrain still exceeds max modeled grade: '+JSON.stringify(repair.repaired));
if(repair.original.maxAdjacentGrade<.45)
  throw Error('Current test fixture does not exercise a severe raw DEM spike');
const summary={buildings:metadata.buildingCount,terrain:repair,roads:metadata.roadGeometryQuality,
  materials:{},failures:[]};
for(const name of ['road','road-edge','road-marking']){
  const mesh=surfaces[name];
  if(!mesh)throw Error('Missing road material '+name);
  const v=mesh.positions,idx=mesh.indices;
  let maxYSpan=0,maxGrade=0,maxHorizontalEdge=0,degenerated=0;
  let edgeGradeOver50pct=0,triangles=idx.length/3;
  for(let k=0;k<idx.length;k+=3){
    const vertex=n=>v.slice(idx[k+n]*3,idx[k+n]*3+3);
    const vtx=[vertex(0),vertex(1),vertex(2)];
    const yy=vtx.map(p=>p[1]);
    maxYSpan=Math.max(maxYSpan,Math.max(...yy)-Math.min(...yy));
    for(const [a,b] of [[0,1],[1,2],[2,0]]){
      const horiz=Math.hypot(vtx[a][0]-vtx[b][0],vtx[a][2]-vtx[b][2]);
      const vertical=Math.abs(vtx[a][1]-vtx[b][1]);
      maxHorizontalEdge=Math.max(maxHorizontalEdge,horiz);
      if(horiz>.01){
        const grade=vertical/horiz;
        maxGrade=Math.max(maxGrade,grade);
        if(grade>.50)edgeGradeOver50pct++;
      }
    }
    const a=vtx[0],b=vtx[1],c=vtx[2];
    const area2=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]));
    if(area2<1e-5)degenerated++;
  }
  const record={triangles,maxYSpan,maxGrade,maxHorizontalEdge,edgeGradeOver50pct,degenerated};
  summary.materials[name]=record;
  if(maxYSpan>12 || maxGrade>.50 || maxHorizontalEdge>45)
    summary.failures.push({name,reason:'road triangles steep/spiking/long',...record});
  if(degenerated>triangles*.005)
    summary.failures.push({name,reason:'too many degenerate road triangles',...record});
}
console.log('SEOUL_TERRAIN_ROAD_GEOMETRY_AUDIT',JSON.stringify(summary));
fs.mkdirSync('results',{recursive:true});
fs.writeFileSync('results/terrain-road-geometry-audit.json',JSON.stringify(summary,null,2));
if(summary.failures.length)process.exit(2);
