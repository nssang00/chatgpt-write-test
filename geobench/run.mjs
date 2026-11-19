import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const kind=process.env.GEO_TEST_KIND||'software';
const port=4173, host='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{
  stdio:['ignore','pipe','pipe'],env:process.env
});
server.stdout.on('data',d=>process.stdout.write('[vite] '+d));
server.stderr.on('data',d=>process.stderr.write('[vite] '+d));
async function waitServer(){
  for(let n=0;n<100;n++){
    if(server.exitCode!==null)throw new Error('vite exited with '+server.exitCode);
    try{const r=await fetch(host);if(r.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,300));
  }
  throw new Error('Vite startup timeout');
}
const percentile=(arr,p)=>{const s=arr.toSorted((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor((s.length-1)*p))]};
let browser;
try{
  await waitServer();
  const launch={
    headless:true,
    args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling']
  };
  if(process.env.GEO_BROWSER_CHANNEL)launch.channel=process.env.GEO_BROWSER_CHANNEL;
  if(kind==='software')launch.args.push('--use-gl=angle','--use-angle=swiftshader');
  browser=await chromium.launch(launch);
  await fs.mkdir('results',{recursive:true});
  const results=[];
  const sequence=kind==='software'?['cesium','playcanvas','three','babylon']:['cesium','playcanvas','three','babylon','babylon','three','playcanvas','cesium'];
  for(let round=0;round<sequence.length;round++){
    const engine=sequence[round];
    const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.stack||String(e)));
    page.on('console',m=>{if(m.type()==='error' && !m.text().includes('Failed to load resource'))errors.push('console: '+m.text())});
    page.on('response',res=>{if(res.status()>=400 && !/\/favicon\.ico(?:\?|$)/.test(res.url()))errors.push('HTTP '+res.status()+' '+res.url())});
    try{
      await page.goto(host+'/?engine='+engine,{waitUntil:'load',timeout:90000});
      await page.waitForFunction(()=>window.__geoBench?.ready===true,{timeout:90000});
      if(errors.length)throw new Error('Browser errors: '+errors.join('\n').slice(0,2000));
      const test=await page.evaluate(async()=>{
        const b=window.__geoBench;
        const n=260, warmup=70;
        const deltas=[];
        let start=0,last=0,end=0;
        let initialRendered=0;
        for(let i=0;i<n;i++){
          await new Promise(requestAnimationFrame);
          b.step(i);
          const t=performance.now();
          if(i===warmup){start=t;last=t;initialRendered=b.rendered;}
          if(i>warmup){deltas.push(t-last);last=t;}
          if(i===n-1)end=t;
        }
        const finalRendered=b.rendered;
        return {engine:b.engine,gpu:b.gpu,fixture:b.fixture,
          sampledFrames:deltas.length,renderedFrames:finalRendered-initialRendered,
          durationMs:end-start,frameDeltaMs:deltas};
      });
      const g=test.gpu.renderer||'';
      if(kind==='hardware' && /swiftshader|llvmpipe|softpipe|software/i.test(g))throw new Error('Hardware GPU REQUIRED, got '+g);
      if(test.renderedFrames<test.sampledFrames*0.5)throw new Error('Too few rendered frames: '+test.renderedFrames+' / '+test.sampledFrames);
      const p50=percentile(test.frameDeltaMs,0.50),p95=percentile(test.frameDeltaMs,0.95);
      const report={round,engine,kind,gpu:test.gpu,fixture:test.fixture,
        sampledFrames:test.sampledFrames,renderedFrames:test.renderedFrames,
        meanFrameMs:test.frameDeltaMs.reduce((a,b)=>a+b,0)/test.frameDeltaMs.length,
        p50FrameMs:p50,p95FrameMs:p95,
        effectiveRenderFps:test.renderedFrames/(test.durationMs/1000),
        durationMs:test.durationMs
      };
      await page.screenshot({path:'results/'+engine+'-round'+round+'.png',fullPage:true});
      results.push(report);
      console.log('BENCHMARK_RESULT',JSON.stringify(report));
    }finally{await page.close();}
  }
  const byEngine={};
  for(const engine of ['cesium','playcanvas','three','babylon']){
    const a=results.filter(x=>x.engine===engine);
    byEngine[engine]={
      p50FrameMs:percentile(a.map(x=>x.p50FrameMs),0.50),
      p95FrameMs:percentile(a.map(x=>x.p95FrameMs),0.50),
      effectiveRenderFps: a.reduce((s,x)=>s+x.effectiveRenderFps,0)/a.length
    };
  }
  const report={
    kind,method:'four engines; same OSM + DEM and procedural architectural facade/roads/roof/window meshes; material-color shading (unlit); no imagery, photogrammetry, globe or shadows; close orbit; vsync-limited rAF intervals',
    createdAt:new Date().toISOString(),browser:browser.version(),rounds:results,summary:byEngine
  };
  await fs.writeFile('results/benchmark.json',JSON.stringify(report,null,2));
  console.log('BENCHMARK_SUMMARY',JSON.stringify(byEngine));
}finally{
  if(browser)await browser.close();
  server.kill();
}
