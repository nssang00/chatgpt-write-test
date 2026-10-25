/** R60 physical-RTX paired ABBA: one actual OL Map/32 MVT, Worker OFF vs R45 deferred ON.
 * Measures first visible frame, real pointer/wheel churn, main page CDP TaskDuration,
 * long tasks, rAF gaps, heap, delayed Worker completion and exact final RGBA8.
 * A mode without completed Worker encoding must FAIL; not "Worker ON performance".
 */
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname,join} from 'node:path';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const root=resolve(process.argv[2]||'.'),out=resolve(process.argv[3]||join(root,'RESULTS','R60_ON_OFF'));
await mkdir(out,{recursive:true});
const nRound=Number(process.env.R60_ABBA_ROUNDS||2);
if(!Number.isInteger(nRound)||nRound<1||nRound>4)throw Error('Invalid ABBA round count');
const report={pass:false,suite:'R60 real OL UI in-flight Worker OFF-ON ABBA RTX',rounds:nRound,
  interpretation:'R45 deferred Worker runs AFTER CPU-first presentation. This is not the R35 always-Worker cold-start.',trials:[],paired:[],checks:[],errors:[]};
const median=arr=>{const a=[...arr].sort((x,y)=>x-y);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null};
const pct=(on,off)=>off>0?Number((100*(off-on)/off).toFixed(2)):null;
const percentile=(arr,p)=>{if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b);return s[Math.ceil((s.length-1)*p)]};
const metric=(a,key)=>a.find(x=>x.name===key)?.value??null;
const sha=b=>createHash('sha256').update(b).digest('hex');
const deadline=async(p,ms,label)=>{
 let timeout;try{return await Promise.race([p,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('TIMEOUT '+label)),ms))])}
 finally{clearTimeout(timeout)}
};
let server,browser;
try{
 server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
   const file=resolve(root,'.'+decodeURIComponent(url.pathname));
   if(req.method!=='GET'||!file.startsWith(root+sep)||!existsSync(file))throw Error('file not found');
   res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.pbf':'application/octet-stream','.css':'text/css'}[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file));
  }catch(e){res.writeHead(404);res.end(String(e))}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 browser=await chromium.launch({executablePath:process.env.M5_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless:true,args:['--enable-webgl','--disable-software-rasterizer','--disable-background-networking','--window-size=1120,720']});
 const origin='http://127.0.0.1:'+server.address().port;
 const order=Array.from({length:nRound},(_,i)=>i%2===0?['off','on','on','off']:['on','off','off','on']).flat();
 const pendingPairs=new Map();
 for(let k=0;k<order.length;k++){
  const mode=order[k],round=Math.floor(k/4),slot=k%4,id='round'+(round+1)+'-slot'+(slot+1)+'-'+mode;
  const trial={id,mode,round,slot,errors:[],gestureMeasurements:[]};
  report.trials.push(trial);
  let page,cdp;
  try{
   page=await browser.newPage({viewport:{width:1120,height:720},deviceScaleFactor:1});
   page.on('pageerror',e=>trial.errors.push('pageerror: '+String(e)));
   page.on('console',m=>{if(m.type()==='error')trial.errors.push('console: '+m.text())});
   cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
   const navAt=performance.now();
   await deadline(page.goto(origin+'/m5-gpu/r59/actual_32_ui_on_off.html?workers='+mode,{waitUntil:'domcontentloaded',timeout:40000}),45000,'navigation '+id);
   await page.waitForFunction(()=>window.__r59?.ready||window.__r59?.errors?.length,null,{timeout:30000});
   await page.waitForFunction(()=>window.__r59?.sourceLoads>=32&&window.__r59?.firstVisibleAt!==null||window.__r59?.errors?.length,null,{timeout:25000});
   const first=await page.evaluate(()=>__r59Metrics());
   if(first.errors.length||first.sourceErrors||first.sourceLoads!==32||first.firstVisibleAt===null)throw Error('initial source/paint invalid '+JSON.stringify(first));
   trial.firstVisibleMs=Number((first.firstVisibleAt-first.startedAt).toFixed(3));
   trial.readyMs=Number((first.readyAt-first.startedAt).toFixed(3));
   trial.browserNavigationWallMs=Number((performance.now()-navAt).toFixed(3));
   // Actual deferred Worker completion is measured outside first-visible timing.
   if(mode==='on'){
    // Keep Worker encoding in flight through the first gestures rather than
    // waiting for its pool to finish before the interaction benchmark.
    trial.workerAtFirstPaint=first.worker;
   }else{
    trial.worker=first.worker;
    if(trial.worker!==null)throw Error('Worker OFF unexpectedly constructed a deferred pool');
   }
   const early=await page.evaluate(()=>__r53Snapshot());
   if(early.glError!==0||early.painted<=0||!/NVIDIA.*RTX 5060 Ti/i.test(early.renderer||''))throw Error('physical GPU initial invalid '+JSON.stringify({glError:early.glError,painted:early.painted,renderer:early.renderer}));
   trial.renderer=early.renderer;
   const cdpBefore=(await cdp.send('Performance.getMetrics')).metrics;
   const uiBefore=await page.evaluate(()=>__r59Metrics());
   trial.workerAtGestureStart=uiBefore.worker;
   if(mode==='on'&&uiBefore.worker?.workerRows>=32)
    throw Error('Overlap not observed: all 32 Worker jobs finished before first UI input '+JSON.stringify(uiBefore.worker));
   // Identical real mouse gestures for every trial. Collect latency from
   // gesture dispatch start to next visible OL postrender timestamp.
   for(let i=0;i<12;i++){
    const before=await page.evaluate(()=>({time:performance.now(),frames:__r59Metrics().frames}));
    const sign=i%2?-1:1;
    if(i%3===2){
     await page.mouse.move(800,250);await page.mouse.wheel(0,sign*135);
    }else{
     await page.mouse.move(800,260);await page.mouse.down();
     await page.mouse.move(800+sign*65,260+sign*30,{steps:5});await page.mouse.up();
    }
    await page.waitForFunction(x=>window.__r59Metrics().frames>x,before.frames,{timeout:6000});
    const after=await page.evaluate(()=>({time:performance.now(),frames:__r59Metrics().frames,ft:__r59Metrics().frameTimes.slice(-1)[0]}));
    trial.gestureMeasurements.push({type:i%3===2?'wheel':'drag',dispatchToObservedFrameMs:Number((after.ft-before.time).toFixed(3)),
      totalActionMs:Number((after.time-before.time).toFixed(3)),framesChanged:after.frames-before.frames});
   }
   await page.waitForTimeout(500);
   if(mode==='on'){
    trial.workerAfterChurn=(await deadline(page.evaluate(()=>__r59WaitWorker()),30000,'churn worker idle '+id)).worker;
    trial.worker=trial.workerAfterChurn;
    if(!trial.worker||trial.worker.groups<1||trial.worker.workerRows<32||trial.worker.failures||trial.worker.parityRejects)
      throw Error('R60 in-flight Worker completion invalid '+JSON.stringify(trial.worker));
   }
   const uiAfter=await page.evaluate(()=>__r59Metrics());
   const cdpAfter=(await cdp.send('Performance.getMetrics')).metrics;
   const longTaskStart=uiBefore.now;
   const tasks=uiAfter.longTasks.filter(x=>x.start>=longTaskStart);
   const gaps=uiAfter.rafGaps.slice(uiBefore.rafGaps.length);
   trial.ui={elapsedMs:Number((uiAfter.now-uiBefore.now).toFixed(3)),postrenderFrames:uiAfter.frames-uiBefore.frames,
    gestureLatencyMedianMs:median(trial.gestureMeasurements.map(x=>x.dispatchToObservedFrameMs)),
    gestureLatencyP95Ms:percentile(trial.gestureMeasurements.map(x=>x.dispatchToObservedFrameMs),0.95),
    actionDurationMedianMs:median(trial.gestureMeasurements.map(x=>x.totalActionMs)),
    rafGapMedianMs:median(gaps),rafGapP95Ms:percentile(gaps,0.95),
    rafGapOver50Ms:gaps.filter(x=>x>50).length,longTasks:tasks.length,
    longTaskMs:Number(tasks.reduce((a,x)=>a+x.duration,0).toFixed(3)),
    mainTaskDurationMs:Number((1000*(metric(cdpAfter,'TaskDuration')-metric(cdpBefore,'TaskDuration'))).toFixed(3)),
    mainScriptDurationMs:Number((1000*(metric(cdpAfter,'ScriptDuration')-metric(cdpBefore,'ScriptDuration'))).toFixed(3)),
    jsHeapUsedBytes:uiAfter.memory?.usedJSHeapSize??null};
   // Exact RGBA8 oracle at same deterministic OL view, independent of event
   // scheduling. Worker must remain enabled through the final draw.
   await page.evaluate(()=>__r59Reset());
   await page.waitForTimeout(500);
   if(mode==='on')trial.workerAtReset=(await deadline(page.evaluate(()=>__r59WaitWorker()),30000,'reset worker idle '+id)).worker;
   const final=await page.evaluate(()=>__r53Snapshot());
   if(final.glError!==0||final.sourceErrors||final.errors.length||final.painted<=0||final.distinctInputs!==32||
      final.drawPackets<=0)throw Error('final framebuffer invalid '+JSON.stringify(final));
   const rgba=Buffer.from(await page.evaluate(()=>__r59RGBA()),'base64');
   if(rgba.length!==512*512*4)throw Error('incorrect RGBA size '+rgba.length);
   trial.final={painted:final.painted,drawPackets:final.drawPackets,frameHash:sha(rgba),view:final.view,sourceLoads:final.sourceLoads,glError:final.glError};
   await writeFile(join(out,id+'.rgba8'),rgba);
   // every adjacent OFF/ON pair is an independent strict pixel oracle
   const key=round+'-'+Math.floor(slot/2);
   const previous=pendingPairs.get(key);
   if(!previous)pendingPairs.set(key,{mode,rgba,id});
   else{
    if(previous.mode===mode)throw Error('invalid ABBA mode pair '+id);
    let diffPixels=0,channels=0;
    for(let i=0;i<rgba.length;i+=4){let changed=false;for(let c=0;c<4;c++)if(rgba[i+c]!==previous.rgba[i+c]){channels++;changed=true}if(changed)diffPixels++}
    report.paired.push({a:previous.id,b:id,diffPixels,changedChannels:channels});
    pendingPairs.delete(key);
    if(diffPixels!==0)throw Error('ON/OFF exact 512x512 RGBA8 mismatch '+JSON.stringify({previous:previous.id,id,diffPixels,channels}));
   }
   if(trial.errors.length)throw Error('browser console/page error '+trial.errors.join(';'));
   trial.pass=true;
  }catch(e){trial.pass=false;trial.error=String(e.stack||e);report.errors.push(id+': '+String(e.message||e))}
  finally{
   try{await cdp?.detach()}catch{}
   try{await page?.close({runBeforeUnload:false})}catch{}
   await writeFile(join(out,'progress.json'),JSON.stringify({trials:report.trials.map(({id,mode,pass,firstVisibleMs,worker,ui,error})=>({id,mode,pass,firstVisibleMs,worker,ui,error})),errors:report.errors},null,2));
  }
  console.log('R60_TRIAL',JSON.stringify({id,pass:trial.pass,firstVisibleMs:trial.firstVisibleMs,
   worker:trial.worker,ui:trial.ui,error:trial.error?.slice(0,400)}));
 }
 const valid=report.trials.filter(t=>t.pass);
 const off=valid.filter(t=>t.mode==='off'),on=valid.filter(t=>t.mode==='on');
 const avg=mode=>({firstVisibleMs:median(mode.map(t=>t.firstVisibleMs)),
  gestureP95Ms:median(mode.map(t=>t.ui?.gestureLatencyP95Ms)),
  rafGapP95Ms:median(mode.map(t=>t.ui?.rafGapP95Ms)),
  mainTaskDurationMs:median(mode.map(t=>t.ui?.mainTaskDurationMs)),
  longTaskMs:median(mode.map(t=>t.ui?.longTaskMs)),
  jsHeapUsedBytes:median(mode.map(t=>t.ui?.jsHeapUsedBytes).filter(Number.isFinite))});
 report.modeMedians={off:avg(off),on:avg(on)};
 report.onRelativeToOffPct=Object.fromEntries(Object.keys(report.modeMedians.off).map(key=>[key,pct(report.modeMedians.on[key],report.modeMedians.off[key])]));
 report.checks.push({name:'paired real RTX samples',expected:4*nRound,observed:valid.length,pass:valid.length===4*nRound});
 report.checks.push({name:'strict full-frame ABBA RGBA8 parity',expected:2*nRound,observed:report.paired.length,pass:report.paired.length===2*nRound&&report.paired.every(x=>x.diffPixels===0)});
 report.checks.push({name:'real Worker tasks and exact gates',expected:2*nRound,observed:on.filter(x=>x.worker?.groups>0&&x.worker?.workerRows>0&&!x.worker.parityRejects&&!x.worker.failures).length,
  pass:on.length===2*nRound&&on.every(x=>x.worker?.groups>0&&x.worker?.workerRows>0&&!x.worker.parityRejects&&!x.worker.failures)});
 report.pass=report.errors.length===0&&report.checks.every(x=>x.pass);
}catch(e){report.errors.push('fatal '+String(e.stack||e));report.pass=false}
finally{
 await writeFile(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
 try{await browser?.close()}catch{}
 if(server?.listening)await new Promise(resolve=>server.close(resolve));
}
console.log(report.pass?'R60_WORKER_OFF_ON_ABBA_PASS':'R60_WORKER_OFF_ON_ABBA_FAIL',JSON.stringify({rounds:nRound,modeMedians:report.modeMedians,
 relativeImprovementPct:report.onRelativeToOffPct,checks:report.checks,errors:report.errors}));
if(!report.pass)process.exitCode=1;