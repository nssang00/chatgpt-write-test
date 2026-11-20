import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const port=4173,host='http://127.0.0.1:'+port;
const kind=process.env.GEO_TEST_KIND||'hardware';
const cpuThrottle=Number(process.env.GEO_CPU_THROTTLE||'1');
const runs=process.env.GEO_FAST_SMOKE==='1'?['cesium','playcanvas','three','babylon','babylon','three','playcanvas','cesium']:
  ['cesium','playcanvas','three','babylon','babylon','three','playcanvas','cesium'];
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{
  stdio:['ignore','pipe','pipe'],env:process.env
});
server.stdout.on('data',d=>process.stdout.write('[vite] '+d));
server.stderr.on('data',d=>process.stderr.write('[vite] '+d));
async function ready(){
  for(let n=0;n<100;n++){
    if(server.exitCode!==null)throw Error('vite died '+server.exitCode);
    try{const r=await fetch(host+'/streaming.html');if(r.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,300));
  }
  throw Error('Vite not ready');
}
const percentile=(vals,p)=>{const a=vals.toSorted((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor((a.length-1)*p))]||0};
const toStats=(data)=>{
  const a=data.frameDeltas;
  const s=data.stream;
  return {
    fps:data.renderedFrames/(data.elapsedMs/1000),
    frameMedianMs:percentile(a,.50),p95FrameMs:percentile(a,.95),p99FrameMs:percentile(a,.99),
    longFrames33ms:a.filter(v=>v>33.33).length,longFrames50ms:a.filter(v=>v>50).length,
    tileRequests:s.requests,tileSuccess:s.success,evictions:s.evictions,swaps:s.swaps,
    tileAborts:s.aborts,tileErrors:s.errors,downloadedMB:s.bytesFetched/1e6,
    uploadMsTotal:s.uploads.reduce((a,b)=>a+b,0),
    uploadP95Ms:s.uploads.length?percentile(s.uploads,.95):0,
    peakActiveTiles:s.peakActiveTiles,peakActiveTriangles:s.peakActiveTriangles,
    peakJSHeapMB:s.peakHeapBytes/1e6,
    totalFrames:a.length,renderedFrames:data.renderedFrames
  };
};
let browser;
try{
  await ready();
  const launch={headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling']};
  if(process.env.GEO_BROWSER_CHANNEL)launch.channel=process.env.GEO_BROWSER_CHANNEL;
  if(kind==='software')launch.args.push('--use-gl=angle','--use-angle=swiftshader');
  browser=await chromium.launch(launch);
  await fs.mkdir('results',{recursive:true});
  const rounds=[];
  for(let round=0;round<runs.length;round++){
    const name=runs[round];
    const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.stack||String(e)));
    page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(m.text())});
    page.on('response',r=>{if(r.status()>=400&&!r.url().includes('favicon'))errors.push('HTTP '+r.status()+' '+r.url())});
    try{
      if(cpuThrottle>1){
        const session=await page.context().newCDPSession(page);
        await session.send('Emulation.setCPUThrottlingRate',{rate:cpuThrottle});
      }
      const navigationStarted=Date.now();
      await page.goto(host+'/streaming.html?engine='+name,{waitUntil:'load',timeout:180000});
      await page.waitForFunction(()=>window.__streamBench?.ready===true,{timeout:180000});
      await page.waitForFunction(()=>window.__streamBench?.stats.success>=(window.__streamBench?.engine ? 2 : 4),{timeout:180000});
      const coldStartMs=Date.now()-navigationStarted;
      if(errors.length)throw Error(name+' boot errors '+errors.slice(0,3).join(' \n'));
      const gpu=await page.evaluate(()=>window.__streamBench.gpu);
      if(kind==='hardware'&&/swiftshader|llvmpipe|softpipe|software/i.test(gpu.renderer))
        throw Error('Unexpected software renderer '+gpu.renderer);
      const modes=process.env.GEO_FAST_SMOKE==='1'?['sweep']:['sweep','scrub'];
      const phases={};
      for(const mode of modes){
        const record=await page.evaluate(async ({mode,smoke})=>{
          const b=window.__streamBench;
          const samples=[],total=smoke?140:400,warmup=smoke?20:40;
          // Warmup can reposition and trigger fresh loads; not included in frame stats.
          const position=n=>{
            if(mode==='sweep')return -540+1080*Math.max(0,n)/(total-warmup-1);
            const tick=Math.floor(Math.max(0,n)/45)%4;
            return [-480,480,-480,480][tick];
          };
          b.move(position(0),{detailRadius:smoke?130:260,loadRadius:smoke?260:440,concurrency:smoke?2:3});
          for(let i=0;i<warmup;i++)await new Promise(requestAnimationFrame);
          const initialStats=b.resetCounters();
          let firstRendered=b.rendered,last=performance.now(),start=last;
          for(let i=0;i<total-warmup;i++){
            await new Promise(requestAnimationFrame);
            b.move(position(i));
            const now=performance.now();
            samples.push(now-last);last=now;
          }
          const end=performance.now();
          const s=b.stats;
          return {
            elapsedMs:end-start,renderedFrames:b.rendered-firstRendered,
            frameDeltas:samples,firstTileMs:initialStats.firstTileMs,
            stream:{requests:s.requests,success:s.success,evictions:s.evictions,swaps:s.swaps,
              aborts:s.aborts,errors:s.errors,bytesFetched:s.bytesFetched,uploads:[...s.uploads],
              peakActiveTiles:s.peakActiveTiles,peakActiveTriangles:s.peakActiveTriangles,
              peakHeapBytes:s.peakHeapBytes},gpu:b.gpu,manifest:b.manifest
          };
        },{mode,smoke:process.env.GEO_FAST_SMOKE==='1'});
        if(record.stream.errors)throw Error(name+' tile fetch errors '+record.stream.errors);
        const summary=toStats(record);
        if(record.renderedFrames<(process.env.GEO_FAST_SMOKE==='1'?60:250))throw Error(name+' '+mode+' rendered too few frames '+record.renderedFrames);
        phases[mode]=summary;
        console.log('STREAM_PHASE '+JSON.stringify({round,engine:name,mode,coldStartMs,gpu,summary}));
        // Save screenshot from EXACT same midpoint pose regardless of traversal.
        if(mode==='sweep'){
          await page.evaluate(()=>window.__streamBench.move(0));
          for(let n=0;n<12;n++)await page.evaluate(()=>new Promise(requestAnimationFrame));
          await page.screenshot({path:'results/'+name+'-stream-round'+round+'.png',fullPage:true});
        }
      }
      rounds.push({round,engine:name,coldStartMs,gpu,phases});
      if(errors.length)console.warn('Nonfatal browser console messages '+name,errors.slice(0,4));
    }finally{await page.close();}
  }
  const summary={};
  for(const name of ['cesium','playcanvas','three','babylon']){
    const a=rounds.filter(x=>x.engine===name);
    summary[name]={coldStartMs:a.reduce((s,x)=>s+x.coldStartMs,0)/a.length};
    for(const mode of Object.keys(a[0].phases)){
      const v=a.map(x=>x.phases[mode]);
      summary[name][mode]={
        fps:v.reduce((s,x)=>s+x.fps,0)/v.length,
        p95FrameMs:percentile(v.map(x=>x.p95FrameMs),.50),
        p99FrameMs:percentile(v.map(x=>x.p99FrameMs),.50),
        longFrames33ms:v.reduce((s,x)=>s+x.longFrames33ms,0),
        longFrames50ms:v.reduce((s,x)=>s+x.longFrames50ms,0),
        avgDownloadMB:v.reduce((s,x)=>s+x.downloadedMB,0)/v.length,
        avgLoadedTiles:v.reduce((s,x)=>s+x.tileSuccess,0)/v.length,
        meanTotalUploadMs:v.reduce((s,x)=>s+x.uploadMsTotal,0)/v.length,
        uploadP95Ms:percentile(v.map(x=>x.uploadP95Ms),.50),
        peakJSHeapMB:Math.max(...v.map(x=>x.peakJSHeapMB)),
        peakActiveTriangles:Math.max(...v.map(x=>x.peakActiveTriangles)),
        totalTileErrors:v.reduce((s,x)=>s+x.tileErrors,0)
      };
    }
  }
  const out={createdAt:new Date().toISOString(),kind,cpuThrottle,browser:browser.version(),
    methodology:'Identical 144 local 2-LOD JSON geometry tiles with common JS tile scheduler. All four engines create/dispose native scene meshes, material per surface. Seoul 2085 OSM buildings. Each viewer starts empty, camera sweeps 1080m (360 samples) or scrubs ±480m every 45 frames (360 samples). Browser rAF is vsync-capped. This is not engine-native 3D Tiles or independently optimized game engines.',
    rounds,summary};
  await fs.writeFile('results/streaming-benchmark.json',JSON.stringify(out,null,2));
  console.log('STREAM_SUMMARY '+JSON.stringify(summary));
}finally{
  if(browser)await browser.close();
  server.kill();
}
