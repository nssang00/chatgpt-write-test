import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
const file=join(root,'our-renderer/integration/DirectFeatureWebGLPipeline.js');
let s=await readFile(file,'utf8');
const anchor='  // Styles are normalized once for each feature;';
if(!s.includes(anchor))throw Error('Round18 source missing CPU helper anchor');
const helper=`  // Opt-in: read polygon stroke rings directly from flat feature coordinates.
  // Float32-degenerate segments fall back to original materialized CPU path.
  const appendUnclippedFlatStrokeRing=(flat,start,end,stride)=>{
    const sourceCount=(end-start)/stride;
    if(sourceCount<2)return null;
    const firstX=Number(flat[start]),firstY=Number(flat[start+1]);
    const lastX=Number(flat[end-stride]),lastY=Number(flat[end-stride+1]);
    const closed=firstX===lastX&&firstY===lastY;
    const count=sourceCount+(closed?0:1),instances=count-1;
    const readX=i=>Number(flat[(i===sourceCount?start:start+i*stride)]);
    const readY=i=>Number(flat[(i===sourceCount?start+1:start+i*stride+1)]);
    const first=lineWriter.length/8,rollback=lineWriter.length;
    lineWriter.ensure(instances*8);
    for(let i=0;i<instances;i++){
      const ax=readX(i),ay=readY(i),bx=readX(i+1),by=readY(i+1);
      if(Math.fround(ax)===Math.fround(bx)&&Math.fround(ay)===Math.fround(by)){
        lineWriter.truncate(rollback);return null;
      }
      const joinClosed=globalThis.__m5R18ClosedRingJoin===true&&closed&&count>=4;
      const prev=i?i-1:(joinClosed?count-2:0),next=i+2<count?i+2:(joinClosed?1:i+1);
      lineWriter.push8Reserved(readX(prev),readY(prev),ax,ay,bx,by,readX(next),readY(next));
    }
    counters.lineSegments+=instances;
    return [{first,count:instances,gpuJoin:true}];
  };
`;
s=s.replace(anchor,helper+anchor);
const before='              const direct=appendFlatClippedStrokeRing(flat,start,end,stride,strokeClipExtent);';
if(!s.includes(before))throw Error('Round18 direct stroke anchor missing');
s=s.replace(before,"              const direct=globalThis.__m5R18FlatUnclippedStroke===true&&strokeClipExtent===null?\n                appendUnclippedFlatStrokeRing(flat,start,end,stride):\n                appendFlatClippedStrokeRing(flat,start,end,stride,strokeClipExtent);");
await writeFile(file,s);
const page=join(root,'tests/round14_gpu_compare/round14_m5.html');
s=await readFile(page,'utf8');
const needle='globalThis.__m5R18PolygonStrokeUnclipped=true;';
if(!s.includes(needle))throw Error('Must enable Polygon stroke no CPU clipping');
await writeFile(page,s.replace(needle,'globalThis.__m5R18ClosedRingJoin=true;\nglobalThis.__m5R18FlatUnclippedStroke=true;\n'+needle));
console.log('ROUND18_FLAT_POLYGON_STROKE_DIRECT_READY');