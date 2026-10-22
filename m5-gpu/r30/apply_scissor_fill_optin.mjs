import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]||'.');
async function change(path,from,to){
 const source=await readFile(path,'utf8');
 if(source.includes(to)){console.log('ALREADY_APPLIED',path);return;}
 if(!source.includes(from))throw Error('R30 expected anchor missing: '+path+' '+from.slice(0,100));
 await writeFile(path,source.replace(from,to));
}
const pipeline=resolve(root,'our-renderer/integration/DirectFeatureWebGLPipeline.js');
const anchor='  const appendClippedMesh=(mesh,extent)=>{\n    const indexStart=indicesWriter.length;';
const modified=anchor+`
    // R30 experimental GPU scissor fill. Tile scissor still enabled in renderer.
    if(globalThis.__m5R30ScissorFill===true && validClipExtent(extent)){
      const x0=extent[0],y0=extent[1],x1=extent[2],y1=extent[3];
      for(let i=0;i+5<mesh.length;i+=6){
        const ax=mesh[i],ay=mesh[i+1],bx=mesh[i+2],by=mesh[i+3],cx=mesh[i+4],cy=mesh[i+5];
        if(Math.max(ax,bx,cx)<x0||Math.min(ax,bx,cx)>x1||
           Math.max(ay,by,cy)<y0||Math.min(ay,by,cy)>y1)continue;
        const offset=verticesWriter.length/2;
        verticesWriter.ensure(6);
        verticesWriter.push2Reserved(ax,ay);
        verticesWriter.push2Reserved(bx,by);
        verticesWriter.push2Reserved(cx,cy);
        indicesWriter.appendTriangle(offset);
      }
      return {indexStart,count:indicesWriter.length-indexStart};
    }
`;
await change(pipeline,anchor,modified);
const page=resolve(root,'tests/round14_gpu_compare/round14_m5.html');
await change(page,'const validationQuery=new URL(location.href).searchParams;',
  "const validationQuery=new URL(location.href).searchParams;\nglobalThis.__m5R30ScissorFill=validationQuery.get('scissorFill')==='1';");
const runner=resolve(root,'tests/round14_gpu_compare/run_one.mjs');
await change(runner,'&partialEarcut=${flags.partialEarcut||0}',
  '&partialEarcut=${flags.partialEarcut||0}&scissorFill=${flags.scissorFill||0}');
console.log('R30_SCISSOR_FILL_OPTIN_PATCH_APPLIED');