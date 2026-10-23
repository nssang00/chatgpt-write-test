/** Opt-in R45 real-browser RTX pixel parity, patched into a pristine R35 benchmark after apply_r45. */
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]||'.');
async function change(file,replacements){
 const path=join(root,file);let s=await readFile(path,'utf8');
 for(const [a,b] of replacements){
  const n=s.split(a).length-1;
  if(n!==1)throw Error('R45 instrumentation anchor count '+n+' in '+file+': '+a.slice(0,60));
  s=s.replace(a,b);
 }
 await writeFile(path,s);console.log('R45_GPU_INSTRUMENTED',file);
}
await change('tests/round14_gpu_compare/run_one.mjs',[
 ["args.push(url);","args.push(url+'&r45='+String(flags.r45||0)+'&r45Dpr='+String(flags.r45Dpr||1));"]
]);
const handover=[
 "r45Enabled?{enabled:true,workerSize:2,resolveTask:({source,tileKey})=>{",
 " const i=sources.indexOf(source);if(i<0)return null;",
 " const [,x,y]=tileKey.split('/').map(Number);",
 " return {tileKey,bytes:bytesByTile.get(x+'/'+y),extent:extent(x,y),",
 " layers:[{layer:spec[i].layer,style:spec[i].style}],",
 " options:{drawMode,partialEarcut:globalThis.__m5R29EarcutPartial,",
 " unclipped:validationClipMode==='legacy-unclipped',",
 " closedLineJoins:validationQuery.get('closedLineJoins')==='1',",
 " polygonStrokeFringePx:Number(validationQuery.get('polygonStrokeFringePx')||0),",
 " polygonInsideSegmentFastPath:!round12Baseline,polygonEarBBoxPrecheck:!round12Baseline}}",
 "}}:null"
].join('\n');
const probe=[
 "const coldToCapturedFrameMs=ms()-t0;",
 "let r45Evidence=null;",
 "if(r45Enabled){",
 " const handover=binding.deferredWorker;",
 " if(!handover)throw Error('R45 handover missing');",
 " await handover.whenIdle();",
 " const snap=handover.snapshot();",
 " if(snap.parityRejects!==0||snap.failures!==0||snap.workerRows!==spec.length*4||snap.groups!==spec.length*4)",
 "   throw Error('R45 Worker parity/dispatch gate failed '+JSON.stringify(snap));",
 " const stat=binding.renderFrame(frame);",
 " const after=rgbaFromCanvas(canvas);",
 " let differentChannels=0;",
 " for(let i=0;i<after.length;i++)if(after[i]!==canvasPixels[i])differentChannels++;",
 " if(differentChannels||stat.glError!==0)throw Error('R45 physical GPU pixel mismatch '+JSON.stringify({differentChannels,glError:stat.glError}));",
 " const e=backend.gl.getExtension('WEBGL_debug_renderer_info');",
 " const rendererName=backend.gl.getParameter(e?.UNMASKED_RENDERER_WEBGL||backend.gl.RENDERER);",
 " if(!/NVIDIA|RTX 5060 Ti/i.test(String(rendererName)))throw Error('Unexpected GPU renderer '+rendererName);",
 " r45Evidence={...snap,differentChannels,dpr:r45Dpr,rendererName,",
 " firstPaintPixelSHA256:(await imageStats(canvasPixels)).rgba8Sha256,",
 " afterWorkerPixelSHA256:(await imageStats(after)).rgba8Sha256};",
 "}"
].join('\n');
await change('tests/round14_gpu_compare/round14_m5.html',[
 ["const workerPoolMode=validationQuery.get('workerPool')||'off';",
  "const workerPoolMode=validationQuery.get('workerPool')||'off';\nconst r45Enabled=validationQuery.get('r45')==='1';\nconst r45Dpr=Number(validationQuery.get('r45Dpr')||1);\nif(![1,2].includes(r45Dpr))throw Error('Invalid R45 DPR');"],
 ["const frame={size:[512,512],pixelRatio:1,extent:[0,0,8192,8192]",
  "const frame={size:r45Dpr===2?[256,256]:[512,512],pixelRatio:r45Dpr,extent:[0,0,8192,8192]"],
 ["binding=await OpenLayersRendererBinding.createDirectScene({map,backend,vectorTileOptions:",
  "binding=await OpenLayersRendererBinding.createDirectScene({map,backend,deferredWorker:"+handover+",vectorTileOptions:"],
 ["const coldToCapturedFrameMs=ms()-t0;",probe],
 ["const s={setupMs:pad(setupMs)", "const s={...(r45Enabled?{r45:r45Evidence}:{}),setupMs:pad(setupMs)"],
 [" const pass=samples.every(s=>s.glError===0", " const pass=samples.every(s=>(!r45Enabled||(s.r45?.workerRows===spec.length*4&&s.r45?.differentChannels===0))&&s.glError===0"]
]);
