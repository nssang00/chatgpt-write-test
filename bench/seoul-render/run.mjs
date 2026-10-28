import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root=dirname(fileURLToPath(import.meta.url));
const out=resolve(process.env.BENCH_OUTPUT||join(root,'results'));
mkdirSync(out,{recursive:true});
const mbtiles=resolve(process.env.MBTILES_PATH||join(root,'seoul.mbtiles'));
if(!existsSync(mbtiles)) throw Error('MBTiles missing: '+mbtiles);
const regions=[
  {name:'gangnam',lon:127.0276,lat:37.4979},
  {name:'jongno',lon:126.9780,lat:37.5729},
  {name:'yeouido',lon:126.9245,lat:37.5219},
  {name:'hongdae',lon:126.9238,lat:37.5563},
  {name:'jamsil',lon:127.0995,lat:37.5133},
  {name:'seongsu',lon:127.0574,lat:37.5446},
  {name:'guro',lon:126.8840,lat:37.4970},
  {name:'nowon',lon:127.0570,lat:37.6540}
];
const suites=['polygons','lines','points','all'];
const zooms=[14,16];
const raw=[];
const failures=[];
let python, server, browser;
function save() {
  writeFileSync(join(out,'raw.json'),JSON.stringify({regions,zooms,suites,raw,failures},null,2));
}
async function waitForHealth() {
  for(let i=0;i<80;i++){
    try{const r=await fetch('http://127.0.0.1:8787/health');if(r.ok)return await r.json()}catch{}
    await delay(250);
  }
  throw Error('Tile server did not become healthy');
}
function nonWhite(buf) {
  const img=PNG.sync.read(buf);
  let n=0;
  for(let y=0;y<img.height;y+=8)for(let x=0;x<img.width;x+=8){
    const idx=(y*img.width+x)*4;
    if(img.data[idx]<237||img.data[idx+1]<237||img.data[idx+2]<237) n++;
  }
  return n;
}
function pctl(a,p) {
  if(!a.length)return null;
  const v=[...a].sort((x,y)=>x-y);
  return Math.round(v[Math.min(v.length-1,Math.max(0,Math.ceil(p*v.length)-1))]*100)/100;
}
function summarize(tileInfo,gpu) {
  const groups=[];
  for(const suite of suites)for(const zoom of zooms){
    const ml=raw.filter(r=>r.engine==='maplibre'&&r.suite===suite&&r.zoom===zoom).map(r=>r.elapsedMs);
    const ol=raw.filter(r=>r.engine==='openlayers'&&r.suite===suite&&r.zoom===zoom).map(r=>r.elapsedMs);
    groups.push({suite,zoom,maplibre:{samples:ml.length,p50:pctl(ml,.5),p95:pctl(ml,.95)},
      openlayers:{samples:ol.length,p50:pctl(ol,.5),p95:pctl(ol,.95)},
      olOverMlRatio:ml.length&&ol.length?Math.round(pctl(ol,.5)/pctl(ml,.5)*1000)/1000:null});
  }
  const valid=failures.length===0 && raw.length===regions.length*suites.length*zooms.length*4;
  const summary={valid,reason:valid?'all scenarios completed':'failed or incomplete',source:'Planetiler custom Seoul OSM MVT',
    versions:{node:process.version,chromium:browser.version(),userAgent:gpu.userAgent,renderer:gpu.renderer,vendor:gpu.vendor},
    input:{regions,zooms,suites,profileLayerCounts:{polygons:7,lines:7,points:4,all:18},
      viewport:[1280,720],dpr:1,sampleOrder:'ABBA',repetitionsPerEngine:2,
      tileInfo,mbtilesPath:mbtiles},
    results:groups,rawCount:raw.length,failures};
  writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2));
  return summary;
}
function writeSummary(summary){
  const rows=summary.results.map(r=>'|'+[r.suite,r.zoom,r.maplibre.p50,r.maplibre.p95,r.openlayers.p50,r.openlayers.p95,r.olOverMlRatio].join('|')+'|');
  const txt=[
    '## Seoul Planetiler MapLibre vs OL WebGL VectorTile benchmark',
    'GPU: '+summary.versions.renderer,
    'Valid: '+summary.valid+'; Samples: '+summary.rawCount+'; Tiles: '+summary.input.tileInfo.tileCount,
    '',
    '|suite|zoom|MapLibre P50 ms|MapLibre P95 ms|OL P50 ms|OL P95 ms|OL/MapLibre P50|',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...rows, '',
    'Measured durations: creation to idle/rendercomplete + 2 requestAnimationFrames; not isolated GPU time.',
    'Same tile bytes and locations; different renderer APIs/style pipelines; no symbol/text equivalence.'
  ].join('\n');
  writeFileSync(join(out,'summary.md'),txt);
  if(process.env.GITHUB_STEP_SUMMARY) {
    const {appendFileSync}=awaitImportFs();
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,txt+'\n');
  }
}
function awaitImportFs(){return {appendFileSync:(p,t)=>import('node:fs').then(m=>m.appendFileSync(p,t))};}
async function sample(engine,region,zoom,suite,repeat) {
  const context=await browser.newContext({
    viewport:{width:1280,height:720},deviceScaleFactor:1,
    serviceWorkers:'block',reducedMotion:'reduce'
  });
  const page=await context.newPage();
  let tiles200=0,tilesOther=0;
  const consoleErrors=[];
  page.on('response',response=>{
    if(response.url().includes('/tiles/')){
      if(response.status()===200) tiles200++;
      else tilesOther++;
    }
  });
  page.on('pageerror',error=>consoleErrors.push(String(error)));
  try {
    await page.goto('http://127.0.0.1:5173/',{waitUntil:'load',timeout:30000});
    await page.waitForFunction(()=>Boolean(window.__seoulBench),{timeout:30000});
    const measure=await page.evaluate(async args=>window.__seoulBench.run(args),
      {engine,suite,lon:region.lon,lat:region.lat,zoom});
    const shot=await page.locator('#map').screenshot({animations:'disabled'});
    const pixels=nonWhite(shot);
    const result={engine,region:region.name,zoom,suite,repeat,
      elapsedMs:Math.round(measure.elapsedMs*100)/100,
      layerCount:measure.layerIds.length,tile200:tiles200,tileOther:tilesOther,
      nonWhiteSamples:pixels,canvas:measure.canvas,gpu:measure.gpu,consoleErrors};
    if(tiles200<1)throw Error('No real tile HTTP 200: '+JSON.stringify(result));
    if(pixels<25)throw Error('Blank/near-blank rendered image: '+JSON.stringify(result));
    if(measure.canvas.width<500||measure.canvas.height<300)throw Error('Canvas unexpectedly small: '+JSON.stringify(result));
    if(consoleErrors.length)throw Error('JS page error: '+JSON.stringify(result));
    if(suite==='all' && zoom===16 && repeat===0){
      const dir=join(out,'screenshots');mkdirSync(dir,{recursive:true});
      writeFileSync(join(dir,region.name+'-'+engine+'.png'),shot);
    }
    return result;
  } finally {
    await context.close();
  }
}
async function main(){
  const executablePath=process.env.CHROME_PATH;
  if(!executablePath||!existsSync(executablePath))throw Error('CHROME_PATH must point to installed Chrome, not a headless-only fallback');
  python=spawn(process.env.PYTHON_CMD||'python',['-u','tileserver.py',mbtiles],{cwd:root,stdio:['ignore','pipe','pipe']});
  python.stdout.on('data',x=>process.stdout.write('[tile] '+x));
  python.stderr.on('data',x=>process.stderr.write('[tile] '+x));
  const tileInfo=await waitForHealth();
  if(tileInfo.tileCount<100)throw Error('Not enough actual MVT tiles: '+tileInfo.tileCount);
  server=await createServer({configFile:join(root,'vite.config.js'),logLevel:'error'});
  await server.listen();
  browser=await chromium.launch({
    executablePath,headless:true,
    args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11','--enable-webgl']
  });
  const probe=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
  await probe.goto('http://127.0.0.1:5173/');
  await probe.waitForFunction(()=>Boolean(window.__seoulBench));
  const gpu=await probe.evaluate(()=>({...window.__seoulBench.gpu,userAgent:navigator.userAgent}));
  writeFileSync(join(out,'gpu.json'),JSON.stringify(gpu,null,2));
  await probe.close();
  console.log('GPU_DIAGNOSTIC '+JSON.stringify(gpu));
  if(!gpu.webgl||/SwiftShader|WARP|Software|llvmpipe|Microsoft Basic/i.test(gpu.renderer)||
     !/NVIDIA|GeForce|RTX|AMD|Radeon|Intel/i.test(gpu.renderer)){
    throw Error('FAIL_CLOSED_HARDWARE_WEBGL_NOT_VERIFIED: '+gpu.renderer);
  }
  for(const r of regions)for(const z of zooms)for(const s of suites){
    for(let i=0;i<4;i++){
      const engine=['maplibre','openlayers','openlayers','maplibre'][i];
      const repeat=(i===0||i===1)?0:1;
      try {
        const row=await sample(engine,r,z,s,repeat);
        raw.push(row);save();
        console.log('SAMPLE '+r.name+' z'+z+' '+s+' '+engine+' '+row.elapsedMs+'ms tiles='+row.tile200);
      }catch(e){
        failures.push({region:r.name,zoom:z,suite:s,engine,error:String(e?.stack||e)});
        save();
        throw e;
      }
    }
  }
  const summary=summarize(tileInfo,gpu);
  writeSummary(summary);
  console.log('BENCHMARK_VALID '+summary.valid+' SAMPLES '+summary.rawCount);
  if(!summary.valid)process.exitCode=1;
}
try{await main()}catch(e){
  console.error('BENCHMARK_FAILED',e);
  failures.push({error:String(e?.stack||e)});save();
  process.exitCode=1;
}finally {
  try{await browser?.close()}catch{}
  try{await server?.close()}catch{}
  try{python?.kill()}catch{}
}
