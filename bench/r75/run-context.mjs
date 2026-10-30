/** R75 actual Chromium/RTX WEBGL_lose_context recovery. Not a mock GL lifecycle test. */
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=resolve(process.argv[2]||'.'),out=resolve(process.argv[3]||join(root,'artifacts/r75-context'));
const sha='5bbc2c1080db759f2bbc03a5d241dbc8cec7a91d';
const {chromium}=await import(pathToFileURL(join(root,'node_modules/playwright/index.mjs')).href);
await mkdir(out,{recursive:true});
const report={schema:'r75-real-webgl-loss-v1',candidate:sha,mode:'exclusive-fbo',sources:32,cycles:[],errors:[],pass:false};
const port=4182,base='http://127.0.0.1:'+port;
const server=spawn(process.execPath,[join(root,'examples/compare/serve.mjs')],{cwd:root,env:{...process.env,OLVT_EXAMPLE_PORT:String(port)},stdio:'pipe'});
let browser,page,output='';
server.stdout.on('data',x=>output+=x.toString()); server.stderr.on('data',x=>output+=x.toString());
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
const check=(value,message)=>{if(!value)throw Error(message)};
async function screenshotAudit(label) {
  const png=await page.screenshot({path:join(out,label+'.png'),clip:{x:0,y:0,width:512,height:512}});
  const audit=await page.evaluate(async data=>{
    const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();
    const cv=document.createElement('canvas');cv.width=512;cv.height=512;
    const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    const p=ctx.getImageData(0,0,512,512).data;
    let colored=0;const colors=new Set();
    for(let i=0;i<p.length;i+=4){
      if(p[i]!==11||p[i+1]!==18||p[i+2]!==32)colored++;
      if(i%64===0)colors.add(p[i]+','+p[i+1]+','+p[i+2]);
    }
    return {colored,uniqueSampledColors:colors.size};
  },png.toString('base64'));
  check(audit.colored>30&&audit.uniqueSampledColors>=3,'Blank canvas at '+label+' '+JSON.stringify(audit));
  return audit;
}
try{
  let live=false;
  for(let i=0;i<90;i++){
    if(server.exitCode!==null)throw Error('server exited '+output);
    try{const r=await fetch(base+'/examples/compare/');if(r.ok){live=true;break;}}catch{}
    await sleep(150);
  }
  check(live,'server unavailable '+output);
  browser=await chromium.launch({executablePath:process.env.M5_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless:true,args:['--enable-webgl','--disable-software-rasterizer','--disable-background-networking','--window-size=560,580']});
  page=await browser.newPage({viewport:{width:512,height:512},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push('pageerror: '+String(e)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push('console: '+m.text())});
  await page.goto(base+'/examples/perf/index.html?arm=boost&count=32&mode=exclusive-fbo',{waitUntil:'domcontentloaded',timeout:40000});
  await page.waitForFunction(()=>globalThis.__r70?.done===true,{timeout:42000});
  const initial=await page.evaluate(()=>{
    const s=globalThis.__r70,r=globalThis.__r75runtime;
    const ext=r?.backend.gl.getExtension('WEBGL_debug_renderer_info');
    return {ready:s.ready,errors:s.errors,loaded:s.loadedSources,packets:s.packets,frames:s.frames,
      workerOff:s.workerOff,glError:r?.backend.gl.getError(),fbo:!!r?.boost.scene._layerFbo,
      quad:!!r?.boost.scene._layerFboQuad,
      renderer:ext?r.backend.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,
      contextExtension:!!r?.backend.gl.getExtension('WEBGL_lose_context')};
  });
  report.initial=initial;
  check(initial.ready&&initial.errors.length===0&&initial.loaded===32&&initial.packets>0&&initial.workerOff,'invalid initial Boost state '+JSON.stringify(initial));
  check(/NVIDIA.*RTX 5060 Ti/i.test(initial.renderer||''),'not physical RTX '+initial.renderer);
  check(initial.contextExtension,'WEBGL_lose_context unavailable');
  check(initial.fbo&&initial.quad,'per-layer compositor FBO was not used');
  check(initial.glError===0,'initial GL error '+initial.glError);
  report.initialPixels=await screenshotAudit('before-loss');
  for(let cycle=1;cycle<=2;cycle++){
    const prior=await page.evaluate(()=>({frames:__r75runtime.boost.scene.frames,oldFbo:__r75runtime.boost.scene._layerFbo?.framebuffer}));
    const lost=await page.evaluate(async()=>{
      const r=globalThis.__r75runtime,cv=r.canvas,gl=r.backend.gl;
      let eventSeen=false;
      const lostEvt=event=>{event.preventDefault();eventSeen=true};
      cv.addEventListener('webglcontextlost',lostEvt,{once:true});
      const ext=gl.getExtension('WEBGL_lose_context');
      if(!ext)throw Error('missing WEBGL_lose_context');
      ext.loseContext();
      await new Promise((resolve,reject)=>{let n=0;const tick=()=>eventSeen?resolve():++n>60?reject(Error('no webglcontextlost event')):setTimeout(tick,100);tick()});
      if(!gl.isContextLost())throw Error('GL context did not become lost');
      // Product contract: the host notifies ResourceManager when context is lost.
      r.boost.scene.resourceManager.handleContextLost();
      return {lostEvent:eventSeen,glLost:gl.isContextLost()};
    });
    const restored=await page.evaluate(async()=>{
      const r=globalThis.__r75runtime,cv=r.canvas,gl=r.backend.gl;
      let eventSeen=false;cv.addEventListener('webglcontextrestored',()=>{eventSeen=true},{once:true});
      const ext=gl.getExtension('WEBGL_lose_context');ext.restoreContext();
      await new Promise((resolve,reject)=>{let n=0;const tick=()=>eventSeen?resolve():++n>100?reject(Error('no webglcontextrestored event')):setTimeout(tick,100);tick()});
      r.backend.restoreContext();
      const rebuilt=r.boost.restoreAfterContextLoss(r.backend);
      r.map.renderSync();r.map.render();
      return {restoredEvent:eventSeen,contextLost:r.backend.gl.isContextLost(),rebuilt};
    });
    await page.waitForFunction(previous=>{
      const r=globalThis.__r75runtime;
      return r?.boost.scene.frames>previous&&!!r.boost.scene._layerFbo&&!!r.boost.scene._layerFboQuad;
    },prior.frames,{timeout:15000});
    const after=await page.evaluate(()=>{
      const r=globalThis.__r75runtime,b=r.boost.scene,gl=r.backend.gl;
      return {frames:b.frames,packets:b.snapshot().drawPackets,glError:gl.getError(),
        contextLost:gl.isContextLost(),fbo:!!b._layerFbo,quad:!!b._layerFboQuad,
        failed:r.boost.failed,exclusive:r.boost.exclusiveActive,workerOff:b.deferredWorker===null};
    });
    const pixels=await screenshotAudit('after-loss-'+cycle);
    report.cycles.push({cycle,lost,restored,after,pixels});
    check(lost.lostEvent&&lost.glLost&&restored.restoredEvent&&!restored.contextLost,'missing actual loss/restoration events');
    check(after.frames>prior.frames&&after.packets>0&&after.fbo&&after.quad&&!after.contextLost&&after.glError===0,'GPU failed to redraw after restoration '+JSON.stringify(after));
    check(!after.failed&&after.exclusive&&after.workerOff,'exclusive host failed unexpectedly '+JSON.stringify(after));
    console.log('R75_REAL_GL_CONTEXT_CYCLE_PASS',cycle,JSON.stringify({lost,restored,after,pixels}));
  }
  check(!report.errors.length,'browser errors '+JSON.stringify(report.errors));
  report.pass=report.cycles.length===2;
}catch(e){report.errors.push(String(e?.stack||e));console.error('R75_REAL_GL_CONTEXT_FAIL',report.errors.at(-1))}
finally{
  await writeFile(join(out,'summary.json'),JSON.stringify(report,null,2)+'\n');
  try{await page?.close()}catch{}try{await browser?.close()}catch{}
  if(server.exitCode===null){server.kill();await sleep(500)}
}
console.log('R75_REAL_GL_CONTEXT_SUMMARY',JSON.stringify({pass:report.pass,cycles:report.cycles.length,errors:report.errors}));
if(!report.pass)process.exitCode=1;
