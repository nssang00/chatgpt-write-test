import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { spawn } from 'node:child_process';
import { existsSync,mkdirSync,writeFileSync,appendFileSync } from 'node:fs';
import { dirname,resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const root=dirname(fileURLToPath(import.meta.url));
const output=resolve(process.env.PERDRAW_OUTPUT??join(root,'perdraw-output'));
mkdirSync(output,{recursive:true});
const mbtiles=resolve(process.env.MBTILES_PATH??join(root,'seoul.mbtiles'));
if(!existsSync(mbtiles))throw Error('NO_REAL_SEOUL_MBTILES '+mbtiles);
const regions=[
  {name:'gangnam',lon:127.0276,lat:37.4979},
  {name:'jongno',lon:126.9780,lat:37.5729},
  {name:'yeouido',lon:126.9245,lat:37.5219},
  {name:'nowon',lon:127.0570,lat:37.6540}
];
const counts=[18,64,128],engines=['maplibre','openlayers'],rounds=2,drawSamples=12,profileRounds=3,fullRounds=3;
const raw=[],failures=[],extentFailures=[];
let tileServer,vite,browser,gpu,tileInfo;
function median(values){
  if(!values.length)return null;
  const s=[...values].sort((x,y)=>x-y);
  return Math.round(s[Math.ceil(s.length*0.5)-1]*1e6)/1e6;
}
function p95(values){
  if(!values.length)return null;
  const s=[...values].sort((x,y)=>x-y);
  return Math.round(s[Math.ceil(s.length*0.95)-1]*1e6)/1e6;
}
function save(){
  writeFileSync(join(output,'raw.json'),JSON.stringify({
    experiment:'GPU per-draw time queries + program census',regions,counts,engines,
    rounds,drawSamples,profileRounds,fullRounds,raw,failures,extentFailures
  },null,2));
}
async function health(){
  for(let i=0;i<120;i++){
    try{const r=await fetch('http://127.0.0.1:8787/health');if(r.ok)return await r.json()}catch{}
    await delay(250);
  }
  throw Error('TILE_SERVER_UNAVAILABLE');
}
function extentDiff(a,b){
  const w=e=>e[2]-e[0],h=e=>e[3]-e[1];
  return {width:Math.abs(w(a)-w(b))/Math.max(w(a),w(b)),
    height:Math.abs(h(a)-h(b))/Math.max(h(a),h(b)),
    lonCenter:Math.abs(a[0]+a[2]-b[0]-b[2])/2,
    latCenter:Math.abs(a[1]+a[3]-b[1]-b[3])/2};
}
function pngInk(bytes){
  const p=PNG.sync.read(bytes);let n=0;
  for(let y=0;y<p.height;y+=8)for(let x=0;x<p.width;x+=8){
    const i=(y*p.width+x)*4;if(p.data[i]<237||p.data[i+1]<237||p.data[i+2]<237)n++;
  }return n;
}
async function sample(engine,region,count,round){
  const context=await browser.newContext({
    viewport:{width:1280,height:720},deviceScaleFactor:1,
    serviceWorkers:'block',reducedMotion:'no-preference'
  });
  const page=await context.newPage(),pageErrors=[];let tiles200=0;
  page.on('pageerror',error=>pageErrors.push(String(error)));
  page.on('response',r=>{if(r.url().includes('/tiles/')&&r.status()===200)tiles200++});
  try{
    await page.goto('http://127.0.0.1:5173/',{waitUntil:'load',timeout:30000});
    await page.waitForFunction(()=>!!window.__seoulBench);
    await page.evaluate(async()=>{
      await import('/src/draw-profiler.js');
      await import('/src/scene-profile.js');
    });
    const result=await page.evaluate(a=>window.__perDrawScene.run(a),{
      engine,lon:region.lon,lat:region.lat,count,zoom:16,
      drawSamples,profileRounds,fullRounds
    });
    const row={region:region.name,count,round,engine,...result,tiles200};
    if(tiles200<1)throw Error('NO_ACTUAL_MVT_REQUESTS');
    if(pageErrors.length)throw Error('PAGE_SCRIPT_ERRORS '+JSON.stringify(pageErrors));
    if(result.canvas.width!==1280||result.canvas.height!==720)throw Error('VIEWPORT_SIZE_MISMATCH '+JSON.stringify(result.canvas));
    if(!/NVIDIA|GeForce|RTX/i.test(row.info.renderer))throw Error('GPU_NOT_NVIDIA '+row.info.renderer);
    if(result.wholeFrames.length!==fullRounds||result.detailed.length!==profileRounds)throw Error('WRONG_SAMPLE_COUNTS');
    const frameTimes=result.wholeFrames.map(x=>x.gpuMs);
    if(frameTimes.some(x=>!Number.isFinite(x)||x<=0))throw Error('INVALID_WHOLE_GPU_TIMES '+JSON.stringify(frameTimes));
    const samples=result.detailed.flatMap(x=>x.result.values);
    if(samples.length!==drawSamples*profileRounds)throw Error('MISSING_DRAW_QUERIES '+samples.length);
    if(samples.some(x=>!Number.isFinite(x.gpuNanoseconds)||x.gpuNanoseconds<=0))throw Error('INVALID_INDIVIDUAL_GPU_QUERY');
    if(!result.info.programs.length || result.census.drawCalls<10)throw Error('NO_SHADER_PROGRAM_CENSUS');
    row.profileCount=samples.length;
    if(round===0&&(count===18||count===128)){
      const png=await page.locator('#map').screenshot({animations:'disabled'});
      const ink=pngInk(png);
      if(ink<25)throw Error('BLANK_MAP '+ink);
      const dir=join(output,'screenshots');mkdirSync(dir,{recursive:true});
      writeFileSync(join(dir,region.name+'-'+count+'-'+engine+'.png'),png);
    }
    return row;
  }finally{await context.close()}
}
function summarize(){
  const expected=regions.length*counts.length*rounds*engines.length;
  const cells=counts.map(count=>{
    const c={count};
    for(const engine of engines){
      const rows=raw.filter(x=>x.engine===engine&&x.count===count);
      const frameMs=rows.flatMap(x=>x.wholeFrames.map(y=>y.gpuMs));
      const drawMs=rows.flatMap(x=>x.detailed.flatMap(y=>y.result.values.map(z=>z.gpuMs)));
      const framePerScene=rows.map(x=>median(x.wholeFrames.map(y=>y.gpuMs)));
      const drawCount=rows.map(x=>x.census.drawCalls);
      const programCount=rows.map(x=>x.info.programs.length);
      const perProgram=rows.flatMap(x=>x.census.programs);
      c[engine]={
        scenes:rows.length,fullQueries:frameMs.length,sampledDrawQueries:drawMs.length,
        gpuFrameP50:median(frameMs),gpuFrameP95:p95(frameMs),
        gpuSceneP50:median(framePerScene),
        sampledDrawGpuP50:median(drawMs),sampledDrawGpuP95:p95(drawMs),
        drawCountP50:median(drawCount),programCountP50:median(programCount),
        uniqueProgramSignatures:([...new Set(rows.flatMap(x=>x.info.programs.map(p=>
          p.shaders.map(s=>s.type+':'+s.hash).sort().join(';'))))]).length,
        perProgramTop:rows[0]?.census.programs.slice(0,12)
      };
    }return c;
  });
  const totalQueries=raw.reduce((a,r)=>a+r.wholeFrames.length+r.detailed.reduce((b,x)=>b+x.result.values.length,0),0);
  const expectedQueries=expected*(fullRounds+drawSamples*profileRounds);
  const valid=raw.length===expected&&failures.length===0&&extentFailures.length===0&&totalQueries===expectedQueries;
  const summary={valid,expected,observed:raw.length,totalQueries,expectedQueries,
    gpu,chromium:browser.version(),tileInfo,regions,counts,rounds,drawSamples,profileRounds,fullRounds,
    cells,notes:[
      'Hardware disjoint timer queries around individually sampled WebGL draw calls; no gl.finish.',
      'Whole-frame timings are separate query scopes with instrumented GL methods.',
      'Individual draw sample P50 is NOT sum of all GPU draw costs; sampling can perturb the graphics pipeline.',
      'MapLibre has N style layers and WebGL2; OL has one WebGLVectorTileLayer with N rules and WebGL1.',
      'Above 18, original MVT source layers are reused; synthetic style rules not independent data.',
      'Program signature dedup uses hash of attached vertex/fragment shader sources per scene.',
      'Frame draw-call census is one stationary forced redraw after warming; single draw timers sample multiple other redraws.',
      'No attribution of GPU execution to precise OpenLayers JS stages, and no PIX/RenderDoc captured if unavailable.'
    ],failures,extentFailures
  };
  writeFileSync(join(output,'summary.json'),JSON.stringify(summary,null,2));
  const rows=[
    '# Seoul per-draw GPU timer and program profile',
    'Valid: '+valid+'; '+raw.length+'/'+expected+' scenes; '+totalQueries+'/'+expectedQueries+' GPU timer queries',
    'GPU: '+gpu.renderer,'',
    '|Style rules|ML frame P50|OL frame P50|ML per-draw sampled P50|OL per-draw sampled P50|ML draw count P50|OL draw count P50|ML program count|OL program count|',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...cells.map(x=>'|'+[x.count,x.maplibre.gpuFrameP50,x.openlayers.gpuFrameP50,
      x.maplibre.sampledDrawGpuP50,x.openlayers.sampledDrawGpuP50,x.maplibre.drawCountP50,
      x.openlayers.drawCountP50,x.maplibre.programCountP50,x.openlayers.programCountP50].join('|')+'|'),
    '',
    'Individual GPU draw queries include timer-query instrumentation overhead and do not sum to exact frame time.'
  ];
  const md=rows.join('\n')+'\n';
  writeFileSync(join(output,'summary.md'),md);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
  return summary;
}
async function main(){
  const chrome=process.env.CHROME_PATH;
  if(!chrome||!existsSync(chrome))throw Error('REAL_INSTALLED_CHROME_REQUIRED');
  tileServer=spawn(process.env.PYTHON_CMD||'python',['-u','tileserver.py',mbtiles],
    {cwd:root,stdio:['ignore','pipe','pipe']});
  tileServer.stdout.on('data',x=>process.stdout.write('[TILES] '+x));
  tileServer.stderr.on('data',x=>process.stderr.write('[TILES] '+x));
  tileInfo=await health();
  if(tileInfo.tileCount<100)throw Error('REAL_SEOUL_TILES_NOT_PRESENT');
  vite=await createServer({configFile:join(root,'vite.config.js'),logLevel:'error'});
  await vite.listen();
  browser=await chromium.launch({executablePath:chrome,headless:true,
    args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11','--enable-webgl']});
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(()=>Boolean(window.__seoulBench));
  gpu=await page.evaluate(()=>window.__seoulBench.gpu);
  await page.close();
  if(!gpu.webgl||!/NVIDIA|RTX|GeForce/.test(gpu.renderer)||
    /SwiftShader|WARP|Software|llvmpipe/i.test(gpu.renderer))throw Error('HARDWARE_GPU_REQUIRED '+JSON.stringify(gpu));
  for(const [ri,region] of regions.entries())for(const count of (ri%2?[...counts].reverse():counts))for(let round=0;round<rounds;round++){
    const pair=[];
    for(const engine of (round%2?[...engines].reverse():engines)){
      try{
        const row=await sample(engine,region,count,round);
        raw.push(row);pair.push(row);save();
        console.log('DRAW_PROFILE '+JSON.stringify({
          region:region.name,count,round,engine,
          frameMs:row.wholeFrames.map(x=>Math.round(x.gpuMs*1000)/1000),
          sampledDrawP50:median(row.detailed.flatMap(x=>x.result.values.map(y=>y.gpuMs))),
          drawCount:row.census.drawCalls,programs:row.info.programs.length
        }));
      }catch(e){
        failures.push({region:region.name,count,round,engine,error:String(e?.stack||e)});
        save();throw e;
      }
    }
    const diff=extentDiff(pair[0].initialExtent,pair[1].initialExtent);
    if(diff.width>0.04||diff.height>0.04||diff.lonCenter>0.0002||diff.latCenter>0.0002){
      extentFailures.push({region:region.name,count,round,diff});
      save();throw Error('VIEWPORT_PARITY_FAILED '+JSON.stringify(diff));
    }
  }
  const summary=summarize();
  console.log('PER_DRAW_PROFILING_VALID '+summary.valid+' SCENES '+summary.observed+'/'+summary.expected+
    ' QUERIES '+summary.totalQueries+'/'+summary.expectedQueries);
  if(!summary.valid)process.exitCode=1;
}
try{await main()}catch(e){console.error('PER_DRAW_PROFILING_FAILED',e);failures.push({fatal:String(e?.stack||e)});save();process.exitCode=1}
finally{try{await browser?.close()}catch{}try{await vite?.close()}catch{}try{tileServer?.kill()}catch{}}
