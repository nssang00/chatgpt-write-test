import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd(),path=join(root,'tests','round14_gpu_compare','round14_m5.html');
let src=await readFile(path,'utf8');
const needle="const backend=new WebGL1Backend(canvas,{gpuCompletionMode:'blocking'";
if(!src.includes(needle))throw Error('M5 backend anchor missing');
src=src.replace(needle,"canvas.getContext('webgl',{antialias:false,preserveDrawingBuffer:true});\n  "+needle);
await writeFile(path,src);
console.log('M5_WEBGL1_ANTIALIAS_FALSE_VARIANT_READY');
