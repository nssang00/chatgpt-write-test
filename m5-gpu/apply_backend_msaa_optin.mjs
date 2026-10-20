import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
const path=join(root,'our-renderer/backend/WebGL1Backend.js');
let s=await readFile(path,'utf8');
function once(a,b){if(s.split(a).length!==2)throw Error('Round14 backend anchor mismatch: '+a);s=s.replace(a,b)}
once("constructor(canvas,{gpuCompletionMode='submit',cacheBindings=true,profileTiming=false}={}){","constructor(canvas,{gpuCompletionMode='submit',cacheBindings=true,profileTiming=false,contextAntialias=null}={}){");
once("this.canvas=canvas; this.gl=canvas.getContext('webgl');","this.canvas=canvas; this.contextAntialias=contextAntialias; this.gl=canvas.getContext('webgl',contextAntialias===null?undefined:{antialias:contextAntialias});");
once("restoreContext(){ this.gl=this.canvas.getContext('webgl');","restoreContext(){ this.gl=this.canvas.getContext('webgl',this.contextAntialias===null?undefined:{antialias:this.contextAntialias});");
await writeFile(path,s);
const page=join(root,'tests/round14_gpu_compare/round14_m5.html');
s=await readFile(page,'utf8');
const a="const backend=new WebGL1Backend(canvas,{gpuCompletionMode:'blocking'";
const b="const backend=new WebGL1Backend(canvas,{contextAntialias:false,gpuCompletionMode:'blocking'";
if(s.split(a).length!==2)throw Error('Round14 M5 construction anchor mismatch');
await writeFile(page,s.replace(a,b));
console.log('R16_BACKEND_OPTIN_MSAA_OFF_PATCH_APPLIED');
