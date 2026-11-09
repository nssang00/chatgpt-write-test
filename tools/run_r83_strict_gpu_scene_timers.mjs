// R83: strict-default deployment GPU time for the unchanged OL 10.10.0 vs R79 Boost runtime.
// GPU queries are nonblocking and disjoint-aware. Stock uses multiple WebGL contexts:
// sum of context timer durations is NOT end-to-end GPU frame wall time.
// This does NOT measure monitor-presented FPS; see separate PresentMon gate.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=resolve(process.argv[2]||'candidate');
const out=resolve(process.argv[3]||'artifacts/r82-gpu-scenes');
await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(join(root,'node_modules/playwright/index.mjs')).href);
const port=4212, origin='http://127.0.0.1:'+port;
const output={schema:'r83-strict-webgl1-gpu-timer-v1',candidateSha:process.env.R83_CANDIDATE_SHA||null,
  layerCount:32,renderers:['stock','boost','boost','stock'],headless:false,
  metricCaveat:'Stock per-context elapsed times cannot be summed into actual GPU frame wall time or presented FPS',
  cases:[],errors:[],pass:false};
const server=spawn(process.execPath,[join(root,'examples/compare/serve.mjs')],{
  cwd:root,env:{...process.env,OLVT_EXAMPLE_PORT:String(port)},stdio:'pipe'});
