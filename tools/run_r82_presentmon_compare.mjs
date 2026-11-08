// R82: independent Windows ETW PresentMon capture, unmodified R79 runtime.
// A compositor swapchain's display cadence is not automatically content FPS,
// and RDP output is NOT a physical-monitor scanout measurement.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]||'candidate');
const out=resolve(process.argv[3]||'artifacts/r82-presentmon');
const present=resolve(process.argv[4]||'PresentMon-2.6.0-x64.exe');
await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(join(root,'node_modules/playwright/index.mjs')).href);
const data={schema:'r82-presentmon-etw-display-compare-v1',candidateSha:process.env.R82_CANDIDATE_SHA??null,
  monitorScope:'Windows ETW desktop/RDP presentation; physical monitor scanout NOT verified',
  captureExe:'official Intel PresentMon v2.6.0 SHA256-pinned portable x64',
  cases:[],errors:[],pass:false};
const server=spawn(process.execPath,[join(root,'examples/compare/serve.mjs')],{
 cwd:root,env:{...process.env,OLVT_EXAMPLE_PORT:'4221'},stdio:'pipe'});
let logs='',browser=null;
server.stdout.on('data',b=>logs+=String(b));
server.stderr.on('data',b=>logs+=String(b));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const fail=(x,m)=>{if(!x)throw Error(m)};
function parseCsv(text){
 const rows=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
 if(rows.length<2)return {headers:rows[0]?.split(',')||[],rows:[]};
 const headers=rows[0].split(',').map(x=>x.trim().replace(/^"|"$/g,''));
 return {headers,rows:rows.slice(1).map(line=>{
   // This capture uses simple numeric metadata and does not require escaping multiline.
   const values=line.match(/(?:[^,"]+|"(?:[^"]|"")*")(?=,|$)|(?<=,)(?=,|$)/g)||line.split(',');
   const obj={};for(let i=0;i<headers.length;i++)
    obj[headers[i]]=(values[i]??'').replace(/^"|"$/g,'').trim();
   return obj;
 })};
}
function mean(a){return a.reduce((x,y)=>x+y,0)/(a.length||1)}
function pct(a,p){const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.ceil(s.length*p)-1]:null}
function samples(rows,key){
 const ns=rows.map(x=>Number(x[key])).filter(x=>Number.isFinite(x)&&x>0);
 return {n:ns.length,p50:pct(ns,.5),p95:pct(ns,.95),mean:ns.length?mean(ns):null};
}
try{
 let ready=false;
 for(let i=0;i<160;i++){
  if(server.exitCode!==null)throw Error('server exit '+logs);
  try{if((await fetch('http://127.0.0.1:4221/examples/webgl-vector-tiles-benchmark/index.html')).ok){ready=true;break}}catch{}
  await wait(180);
 }
 fail(ready,'server not ready '+logs);
 browser=await chromium.launch({executablePath:process.env.M5_BROWSER||
  'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,
  args:['--enable-webgl','--disable-software-rasterizer','--disable-background-networking']});
 for(const [index,mode] of ['stock','boost','boost','stock'].entries()){
  const page=await browser.newPage({viewport:{width:1100,height:700},deviceScaleFactor:1});
  let pm=null,pmExit=null,pmOut='',pmErr='';
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')pageErrors.push(m.text())});
  await page.route('**/favicon.ico',route=>route.fulfill({status:204,body:''}));
  try{
   await page.goto('http://127.0.0.1:4221/examples/webgl-vector-tiles-benchmark/index.html?renderer='+mode+'&count=32',
    {waitUntil:'domcontentloaded',timeout:65000});
   await page.waitForFunction(()=>window.__webglExampleBenchmark?.ready===true||
    window.__webglExampleBenchmark?.errors?.length>0,null,{timeout:65000});
   const state=await page.evaluate(()=>{
    const x=window.__webglExampleBenchmark;
    return {ready:x.ready,loaded:x.loadedCount,errors:x.errors,
     gpu:x.map?.boost?.backend?.gl?.getParameter(x.map.boost.backend.gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL)??null,
     exclusive:x.map?.boost?.exclusiveActive??null};
   });
   fail(state.ready&&state.loaded>=32&&!state.errors.length&&
    (mode==='stock'||state.exclusive===true),'incomplete scene '+JSON.stringify(state));
   const file=join(out,'presentmon-'+index+'-'+mode+'.csv');
   const args=['--output_file',file,
    '--timed','17','--terminate_after_timed','--v2_metrics','--write_display_metadata'];
   pm=spawn(present,args,{windowsHide:true,stdio:'pipe'});
   pm.stdout.on('data',x=>pmOut+=String(x));
   pm.stderr.on('data',x=>pmErr+=String(x));
   pmExit=new Promise(resolve=>{
     pm.once('error',e=>resolve({error:String(e),code:null}));
     pm.once('exit',(code,signal)=>resolve({code,signal}));
   });
   await wait(1600);
   const pan=await page.evaluate(async()=>{
    const s=window.__webglExampleBenchmark,view=s.view,map=s.map;
    const start=[...view.getCenter()],t=performance.now();
    let n=0,prior=null;const intervals=[];
    while(performance.now()-t<11000){
     const stamp=await new Promise(resolve=>requestAnimationFrame(resolve));
     if(prior!==null)intervals.push(stamp-prior);
     prior=stamp;
     view.setCenter([start[0]+(n%3===0?512:n%3===1?-512:0),start[1]]);
     map.renderSync();n++;
    }
    view.setCenter(start);map.renderSync();
    return {iterations:n,elapsedMs:performance.now()-t,
     rafMeanMs:meanNaN(intervals),rafP95Ms:quant(intervals,.95)};
    function meanNaN(a){return a.reduce((s,x)=>s+x,0)/Math.max(1,a.length)}
    function quant(a,p){a.sort((a,b)=>a-b);return a[Math.ceil(a.length*p)-1]??null}
   });
   const exit=await Promise.race([pmExit,wait(23000).then(()=>({timeout:true}))]);
   if(exit.timeout)try{pm.kill()}catch{}
   await writeFile(join(out,'presentmon-'+index+'-'+mode+'.log.txt'),
     'command: '+present+' '+args.join(' ')+'\n'+
     'exit: '+JSON.stringify(exit)+'\nSTDOUT\n'+pmOut+'\nSTDERR\n'+pmErr+'\n');
   let csv={headers:[],rows:[]},csvError=null;
   try{csv=parseCsv(await readFile(file,'utf8'))}catch(e){csvError=String(e)}
   const chromeRows=csv.rows.filter(row=>String(row.Application||'').toLowerCase().includes('chrome.exe'));
   const unknownRows=csv.rows.filter(row=>String(row.Application||'').includes('<unknown>'));
   const bySwapchain=new Map();
   for(const row of chromeRows){
     const key=[row.ProcessID??row.ProcessId??'',row.SwapChainAddress??''].join(':');
     const values=bySwapchain.get(key)||[];values.push(row);bySwapchain.set(key,values);
   }
   const grouped=[...bySwapchain.entries()].map(([key,rows])=>({
     key,frames:rows.length,displayedTime:samples(rows,'DisplayedTime'),
     gpuTime:samples(rows,'GPUTime'),gpuBusy:samples(rows,'GPUBusy'),
     presentModes:[...new Set(rows.map(r=>r.PresentMode||'').filter(Boolean))]}));
   grouped.sort((a,b)=>b.displayedTime.n-a.displayedTime.n);
   const best=grouped[0]||null;
   const caseResult={index,mode,state,pan,presentMon:{exit,csvError,
     csvRows:csv.rows.length,chromeRows:chromeRows.length,unknownRows:unknownRows.length,
     columns:csv.headers,streams:grouped,
     dominantSwapchain:best?.key??null,dominantDisplayTime:best?.displayedTime??null,
     // This is ETW swapchain display cadence only; do not call monitor/app FPS.
     observedSwapchainDisplayHz:best?.displayedTime?.mean?
       1000/best.displayedTime.mean:null},
     pageErrors,pmOutput:pmOut.slice(-1000),pmErrors:pmErr.slice(-1000)};
   data.cases.push(caseResult);
   console.log('R82_PM_CASE',JSON.stringify({index,mode,pan,
    exit,rows:csv.rows.length,dominant:best}));
  }finally{
   if(pm?.exitCode===null)try{pm.kill()}catch{}
   await page.close();
  }
 }
 data.pass=data.cases.length===4&&data.cases.every(c=>
  c.pageErrors.length===0&&c.state.errors.length===0&&
  c.presentMon.chromeRows>=50&&
  c.presentMon.dominantDisplayTime?.n>=50);
 data.displayCaptureVerified=data.pass;
}catch(e){data.errors.push(String(e?.stack||e));console.error('R82_PM_FAILED',data.errors.at(-1));}
finally{
 await writeFile(join(out,'summary.json'),JSON.stringify(data,null,2)+'\n');
 try{await browser?.close()}catch{}
 if(server.exitCode===null){server.kill();await wait(250)}
}
console.log('R82_PM_SUMMARY',JSON.stringify({pass:data.pass,errors:data.errors,
 cases:data.cases.map(c=>({mode:c.mode,rows:c.presentMon.csvRows,chromeRows:c.presentMon.chromeRows,
  displayedHz:c.presentMon.observedSwapchainDisplayHz,
  exit:c.presentMon.exit}))}));
if(!data.pass)process.exitCode=1;
