import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]||'.');
async function change(path,anchor,replacement){
 const s=await readFile(path,'utf8');
 if(s.includes(replacement)){console.log('ALREADY_APPLIED',path);return;}
 if(!s.includes(anchor))throw Error('R30 fast stroke anchor missing: '+path);
 await writeFile(path,s.replace(anchor,replacement));
}
const pipeline=resolve(root,'our-renderer/integration/DirectFeatureWebGLPipeline.js');
const anchor='  const appendUnclippedFlatStrokeRing=(flat,start,end,stride)=>{';
const replacement=anchor+`
    if(globalThis.__m5R30FastStrokeRing===true){
      const n=(end-start)/stride;
      if(n<2)return null;
      const sx=Number(flat[start]),sy=Number(flat[start+1]);
      const endIndex=end-stride;
      const closed=sx===Number(flat[endIndex])&&sy===Number(flat[endIndex+1]);
      const count=n+(closed?0:1),instances=count-1;
      const joinClosed=globalThis.__m5R18ClosedRingJoin===true&&closed&&count>=4;
      const first=lineWriter.length/8,rollback=lineWriter.length;
      lineWriter.ensure(instances*8);
      const target=lineWriter.data;
      let targetOffset=rollback;
      for(let i=0,at=start;i<instances;i++,at+=stride){
        const offsetB=i+1===n?start:at+stride;
        const ax=Number(flat[at]),ay=Number(flat[at+1]);
        const bx=Number(flat[offsetB]),by=Number(flat[offsetB+1]);
        if(Math.fround(ax)===Math.fround(bx)&&Math.fround(ay)===Math.fround(by)){
          lineWriter.truncate(rollback);return null;
        }
        const offPrev=i?at-stride:(joinClosed?start+(count-2)*stride:start);
        const offNext=i+2<count?(i+2===n?start:start+(i+2)*stride):(joinClosed?start+stride:offsetB);
        target[targetOffset++]=flat[offPrev];target[targetOffset++]=flat[offPrev+1];
        target[targetOffset++]=ax;target[targetOffset++]=ay;
        target[targetOffset++]=bx;target[targetOffset++]=by;
        target[targetOffset++]=flat[offNext];target[targetOffset++]=flat[offNext+1];
      }
      lineWriter.length=targetOffset;
      counters.lineSegments+=instances;
      return [{first,count:instances,gpuJoin:true}];
    }
`;
await change(pipeline,anchor,replacement);
const page=resolve(root,'tests/round14_gpu_compare/round14_m5.html');
await change(page,'const validationQuery=new URL(location.href).searchParams;',
  "const validationQuery=new URL(location.href).searchParams;\nglobalThis.__m5R30FastStrokeRing=validationQuery.get('fastStroke')==='1';");
const runner=resolve(root,'tests/round14_gpu_compare/run_one.mjs');
await change(runner,'&partialEarcut=${flags.partialEarcut||0}',
  '&partialEarcut=${flags.partialEarcut||0}&fastStroke=${flags.fastStroke||0}');
console.log('R30_FAST_STROKE_OPTIN_PATCH_APPLIED');