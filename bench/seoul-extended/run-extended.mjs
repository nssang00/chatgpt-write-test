import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root=dirname(fileURLToPath(import.meta.url));
const out=resolve(process.env.EXTENDED_OUTPUT||join(root,'extended-results'));
mkdirSync(out,{recursive:true});
const mbtiles=resolve(process.env.MBTILES_PATH||join(root,'seoul.mbtiles'));
if(!existsSync(mbtiles))throw Error('Real Seoul MBTiles required: '+mbtiles);

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
const counts=[1,4,8,16,18,32];
const engines=['maplibre','openlayers'];
const rounds=2, zoom=16, durationMs=850;
const raw=[],failures=[],viewportFailures=[];
let tileServer, vite, browser, gpu, tileInfo;

function pct(a,p){
  if(!a.length)return null;
  const sorted=[...a].sort((x,y)=>x-y);
  return Math.round(sorted[Math.max(0,Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1))]*100)/100;
}
function writePartial(){
  writeFileSync(join(out,'raw.json'),JSON.stringify({
    version:2,zoom,regions,counts,engines,rounds,durationMs,
    raw,failures,viewportFailures
  },null,2));
}
function imageInk(data){
  const png=PNG.sync.read(data);
  let ink=0;
  for(let y=0;y<png.height;y+=8)for(let x=0;x<png.width;x+=8){
    const p=(y*png.width+x)*4;
    if(png.data[p]<237||png.data[p+1]<237||png.data[p+2]<237)ink++;
  }
  return ink;
}
function extentDifference(a,b){
  const x=(e)=>e[2]-e[0], y=(e)=>e[3]-e[1];
  return {
    widthRelative:Math.abs(x(a)-x(b))/Math.max(x(a),x(b)),
    heightRelative:Math.abs(y(a)-y(b))/Math.max(y(a),y(b)),
    centerLonDelta:Math.abs((a[0]+a[2]-b[0]-b[2])/2),
    centerLatDelta:Math.abs((a[1]+a[3]-b[1]-b[3])/2)
  };
}
async function waitHealth(){
  for(let i=0;i<100;i++){
    try{const r=await fetch('http://127.0.0.1:8787/health');if(r.ok)return await r.json()}catch{}
    await delay(250);
  }
  throw Error('No local tile-server health');
}
async function sample(engine,region,count,round){
  const context=await browser.newContext({
    viewport:{width:1280,height:720},deviceScaleFactor:1,
    serviceWorkers:'block',reducedMotion:'reduce'
  });
  let tiles200=0,tilesOther=0;
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('response',r=>{
    if(r.url().includes('/tiles/')){
      if(r.status()===200)tiles200++;else tilesOther++;
    }
  });
  try{
    await page.goto('http://127.0.0.1:5173/',{waitUntil:'load',timeout:30000});
    await page.waitForFunction(()=>Boolean(window.__seoulBench));
    await page.evaluate(async()=>{await import('/src/extended.js')});
    const result=await page.evaluate(async a=>window.__seoulExtended.run(a),
      {engine,lon:region.lon,lat:region.lat,zoom,count,durationMs});
    const row={engine,region:region.name,count,round,...result,tiles200,tilesOther};
    const names=[row.forward,row.back];
    if(tiles200<1)throw Error('NO_REAL_TILES: '+JSON.stringify(row));
    if(result.canvas.width<500||result.canvas.height<300)throw Error('CANVAS_TOO_SMALL: '+JSON.stringify(row));
    if(errors.length)throw Error('BROWSER_JS_ERROR: '+JSON.stringify(errors));
    if(names.some(x=>x.renderEvents<3 || x.rafFrames<3))throw Error('TOO_FEW_RENDER_EVENTS: '+JSON.stringify(row));
    if(count===18 && round===0){
      const png=await page.locator('#map').screenshot({animations:'disabled'});
      const ink=imageInk(png);
      if(ink<25)throw Error('BLANK_18_LAYER_SCREENSHOT: '+engine+' '+region.name+' '+ink);
      const folder=join(out,'screenshots');mkdirSync(folder,{recursive:true});
      writeFileSync(join(folder,region.name+'-'+engine+'.png'),png);
      row.inkSamples=ink;
    }
    return row;
  }finally{await context.close()}
}
function renderSummary(){
  const expected=regions.length*counts.length*engines.length*rounds;
  const cells=[];
  for(const count of counts){
    const item={count,interpretation:count===32?'duplicate-style stress':count===18?'all distinct':'distinct layers'};
    for(const engine of engines){
      const values=raw.filter(x=>x.engine===engine&&x.count===count);
      const summaryFor=metric=>({p50:pct(values.map(x=>metric(x)),0.5),p95:pct(values.map(x=>metric(x)),0.95)});
      item[engine]={
        n:values.length,
        cold:summaryFor(x=>x.coldMs),
        forwardSettle:summaryFor(x=>x.forward.settleMs),
        warmReturnSettle:summaryFor(x=>x.back.settleMs),
        forwardRenderP95:summaryFor(x=>x.forward.renderFrameP95Ms),
        warmRenderP95:summaryFor(x=>x.back.renderFrameP95Ms),
        forwardRAFFrameP95:summaryFor(x=>x.forward.rafP95Ms),
        returnRAFFrameP95:summaryFor(x=>x.back.rafP95Ms),
        forwardRenderEvents:summaryFor(x=>x.forward.renderEvents)
      };
    }
    cells.push(item);
  }
  const full=raw.filter(r=>r.count===18);
  const byRegion=regions.map(r=>{
    const ml=full.filter(x=>x.region===r.name&&x.engine==='maplibre');
    const ol=full.filter(x=>x.region===r.name&&x.engine==='openlayers');
    return {region:r.name,maplibre:{cold:pct(ml.map(x=>x.coldMs),.5),warm:pct(ml.map(x=>x.back.settleMs),.5),
        frameP95:pct(ml.map(x=>x.back.renderFrameP95Ms),.5)},
      openlayers:{cold:pct(ol.map(x=>x.coldMs),.5),warm:pct(ol.map(x=>x.back.settleMs),.5),
        frameP95:pct(ol.map(x=>x.back.renderFrameP95Ms),.5)}};
  });
  const valid=raw.length===expected&&failures.length===0&&viewportFailures.length===0&&
    cells.every(c=>engines.every(e=>c[e].n===regions.length*rounds));
  const result={
    valid,expected,observed:raw.length,
    reasons:valid?[]:['Incomplete samples or viewport mismatch'],
    experiment:'Cold initial map creation; first animated pan+zoom; back-to-origin warm pan+zoom on same map',
    notes:[
      'Each camera animation is 850ms; settle includes animation, tile load, completion event and two RAF.',
      'Render frame gaps use MapLibre render and OpenLayers postrender callbacks, not GPU timestamp queries.',
      'RAF gaps reflect main-thread browser callback cadence, not independent GPU rendering.',
      '32 style entries duplicate the 18 Planetiler source layers; it is NOT 32 independent tile layers.',
      'Renderer completion semantics and source parsing implementation are not identical.'
    ],
    tileInfo,versions:{chromium:browser.version(),gpu},
    setup:{regions,zoom,maplibreZoom:16,openlayersZoom:17,counts,rounds,durationMs,viewport:[1280,720],dpr:1},
    cells,byRegion,viewportFailures,failures
  };
  writeFileSync(join(out,'summary.json'),JSON.stringify(result,null,2));
  const lines=[
    '# Seoul warm interaction / layer scale benchmark',
    'Valid: '+result.valid+'; '+result.observed+'/'+expected+' scenes; GPU: '+gpu.renderer,
    '',
    '|Styles|ML cold P50|OL cold P50|ML warm P50|OL warm P50|ML render-frame P95|OL render-frame P95|',
    '|---|---:|---:|---:|---:|---:|---:|'
  ];
  for(const c of cells){
    const ml=c.maplibre,ol=c.openlayers;
    lines.push('|'+[c.count,ml.cold.p50,ol.cold.p50,ml.warmReturnSettle.p50,ol.warmReturnSettle.p50,ml.warmRenderP95.p50,ol.warmRenderP95.p50].join('|')+'|');
  }
  lines.push('','**Scope**: 8 Seoul areas, zoom16, 2 rounds per engine and layer count. 32 = duplicates.');
  lines.push('**Caveat**: cold is map creation to API-specific completed event; warm duration includes identical 850ms scripted animation. Event frame intervals are not GPU draw time.');
  const md=lines.join('\n')+'\n';
  writeFileSync(join(out,'summary.md'),md);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
  return result;
}
async function main(){
  const executablePath=process.env.CHROME_PATH;
  if(!executablePath||!existsSync(executablePath))throw Error('Installed Chrome required');
  tileServer=spawn(process.env.PYTHON_CMD||'python',['-u','tileserver.py',mbtiles],{cwd:root,stdio:['ignore','pipe','pipe']});
  tileServer.stdout.on('data',s=>process.stdout.write('[TILES] '+s));
  tileServer.stderr.on('data',s=>process.stderr.write('[TILES] '+s));
  tileInfo=await waitHealth();
  if(tileInfo.tileCount<100)throw Error('Real MBTiles missing tiles');
  vite=await createServer({configFile:join(root,'vite.config.js'),logLevel:'error'});
  await vite.listen();
  browser=await chromium.launch({
    executablePath,headless:true,
    args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11','--enable-webgl']
  });
  const probe=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
  await probe.goto('http://127.0.0.1:5173/');
  await probe.waitForFunction(()=>Boolean(window.__seoulBench));
  gpu=await probe.evaluate(()=>window.__seoulBench.gpu);
  await probe.close();
  writeFileSync(join(out,'gpu.json'),JSON.stringify(gpu,null,2));
  console.log('GPU '+JSON.stringify(gpu));
  if(!gpu.webgl||/SwiftShader|WARP|Software|llvmpipe|Microsoft Basic/i.test(gpu.renderer)||
    !/NVIDIA|RTX|AMD|Radeon|Intel/i.test(gpu.renderer))throw Error('HARDWARE_WEBGL_REQUIRED '+gpu.renderer);

  for(const region of regions)for(const count of counts)for(let round=0;round<rounds;round++){
    const paired=[];
    // Alternate order every round to reduce renderer-order bias.
    const order=round%2===0?engines:[...engines].reverse();
    for(const engine of order){
      try{
        const row=await sample(engine,region,count,round);
        raw.push(row);paired.push(row);writePartial();
        console.log('MEASURE '+JSON.stringify({
          area:region.name,styles:count,round,engine,cold:row.coldMs,
          first:row.forward.settleMs,warm:row.back.settleMs,
          warmFrameP95:row.back.renderFrameP95Ms,events:row.back.renderEvents
        }));
      }catch(err){
        failures.push({region:region.name,count,round,engine,error:String(err?.stack||err)});
        writePartial();throw err;
      }
    }
    if(paired.length===2){
      const diff=extentDifference(paired[0].initialExtent,paired[1].initialExtent);
      if(diff.widthRelative>0.04||diff.heightRelative>0.04||
        diff.centerLonDelta>0.0002||diff.centerLatDelta>0.0002){
        viewportFailures.push({region:region.name,count,round,diff,
          extents:paired.map(x=>({engine:x.engine,extent:x.initialExtent}))});
        writePartial();throw Error('GEOGRAPHIC_VIEWPORT_PARITY_FAILED '+JSON.stringify(diff));
      }
    }
  }
  const summary=renderSummary();
  console.log('EXTENDED_BENCHMARK_VALID '+summary.valid+' COUNT '+summary.observed+'/'+summary.expected);
  if(!summary.valid)process.exitCode=1;
}
try{await main()}catch(err){
  console.error('EXTENDED_BENCHMARK_FAILED',err);
  failures.push({fatal:String(err?.stack||err)});
  writePartial();
  process.exitCode=1;
}finally{
  try{await browser?.close()}catch{}
  try{await vite?.close()}catch{}
  try{tileServer?.kill()}catch{}
}