let serverLogs='',browser=null;
server.stderr.on('data',b=>serverLogs+=b.toString());
server.stdout.on('data',b=>serverLogs+=b.toString());
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
function stats(v){
 const s=[...v].sort((a,b)=>a-b),n=s.length;
 return {n,p50Ms:n?s[Math.floor((n-1)*.5)]:null,
   p95Ms:n?s[Math.ceil(n*.95)-1]:null,
   meanMs:n?s.reduce((a,b)=>a+b,0)/n:null,
   minMs:n?s[0]:null,maxMs:n?s.at(-1):null};
}
try{
 let online=false;
 for(let i=0;i<150;i++){
  if(server.exitCode!==null)throw Error('server terminated '+serverLogs);
  try{if((await fetch(origin+'/examples/webgl-vector-tiles-benchmark/index.html')).ok){online=true;break}}catch{}
  await delay(160);
 }
 assert(online,'server not ready '+serverLogs);
 browser=await chromium.launch({
  executablePath:process.env.M5_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless:false,args:['--enable-webgl','--disable-software-rasterizer','--disable-background-networking']
 });
 for(const [index,mode] of output.renderers.entries()){
  const page=await browser.newPage({viewport:{width:1100,height:700},deviceScaleFactor:1});
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')pageErrors.push(m.text())});
  await page.route('**/favicon.ico',route=>route.fulfill({status:204,body:''}));
  await page.addInitScript(()=>{
   // Capture *all* WebGL1 contexts created by both stock and Boost.
   const native=HTMLCanvasElement.prototype.getContext;
   const contexts=[];
   Object.defineProperty(window,'__r82Contexts',{value:contexts});
   HTMLCanvasElement.prototype.getContext=function(type,...args){
    const ctx=native.call(this,type,...args);
    if((type==='webgl'||type==='experimental-webgl')&&ctx&&!contexts.includes(ctx))
     contexts.push(ctx);
    return ctx;
   };
  });
  try{
   await page.goto(origin+'/examples/webgl-vector-tiles-benchmark/index.html?renderer='+mode+'&count=32&check=strict',{
     waitUntil:'domcontentloaded',timeout:60000});
   await page.waitForFunction(()=>window.__webglExampleBenchmark?.ready===true
     ||window.__webglExampleBenchmark?.errors?.length>0,null,{timeout:70000});
   const result=await page.evaluate(async()=>{
    const s=window.__webglExampleBenchmark,map=s.map,b=map.boost;
    const contexts=window.__r82Contexts;
    const meta={loaded:s.loadedCount,boostActive:b?.exclusiveActive??null,
      boostPolicy:b?.backend?.glErrorCheckMode??null,boostTiles:b?.snapshot?.().tileCount??null,
      errors:s.errors,contextsFound:contexts.length};
    const diagnostic=[];
    const gls=contexts.map((gl,i)=>{
      const ext=gl.getExtension('EXT_disjoint_timer_query');
      const debug=gl.getExtension('WEBGL_debug_renderer_info');
      const renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;
      diagnostic.push({i,hasTimer:!!ext,renderer});
      return {gl,ext,i};
    });
    if(!s.ready||s.errors.length||s.loadedCount<32||
      (s.renderer==='boost'&&(!b?.exclusiveActive||b?.snapshot?.().tileCount<32)))
       throw Error('scene incomplete '+JSON.stringify(meta));
    if(gls.length<1||gls.some(g=>!g.ext))
       throw Error('WebGL GPU timer missing for at least one active context '+JSON.stringify(diagnostic));
    const center=[...s.view.getCenter()];
    const submissions=[];
    const samples=18;
    // Sample 18 full renderSync submissions with one timer per actual WebGL context.
    // Do not invoke gl.finish/getError/readPixels or synchronous query-result reads.
    for(let frame=0;frame<samples;frame++){
     await new Promise(resolve=>requestAnimationFrame(resolve));
     const entries=[];
     for(const {gl,ext,i} of gls){
      const q=ext.createQueryEXT();
      if(!q)throw Error('Cannot create timer query on context '+i);
      ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,q);
      entries.push({gl,ext,q,i});
     }
     s.view.setCenter([center[0]+((frame%3)-1)*512,center[1]]);
     const t0=performance.now();map.renderSync();
     const submitMs=performance.now()-t0;
     for(const entry of entries){
      entry.ext.endQueryEXT(entry.ext.TIME_ELAPSED_EXT);
      entry.gl.flush();
     }
     submissions.push({frame,submitMs,entries});
    }
    s.view.setCenter(center);map.renderSync();
    const deadline=performance.now()+9000;
    while(performance.now()<deadline){
      const unresolved=submissions.flatMap(s=>s.entries).filter(e=>e.ms===undefined&&
        !e.disjoint);
      if(!unresolved.length)break;
      await new Promise(resolve=>setTimeout(resolve,90));
      for(const e of unresolved){
       if(e.gl.getParameter(e.ext.GPU_DISJOINT_EXT)){e.disjoint=true;continue;}
       if(e.ext.getQueryObjectEXT(e.q,e.ext.QUERY_RESULT_AVAILABLE_EXT))
        e.ms=Number(e.ext.getQueryObjectEXT(e.q,e.ext.QUERY_RESULT_EXT))/1e6;
      }
    }
    const raw=submissions.map(x=>{
     const invalid=x.entries.some(e=>e.ms===undefined||e.disjoint);
     const durations=x.entries.filter(e=>e.ms!==undefined).map(e=>e.ms);
     return {frame:x.frame,submitMs:x.submitMs,contexts:x.entries.length,
       complete:!invalid,disjoint:x.entries.filter(e=>e.disjoint).length,
       missing:x.entries.filter(e=>e.ms===undefined&&!e.disjoint).length,
       gpuContextDurationsMs:durations,
       gpuContextSumMs:invalid?null:durations.reduce((a,b)=>a+b,0),
       gpuContextMaxMs:invalid?null:Math.max(...durations)};
    });
    for(const x of submissions)for(const e of x.entries)
      try{e.ext.deleteQueryEXT(e.q)}catch{}
    return {meta,diagnostic,raw};
   });
   const valid=result.raw.filter(x=>x.complete);
   assert(valid.length>=14,'Too many unresolved/disjoint timer queries '+JSON.stringify({
     mode,valid:valid.length,total:result.raw.length,meta:result.meta}));
   assert(!pageErrors.length,'Browser errors '+JSON.stringify(pageErrors));
   assert(mode==='stock'||(result.meta.boostActive&&result.meta.boostPolicy==='strict'),
     'Boost did not use strict default renderer');
   const row={index,mode,
     metadata:result.meta,contexts:result.diagnostic,
     validGpuSamples:valid.length,allGpuSamples:result.raw.length,
     cpuSubmission:stats(result.raw.map(v=>v.submitMs)),
     gpuContextSum:stats(valid.map(x=>x.gpuContextSumMs)),
     gpuContextMax:stats(valid.map(x=>x.gpuContextMaxMs)),
     raw:result.raw};
   output.cases.push(row);
   console.log('R83_GPU_CASE',JSON.stringify({index,mode,contexts:row.contexts.length,
     validGpuSamples:row.validGpuSamples,gpuSum:row.gpuContextSum,
     gpuMax:row.gpuContextMax,cpuSubmission:row.cpuSubmission}));
  }finally{await page.close()}
 }
 output.pass=output.cases.length===4&&output.errors.length===0;
}catch(e){
 output.errors.push(String(e?.stack||e));
 console.error('R83_GPU_SCENE_FAILED',output.errors.at(-1));
}finally{
 await writeFile(join(out,'summary.json'),JSON.stringify(output,null,2)+'\n');
 const rows=['mode,index,frame,contexts,valid,cpu_submit_ms,gpu_context_sum_ms,gpu_context_max_ms'];
 for(const c of output.cases)for(const x of c.raw)
  rows.push([c.mode,c.index,x.frame,x.contexts,x.complete,x.submitMs,
    x.gpuContextSumMs??'',x.gpuContextMaxMs??''].join(','));
 await writeFile(join(out,'raw-gpu-query-samples.csv'),rows.join('\n')+'\n');
 try{await browser?.close()}catch{}
 if(server.exitCode===null){server.kill();await delay(300);}
}
console.log('R83_GPU_SCENE_SUMMARY',JSON.stringify({pass:output.pass,
 cases:output.cases.map(c=>({mode:c.mode,contexts:c.contexts.length,valid:c.validGpuSamples,
  gpuSum:c.gpuContextSum,gpuMax:c.gpuContextMax})),errors:output.errors}));
if(!output.pass)process.exitCode=1;
