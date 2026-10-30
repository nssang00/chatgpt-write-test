/** Physical R75 bounded pan/zoom/resize and host-controlled rollback stress gate. */
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]||'.'),out=resolve(process.argv[3]||join(root,'artifacts/r75-stress'));
const {chromium}=await import(pathToFileURL(join(root,'node_modules/playwright/index.mjs')).href);
await mkdir(out,{recursive:true});
const summary={schema:'r75-physical-bounded-interaction-v1',candidate:'5bbc2c1080db759f2bbc03a5d241dbc8cec7a91d',
  cycles:150,raw:[],errors:[],pass:false,limitations:['150 synthetic viewport interactions, not an hours-long soak',
  'renderSync duration is not user-visible latency or sustained FPS','JS heap and tracked GPU bytes are telemetry, not proof of leak freedom']};
const port=4183,base='http://127.0.0.1:'+port,server=spawn(process.execPath,[join(root,'examples/compare/serve.mjs')],{cwd:root,env:{...process.env,OLVT_EXAMPLE_PORT:String(port)},stdio:'pipe'});
let output='',browser,page;server.stdout.on('data',b=>output+=b.toString());server.stderr.on('data',b=>output+=b.toString());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(v,msg)=>{if(!v)throw Error(msg)};
try{
  let ready=false;
  for(let n=0;n<90;n++){if(server.exitCode!==null)throw Error('server exit '+output);try{if((await fetch(base+'/examples/compare/')).ok){ready=true;break}}catch{}await sleep(150)}
  check(ready,'server not ready '+output);
  browser=await chromium.launch({executablePath:process.env.M5_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',
   headless:true,args:['--enable-webgl','--disable-software-rasterizer','--disable-background-networking','--enable-precise-memory-info','--window-size=600,600']});
  page=await browser.newPage({viewport:{width:560,height:560},deviceScaleFactor:1});
  await page.route('**/favicon.ico',route=>route.fulfill({status:204,body:''}));
  page.on('pageerror',e=>summary.errors.push('pageerror '+String(e)));
  page.on('console',m=>{if(m.type()==='error')summary.errors.push('console '+m.text())});
  await page.goto(base+'/examples/perf/index.html?arm=boost&count=32&mode=exclusive-fbo',{waitUntil:'domcontentloaded',timeout:40000});
  await page.waitForFunction(()=>globalThis.__r70?.done===true,{timeout:42000});
  const before=await page.evaluate(()=>{
    const r=globalThis.__r75runtime,b=r.boost.scene;
    const ext=r.backend.gl.getExtension('WEBGL_debug_renderer_info');
    return {ready:globalThis.__r70.ready,loaded:globalThis.__r70.loadedSources,
      renderer:ext?r.backend.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,
      frames:b.frames,fbo:!!b._layerFbo,quad:!!b._layerFboQuad,trackedBytes:b.resourceManager.stats().totalTrackedGpuBytes};
  });summary.before=before;
  check(before.ready&&before.loaded===32&&before.fbo&&before.quad,'invalid initial scene '+JSON.stringify(before));
  check(/NVIDIA.*RTX 5060 Ti/i.test(before.renderer||''),'not physical GPU '+before.renderer);
  const result=await page.evaluate(async()=>{
    const r=globalThis.__r75runtime,b=r.boost.scene,gl=r.backend.gl,root=document.getElementById('map');
    const quad=b._layerFboQuad,items=[],dims=[512,480,496,512,504];
    for(let i=0;i<150;i++){
      const view=r.map.getView(),shift=(i%7)-3;
      view.setCenter([16384+shift*50,8192+shift*35]);
      view.setResolution(64*(1+((i%5)-2)*0.015));
      const width=dims[i%5];root.style.width=width+'px';root.style.height=width+'px';
      r.map.updateSize();
      const t=performance.now();r.map.renderSync();const ms=performance.now()-t;
      const err=gl.getError();
      const stats=b.resourceManager.stats();
      const heap=performance.memory?.usedJSHeapSize??null;
      const row={i,ms:Number(ms.toFixed(3)),frames:b.frames,packets:b.lastSchedule.length,glError:err,
        width:b._layerFbo?.width??null,height:b._layerFbo?.height??null,
        quadReused:b._layerFboQuad===quad,trackedGpuBytes:stats.totalTrackedGpuBytes,
        jsHeapBytes:heap,failed:r.boost.failed,active:r.boost.exclusiveActive};
      items.push(row);
      if(i%20===0)await new Promise(ok=>requestAnimationFrame(()=>ok()));
    }
    return items;
  });
  summary.raw=result;
  const invalid=result.filter(x=>x.glError!==0||!x.quadReused||x.failed||!x.active||x.frames<=before.frames||x.packets<1||x.width!==x.height);
  check(result.length===150&&invalid.length===0,'interaction failures '+JSON.stringify(invalid.slice(0,5)));
  const lat=result.map(x=>x.ms).sort((a,b)=>a-b),pct=p=>lat[Math.min(lat.length-1,Math.ceil(p*lat.length)-1)];
  summary.metrics={medianRenderSyncMs:pct(.5),p95RenderSyncMs:pct(.95),p99RenderSyncMs:pct(.99),
    maximumRenderSyncMs:lat.at(-1),framesAdded:result.at(-1).frames-before.frames,
    trackedGpuBytesMin:Math.min(...result.map(x=>x.trackedGpuBytes)),trackedGpuBytesMax:Math.max(...result.map(x=>x.trackedGpuBytes)),
    firstHeapBytes:result[0].jsHeapBytes,lastHeapBytes:result.at(-1).jsHeapBytes};
  const hostRollback=await page.evaluate(()=>{
    const r=globalThis.__r75runtime,center=[...r.map.getView().getCenter()],resolution=r.map.getView().getResolution();
    r.boost.stop();r.canvas.style.display='none';r.map.renderSync();
    const end={started:r.boost.started,exclusive:r.boost.exclusiveActive,hidden:r.canvas.style.display==='none',
      centerPreserved:JSON.stringify(center)===JSON.stringify(r.map.getView().getCenter()),
      resolutionPreserved:resolution===r.map.getView().getResolution(),
      stockLayerCanvasCount:r.map.getTargetElement()?.querySelectorAll('canvas')?.length??0};
    return end;
  });summary.rollback=hostRollback;
  check(!hostRollback.started&&!hostRollback.exclusive&&hostRollback.hidden&&hostRollback.centerPreserved&&hostRollback.resolutionPreserved&&hostRollback.stockLayerCanvasCount>0,'host rollback failed '+JSON.stringify(hostRollback));
  check(summary.errors.length===0,'console errors '+JSON.stringify(summary.errors));
  summary.pass=true;
}catch(e){summary.errors.push(String(e?.stack||e));console.error('R75_BOUNDED_STRESS_FAIL',summary.errors.at(-1))}
finally{
  await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  try{await page?.close()}catch{}try{await browser?.close()}catch{}
  if(server.exitCode===null){server.kill();await sleep(500)}
}
console.log('R75_BOUNDED_STRESS_RESULT',JSON.stringify({pass:summary.pass,cycles:summary.raw.length,metrics:summary.metrics,rollback:summary.rollback,errors:summary.errors}));
if(!summary.pass)process.exitCode=1;
