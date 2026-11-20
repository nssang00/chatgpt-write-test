import fs from 'node:fs';
const f=JSON.parse(fs.readFileSync('public/fixture-detailed.json','utf8'));
const targets=['road','road-edge','road-marking','terrain'];
const metric={};
for(const name of targets){
  const m=name==='terrain'?f.terrain:f.surfaces[name];
  if(!m){metric[name]={missing:true};continue}
  const p=m.positions,idx=m.indices;
  let maxEdge=0,maxSpan=0,maxArea=0,maxVert=0;
  const longEdges=[],largeAreas=[],bad=[];
  const pctData=[];
  for(let k=0;k<idx.length;k+=3){
    const a=idx[k]*3,b=idx[k+1]*3,c=idx[k+2]*3;
    const xs=[p[a],p[b],p[c]],ys=[p[a+1],p[b+1],p[c+1]],zs=[p[a+2],p[b+2],p[c+2]];
    const ab=Math.hypot(xs[0]-xs[1],ys[0]-ys[1],zs[0]-zs[1]);
    const bc=Math.hypot(xs[1]-xs[2],ys[1]-ys[2],zs[1]-zs[2]);
    const ca=Math.hypot(xs[2]-xs[0],ys[2]-ys[0],zs[2]-zs[0]);
    const edge=Math.max(ab,bc,ca);
    const area=Math.abs((xs[1]-xs[0])*(zs[2]-zs[0])-(zs[1]-zs[0])*(xs[2]-xs[0]))*.5;
    const yspan=Math.max(...ys)-Math.min(...ys);
    maxEdge=Math.max(maxEdge,edge);maxArea=Math.max(maxArea,area);maxVert=Math.max(maxVert,yspan);
    if(!Number.isFinite(edge)||!Number.isFinite(area))bad.push(k/3);
    if(edge>50 && longEdges.length<15)longEdges.push({triangle:k/3,edge:Math.round(edge*10)/10,area:Math.round(area*10)/10,yspan:Math.round(yspan*10)/10,xyz:[xs,ys,zs]});
    if(area>100 && largeAreas.length<15)largeAreas.push({triangle:k/3,edge:Math.round(edge),area:Math.round(area)});
    pctData.push(edge);
  }
  pctData.sort((a,b)=>a-b);
  metric[name]={triangles:idx.length/3,maxEdge,maxArea,maxVert,
    edgeP50:pctData[Math.floor(pctData.length*.5)]||0,
    edgeP95:pctData[Math.floor(pctData.length*.95)]||0,
    edgeP99:pctData[Math.floor(pctData.length*.99)]||0,
    edgesOver50:pctData.filter(x=>x>50).length,
    largeAreas,bad,longEdges};
}
console.log('ROAD_GEOMETRY_AUDIT '+JSON.stringify(metric));
await fs.promises.mkdir('results',{recursive:true});
await fs.promises.writeFile('results/road-geometry-audit.json',JSON.stringify(metric,null,2));
if(Object.values(metric).some(m=>m.bad?.length))process.exitCode=2;
