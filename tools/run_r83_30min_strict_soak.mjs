// R83 physical 32-source 30min soak; no presented-FPS claim.
// Windows WDDM GPU per-process counters are optional/explicitly indicated.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]||'candidate'),out=resolve(process.argv[3]||'artifacts/r83-soak30');
const duration=Number(process.env.R83_SOAK_DURATION_MS||1800000);
if(!Number.isInteger(duration)||duration<1800000)throw Error('Release soak must be at least 30 minutes');
const {chromium}=await import(pathToFileURL(join(root,'node_modules/playwright/index.mjs')).href);
const result={schema:'r83-physical-strict-thirty-minute-soak-v1',
  sourceSha:process.env.R83_CANDIDATE_SHA||null,requestedDurationMs:duration,
  browser:'physical RTX 5060 Ti, Chrome headless',note:'rAF != physical display FPS; nvidia-smi global VRAM is NOT per-process',
  chunks:[],processGpuSamples:[],errors:[],pass:false,perProcessGpuMemoryVerified:false};
await mkdir(out,{recursive:true});
const server=spawn(process.execPath,[join(root,'examples/compare/serve.mjs')],{
 cwd:root,env:{...process.env,OLVT_EXAMPLE_PORT:'4241'},stdio:'pipe'});
let browser=null,serverError='';
server.stderr.on('data',d=>serverError+=String(d));server.stdout.on('data',d=>serverError+=String(d));
const nap=ms=>new Promise(r=>setTimeout(r,ms));
const requireTrue=(ok,message)=>{if(!ok)throw Error(message)};
const exec=promisify(execFile);
const psScript=`
$ErrorActionPreference='Continue'
$procs=@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Select-Object ProcessId,ParentProcessId,CommandLine)
$memory=@(Get-Process chrome -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64)
$raw=Get-Counter '\\GPU Process Memory(*)\\Local Usage' -ErrorAction SilentlyContinue
$counters=@()
if($raw){$counters=@($raw.CounterSamples | ForEach-Object { [pscustomobject]@{path=$_.Path;bytes=$_.CookedValue} })}
$nvidia=& nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>$null
[ordered]@{timestampUtc=[DateTime]::UtcNow.ToString('o');processes=$procs;memory=$memory;gpuProcessMemoryCounters=$counters;nvidiaGlobalUsedMiB=$nvidia} | ConvertTo-Json -Compress -Depth 5
`;
async function sampleProcesses(){
 try{
  const {stdout}=await exec('powershell.exe',['-NoProfile','-Command',psScript],{
   windowsHide:true,maxBuffer:4*1024*1024,timeout:18000});
  const x=JSON.parse(stdout.trim());
  // WDDM counters may include other browser instances. Retain raw PID-tagged
  // counters and process trees, but do not assert that global VRAM belongs to us.
  return x;
 }catch(e){return {error:String(e)}}
}
try{
 let up=false;
 for(let i=0;i<170;i++){
  if(server.exitCode!==null)throw Error('Server stopped '+serverError);
  try{if((await fetch('http://127.0.0.1:4241/examples/webgl-vector-tiles-benchmark/index.html')).ok){up=true;break}}catch{}
  await nap(150);
 }
 requireTrue(up,'Server unavailable '+serverError);
 browser=await chromium.launch({executablePath:process.env.M5_BROWSER||
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
   headless:true,args:['--enable-webgl','--disable-software-rasterizer',
     '--enable-precise-memory-info','--disable-background-networking']});
 const page=await browser.newPage({viewport:{width:1100,height:700},deviceScaleFactor:1});
 const pageErrors=[];
 page.on('pageerror',e=>pageErrors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')pageErrors.push(m.text())});
 await page.route('**/favicon.ico',route=>route.fulfill({status:204,body:''}));
 await page.goto('http://127.0.0.1:4241/examples/webgl-vector-tiles-benchmark/index.html?renderer=boost&count=32&check=strict',
   {waitUntil:'domcontentloaded',timeout:65000});
 await page.waitForFunction(()=>window.__webglExampleBenchmark?.ready===true||
   window.__webglExampleBenchmark?.errors?.length>0,null,{timeout:65000});
 const initial=await page.evaluate(()=>{
  const s=window.__webglExampleBenchmark,b=s.map.boost,gl=b?.backend.gl;
  const ext=gl?.getExtension('WEBGL_debug_renderer_info');
  return {ready:s.ready,errors:s.errors,loaded:s.loadedCount,exclusive:b?.exclusiveActive,
    mode:b?.backend?.glErrorCheckMode,tiles:b?.snapshot()?.tileCount,
    glError:b?.snapshot()?.frameStats?.glError,
    gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null};
 });
 result.initial=initial;
 requireTrue(initial.ready&&initial.exclusive&&initial.mode==='strict'&&initial.loaded>=32&&
  initial.tiles>=32&&initial.glError===0&&/NVIDIA.*RTX 5060 Ti/i.test(initial.gpu||'')&&
  initial.errors.length===0,'Cannot start RTX strict soak '+JSON.stringify(initial));
 const started=Date.now();
 while(Date.now()-started<duration){
  const ms=Math.min(60000,duration-(Date.now()-started));
  if(ms<100)break;
  const c=await page.evaluate(async ms=>{
   const state=window.__webglExampleBenchmark,map=state.map,view=state.view,
      b=map.boost,center=[...view.getCenter()],started=performance.now();
   const original=state.errors.length,first=b.scene.frames,
     firstHeap=performance.memory?.usedJSHeapSize??null,intervals=[];
   let i=0,previous=null,submissionSum=0,maxSubmission=0;
   while(performance.now()-started<ms){
    const stamp=await new Promise(resolve=>requestAnimationFrame(resolve));
    if(previous!==null)intervals.push(stamp-previous);
    previous=stamp;
    view.setCenter([center[0]+(i%3===0?512:i%3===1?-512:0),center[1]]);
    const t=performance.now();map.renderSync();
    const submit=performance.now()-t;
    submissionSum+=submit;maxSubmission=Math.max(maxSubmission,submit);i++;
   }
   view.setCenter(center);map.renderSync();
   const snap=b.snapshot(),sorted=intervals.sort((a,b)=>a-b);
   return {wallMs:performance.now()-started,iterations:i,sceneFrames:b.scene.frames-first,
    tileCount:snap.tileCount,programs:b.backend.programs.size,
    errorChecked:snap.frameStats?.glErrorChecked,glError:snap.frameStats?.glError,
    errors:state.errors.slice(original),heapBeforeBytes:firstHeap,
    heapAfterBytes:performance.memory?.usedJSHeapSize??null,
    rafP50Ms:sorted[Math.floor((sorted.length-1)*.5)]??null,
    rafP95Ms:sorted[Math.ceil(sorted.length*.95)-1]??null,
    submitMeanMs:submissionSum/Math.max(1,i),submitMaxMs:maxSubmission};
  },ms);
  result.chunks.push(c);
  result.processGpuSamples.push(await sampleProcesses());
  requireTrue(!pageErrors.length&&!c.errors.length&&c.iterations>=10&&
   c.sceneFrames>=c.iterations&&c.tileCount>=32&&c.programs>0&&
   c.errorChecked===true&&c.glError===0,
   'Soak failed at chunk '+result.chunks.length+': '+JSON.stringify({c,pageErrors}));
  console.log('R83_30MIN_SOAK_CHUNK',JSON.stringify({i:result.chunks.length,
   wallMs:c.wallMs,iterations:c.iterations,glError:c.glError,
   p95Raf:c.rafP95Ms,heapBytes:c.heapAfterBytes}));
 }
 result.wallMs=Date.now()-started;
 result.pass=result.wallMs>=duration&&result.chunks.length>=30&&result.errors.length===0;
 // Explicitly conservative: a GPU local usage counter is not enough by itself;
 // Chrome child PID attribution must be reviewed to validate process GPU memory.
 result.perProcessGpuMemoryVerified=false;
 result.perProcessGpuMemoryReason='Raw WDDM PID-tagged counters saved, but process ownership and GPU-process attribution require independent audit.';
}catch(e){result.errors.push(String(e?.stack||e));console.error('R83_30MIN_SOAK_FAILED',result.errors.at(-1))}
finally{
 await writeFile(join(out,'summary.json'),JSON.stringify(result,null,2)+'\n');
 try{await browser?.close()}catch{}
 if(server.exitCode===null){server.kill();await nap(250);}
}
console.log('R83_30MIN_SOAK_SUMMARY',JSON.stringify({pass:result.pass,elapsedMs:result.wallMs,
 chunks:result.chunks.length,perProcessGpuMemoryVerified:result.perProcessGpuMemoryVerified,errors:result.errors}));
if(!result.pass)process.exitCode=1;
