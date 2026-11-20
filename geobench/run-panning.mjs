import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

// Hardware-only comparison. Camera rotation, target distance, and FOV fixed;
// translate 840m east over 260 measured rAF frames, each engine exactly twice.
// Static (camera immobile) phase is run in the same browser page as the pan.
const kind=process.env.GEO_TEST_KIND||'hardware';
const demSource=process.env.GEO_DEM_SOURCE||'aws';
if(!['ngii','aws'].includes(demSource))throw new Error('Invalid DEM source '+demSource);
const port=4173,host='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:process.env});
server.stdout.on('data',d=>process.stdout.write('[vite] '+d));
server.stderr.on('data',d=>process.stderr.write('[vite] '+d));
const percentile=(vals,p)=>{const a=vals.toSorted((x,y)=>x-y);return a[Math.max(0,Math.min(a.length-1,Math.floor((a.length-1)*p)))]};
async function waitServer(){
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw new Error('Vite process died, exit '+server.exitCode);
    try{const r=await fetch(host);if(r.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,300));
  }
  throw new Error('Vite startup timeout');
}
let browser;
try{
  await waitServer();
  const launch={headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling']};
  if(process.env.GEO_BROWSER_CHANNEL)launch.channel=process.env.GEO_BROWSER_CHANNEL;
  if(kind==='software')launch.args.push('--use-gl=angle','--use-angle=swiftshader');
  browser=await chromium.launch(launch);
  await fs.mkdir('results',{recursive:true});
  const results=[];
  const engines=kind==='software'?['cesium','playcanvas','three','babylon']:
    ['cesium','playcanvas','three','babylon','babylon','three','playcanvas','cesium'];
  for(let round=0;round<engines.length;round++){
    const engine=engines[round];
    const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.stack||String(e)));
    page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push('console: '+m.text())});
    page.on('response',res=>{if(res.status()>=400&&!/\/favicon\.ico(?:\?|$)/.test(res.url()))errors.push('HTTP '+res.status()+' '+res.url())});
    try{
      await page.goto(host+'/?engine='+engine+'&dem='+demSource,{waitUntil:'load',timeout:120000});
      await page.waitForFunction(()=>window.__geoBench?.ready===true,{timeout:120000});
      if(errors.length)throw new Error('Browser errors: '+errors.join('\n').slice(0,2500));
      const record=await page.evaluate(async()=>{
        const bench=window.__geoBench;
        const N=320,WARMUP=60,PAN=260;
        const phases={};
        for(const mode of ['static','pan']){
          const deltaMs=[],cameraUpdateMs=[];
          bench.step(0,mode);
          let start=0,last=0,firstRendered=0,end=0;
          for(let i=0;i<N;i++){
            await new Promise(requestAnimationFrame);
            const index=i<WARMUP?0:i-WARMUP;
            const t0=performance.now();
            bench.step(index,mode);
            const t1=performance.now();
            if(i===WARMUP){start=t1;last=t1;firstRendered=bench.rendered;}
            if(i>WARMUP){deltaMs.push(t1-last);last=t1;}
            if(i>=WARMUP)cameraUpdateMs.push(t1-t0);
            if(i===N-1)end=t1;
          }
          phases[mode]={
            frameDeltaMs:deltaMs,cameraUpdateMs,
            renderedFrames:bench.rendered-firstRendered,
            sampledIntervals:deltaMs.length,
            elapsedMs:end-start,
            startPanMeters:mode==='pan'?-420:0,
            endPanMeters:mode==='pan'?420:0
          };
        }
        bench.step(130,'pan');  // midpoint screenshot from an equivalent pose.
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return {engine:bench.engine,fixture:bench.fixture,gpu:bench.gpu,panParameters:bench.panParameters,phases};
      });
      if(record.engine!==engine)throw new Error('Wrong engine reported '+record.engine);
      if(demSource==='ngii'&&record.fixture.demSource!=='NGII')throw new Error('Missing genuine NGII provenance');
      const rendererName=record.gpu.renderer||'';
      if(kind==='hardware'&&/swiftshader|llvmpipe|softpipe|software/i.test(rendererName))
        throw new Error('Software renderer detected during supposed GPU test: '+rendererName);
      const phaseStats={};
      for(const [mode,data] of Object.entries(record.phases)){
        if(data.renderedFrames<data.sampledIntervals*.5)throw new Error('Low render count '+engine+' '+mode+' '+data.renderedFrames);
        const intervals=data.frameDeltaMs;
        phaseStats[mode]={
          effectiveRenderFps: data.renderedFrames/(data.elapsedMs/1000),
          meanFrameDeltaMs:intervals.reduce((a,b)=>a+b,0)/intervals.length,
          p50FrameDeltaMs:percentile(intervals,.50),
          p95FrameDeltaMs:percentile(intervals,.95),
          p99FrameDeltaMs:percentile(intervals,.99),
          frameIntervalsOver33ms:intervals.filter(x=>x>33.33).length,
          frameIntervalsOver50ms:intervals.filter(x=>x>50).length,
          cameraUpdateP95Ms:percentile(data.cameraUpdateMs,.95),
          sampledIntervals:data.sampledIntervals,
          renderedFrames:data.renderedFrames,
          elapsedMs:data.elapsedMs
        };
      }
      await page.screenshot({path:'results/'+engine+'-pan-round'+round+'.png',fullPage:true});
      const report={round,engine,kind,gpu:record.gpu,fixture:{bbox:record.fixture.bbox,areaLabel:record.fixture.areaLabel,demSource:record.fixture.demSource,buildingCount:record.fixture.buildingCount,meshStats:record.fixture.meshStats,trianglesByMaterial:record.fixture.trianglesByMaterial},panParameters:record.panParameters,phases:phaseStats};
      results.push(report);
      console.log('PAN_RESULT '+JSON.stringify(report));
    }finally{await page.close();}
  }
  const summary={};
  for(const name of ['cesium','playcanvas','three','babylon']){
    const rounds=results.filter(r=>r.engine===name);
    const fields={};
    for(const mode of ['static','pan']){
      const passes=rounds.map(r=>r.phases[mode]);
      fields[mode]={
        effectiveRenderFps:passes.reduce((a,b)=>a+b.effectiveRenderFps,0)/passes.length,
        p50FrameDeltaMs:percentile(passes.map(x=>x.p50FrameDeltaMs),.50),
        p95FrameDeltaMs:percentile(passes.map(x=>x.p95FrameDeltaMs),.50),
        p99FrameDeltaMs:percentile(passes.map(x=>x.p99FrameDeltaMs),.50),
        framesOver33ms:passes.reduce((a,b)=>a+b.frameIntervalsOver33ms,0)
      };
    }
    summary[name]={...fields,panMinusStaticFps:fields.pan.effectiveRenderFps-fields.static.effectiveRenderFps};
  }
  const output={
    kind,demSource,createdAt:new Date().toISOString(),browser:browser.version(),
    methodology:'Seoul OSM 2085 buildings with procedural facades and real AWS Mapzen Terrain tiles (unless explicitly NGII); same geometry and 1280x720; fixed camera heading, 840m east translation; 260 measured frames with 60 warmup; static/pan compared on same page; 2 hardware rounds/engine; rAF frame interval vsync-limited, not GPU execution time; no spatial streaming, no shadows.',
    results,summary
  };
  await fs.writeFile('results/pan-benchmark.json',JSON.stringify(output,null,2));
  console.log('PAN_SUMMARY '+JSON.stringify(summary));
}finally{
  if(browser)await browser.close();
  server.kill();
}
