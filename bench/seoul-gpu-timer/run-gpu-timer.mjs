import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { spawn } from 'node:child_process';
import { existsSync,mkdirSync,writeFileSync,appendFileSync } from 'node:fs';
import { dirname,resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const root=dirname(fileURLToPath(import.meta.url));
const out=resolve(process.env.GPU_TIMER_OUTPUT||join(root,'gpu-timer-results'));
mkdirSync(out,{recursive:true});
const mbtiles=resolve(process.env.MBTILES_PATH||join(root,'seoul.mbtiles'));
if(!existsSync(mbtiles))throw Error('MBTiles fixture missing '+mbtiles);
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
const counts=[18,32,64,128],engines=['maplibre','openlayers'],rounds=2,queries=5;
const raw=[],failures=[],viewportFailures=[];
let tileServer,vite,browser,gpu,tileInfo;
function percentile(a,p){
  if(!a.length)return null;
  const sorted=[...a].sort((x,y)=>x-y);
  return Math.round(sorted[Math.max(0,Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1))]*10000)/10000;
}
function save(){writeFileSync(join(out,'raw.json'),JSON.stringify({version:1,regions,counts,engines,rounds,queries,raw,failures,viewportFailures},null,2));}
async function health(){
  for(let i=0;i<100;i++){
    try{const r=await fetch('http://127.0.0.1:8787/health');if(r.ok)return await r.json()}catch{}
    await delay(250);
  }
  throw Error('Tile server health timeout');
}
function extentDiff(a,b){
  const x=e=>e[2]-e[0], y=e=>e[3]-e[1];
  return {widthRel:Math.abs(x(a)-x(b))/Math.max(x(a),x(b)),
    heightRel:Math.abs(y(a)-y(b))/Math.max(y(a),y(b)),
    lonCenter:Math.abs(a[0]+a[2]-b[0]-b[2])/2,
    latCenter:Math.abs(a[1]+a[3]-b[1]-b[3])/2};
}
function ink(buf){
  const png=PNG.sync.read(buf);let count=0;
  for(let y=0;y<png.height;y+=8)for(let x=0;x<png.width;x+=8){
    const k=(y*png.width+x)*4;
    if(png.data[k]<237||png.data[k+1]<237||png.data[k+2]<237)count++;
  }
  return count;
}
async function sample(engine,region,count,round){
  const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,
    serviceWorkers:'block',reducedMotion:'no-preference'});
  const page=await context.newPage(),jsErrors=[];
  let tiles200=0,tilesOther=0;
  page.on('pageerror',e=>jsErrors.push(String(e)));
  page.on('response',response=>{
    if(response.url().includes('/tiles/')){
      if(response.status()===200)tiles200++;else tilesOther++;
    }
  });
  try{
    await page.goto('http://127.0.0.1:5173/',{waitUntil:'load',timeout:30000});
    await page.waitForFunction(()=>!!window.__seoulBench);
    await page.evaluate(async()=>{await import('/src/timer.js');await import('/src/scene.js')});
    const result=await page.evaluate(a=>window.__seoulGpuTimer.run(a),{
      engine,lon:region.lon,lat:region.lat,count,zoom:16,queries
    });
    const row={region:region.name,round,engine,count,...result,tiles200,tilesOther};
    if(tiles200<1||tilesOther!==0)throw Error('INVALID_TILE_RESPONSES '+JSON.stringify({tiles200,tilesOther}));
    if(result.canvas.width!==1280||result.canvas.height!==720)throw Error('INVALID_CANVAS '+JSON.stringify(result.canvas));
    if(jsErrors.length)throw Error('PAGE_ERRORS '+JSON.stringify(jsErrors));
    if(result.contextInfo.length!==1||!result.contextInfo[0].extensionSupported)throw Error('GPU_TIMER_EXTENSION_NOT_AVAILABLE');
    if(!/NVIDIA|RTX/i.test(result.contextInfo[0].renderer))throw Error('NOT_REAL_NVIDIA_GL '+JSON.stringify(result.contextInfo));
    if(result.results.length!==queries||result.results.some(x=>!Number.isFinite(x.gpuMs)||x.gpuMs<=0||x.disjoint))
      throw Error('UNTRUSTWORTHY_GPU_TIMING '+JSON.stringify(result.results));
    if(round===0&&(count===18||count===128)){
      const image=await page.locator('#map').screenshot({animations:'disabled'});
      row.ink=ink(image);
      if(row.ink<25)throw Error('BLANK_RENDERED_MAP '+row.ink);
      const dir=join(out,'screenshots');mkdirSync(dir,{recursive:true});
      writeFileSync(join(dir,region.name+'-'+count+'-'+engine+'.png'),image);
    }
    return row;
  }finally{await context.close()}
}
function summarize(){
  const total=regions.length*counts.length*rounds*engines.length;
  const expectedQueryCount=total*queries;
  const results=counts.map(count=>{
    const item={count,distinctSourceLayers:18,styleEntries:count};
    for(const engine of engines){
      const rs=raw.filter(x=>x.engine===engine&&x.count===count);
      const allMs=rs.flatMap(x=>x.results.map(y=>y.gpuMs));
      const sceneMedian=rs.map(x=>percentile(x.results.map(y=>y.gpuMs),.5));
      item[engine]={scenes:rs.length,queryCount:allMs.length,
        glVersion:rs[0]?.contextInfo[0]?.webglVersion||null,
        gpuMs:{p50:percentile(allMs,.5),p95:percentile(allMs,.95)},
        sceneP50:{p50:percentile(sceneMedian,.5),p95:percentile(sceneMedian,.95)},
        coldMs:{p50:percentile(rs.map(x=>x.coldMs),.5),p95:percentile(rs.map(x=>x.coldMs),.95)}};
    }
    return item;
  });
  const valid=raw.length===total&&failures.length===0&&viewportFailures.length===0&&
    results.every(x=>engines.every(e=>x[e].queryCount===regions.length*rounds*queries));
  const summary={valid,observed:raw.length,expected:total,
    totalQueries:raw.reduce((n,x)=>n+x.results.length,0),expectedQueries:expectedQueryCount,
    versions:{chromium:browser.version(),gpu},tileInfo,
    setup:{regions,counts,rounds,queries,viewport:[1280,720],dpr:1,MLZoom:16,OLZoom:17},
    descriptions:[
      'Actual GL GPU time elapsed via EXT_disjoint_timer_query_webgl2 (ML WebGL2) or EXT_disjoint_timer_query (OL WebGL1).',
      'Queries bracket a single fully loaded, stationary forced map redraw; shaders/buffers are warmed by three untimed frames.',
      'The GPU_DISJOINT_EXT flag is checked before/after every query; disjoint, unsupported or timed-out queries fail closed.',
      'Results read asynchronously after QUERY_RESULT_AVAILABLE is true; no gl.finish or CPU wall-clock approximations.',
      'These timings exclude initial decoding, shader setup, network, layout and browser compositor/presentation time.',
      'Only 18 real source layers. Above 18, the existing source layers are repeated as style-entry stress tests.',
      'MapLibre N style layers vs OL single WebGLVectorTileLayer with N rules; WebGL2 vs WebGL1 remain implementation differences.',
      'Measurements are of all submitted WebGL GPU commands between query begin/end, not per-tile or per-rule isolated draws.'
    ],
    results,failures,viewportFailures};
  writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2));
  const lines=['# GPU elapsed-time queries (stationary single redraw)','Valid: '+valid+'; '+summary.totalQueries+'/'+expectedQueryCount+' queries; '+raw.length+'/'+total+' scenes',
    'GPU '+gpu.renderer,'',
    '|Styles|ML GPU P50 ms|ML GPU P95 ms|OL GPU P50 ms|OL GPU P95 ms|ML/OL GPU P50|',
    '|---:|---:|---:|---:|---:|---:|'];
  for(const row of results)lines.push('|'+[row.count,row.maplibre.gpuMs.p50,row.maplibre.gpuMs.p95,
    row.openlayers.gpuMs.p50,row.openlayers.gpuMs.p95,
    Math.round(row.maplibre.gpuMs.p50/row.openlayers.gpuMs.p50*1000)/1000].join('|')+'|');
  lines.push('','Hardware GPU query timestamp, NOT frame-to-frame browser FPS or initial render completion time.');
  const md=lines.join('\n')+'\n';
  writeFileSync(join(out,'summary.md'),md);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
  return summary;
}
async function main(){
  const executablePath=process.env.CHROME_PATH;
  if(!executablePath||!existsSync(executablePath))throw Error('Installed physical-GPU Chrome required');
  tileServer=spawn(process.env.PYTHON_CMD||'python',['-u','tileserver.py',mbtiles],{cwd:root,stdio:['ignore','pipe','pipe']});
  tileServer.stdout.on('data',x=>process.stdout.write('[tiles] '+x));
  tileServer.stderr.on('data',x=>process.stderr.write('[tiles] '+x));
  tileInfo=await health();
  if(tileInfo.tileCount<100)throw Error('Too few real Seoul MBTiles '+tileInfo.tileCount);
  vite=await createServer({configFile:join(root,'vite.config.js'),logLevel:'error'});
  await vite.listen();
  browser=await chromium.launch({executablePath,headless:true,
    args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11','--enable-webgl']});
  const probe=await browser.newPage({viewport:{width:1280,height:720}});
  await probe.goto('http://127.0.0.1:5173/');
  await probe.waitForFunction(()=>!!window.__seoulBench);
  gpu=await probe.evaluate(()=>window.__seoulBench.gpu);
  await probe.close();
  writeFileSync(join(out,'gpu.json'),JSON.stringify(gpu,null,2));
  if(!gpu.webgl||!/NVIDIA|GeForce|RTX/i.test(gpu.renderer)||
    /SwiftShader|WARP|Software|llvmpipe|Microsoft Basic/i.test(gpu.renderer))throw Error('HARDWARE_GL_NOT_VERIFIED '+JSON.stringify(gpu));
  for(const [index,region] of regions.entries())for(const count of (index%2===0?counts:[...counts].reverse()))for(let round=0;round<rounds;round++){
    const paired=[];
    const order=round%2===0?engines:[...engines].reverse();
    for(const engine of order){
      try{
        const row=await sample(engine,region,count,round);
        raw.push(row);paired.push(row);save();
        console.log('GPU_SAMPLE '+JSON.stringify({region:region.name,count,round,engine,
          gpuTimesMs:row.results.map(x=>x.gpuMs),gl:row.contextInfo[0].webglVersion,cold:row.coldMs}));
      }catch(e){
        failures.push({region:region.name,count,round,engine,error:String(e?.stack||e)});
        save();throw e;
      }
    }
    const diff=extentDiff(paired[0].initialExtent,paired[1].initialExtent);
    if(diff.widthRel>0.04||diff.heightRel>0.04||diff.lonCenter>0.0002||diff.latCenter>0.0002){
      viewportFailures.push({region:region.name,count,round,diff});
      save();throw Error('EXTENT_NOT_COMPARABLE '+JSON.stringify(diff));
    }
  }
  const result=summarize();
  console.log('GPU_TIMING_VALID '+result.valid+' SCENES '+result.observed+'/'+result.expected+' QUERIES '+result.totalQueries);
  if(!result.valid)process.exitCode=1;
}
try{await main()}catch(e){console.error('GPU_TIMING_FAILED',e);failures.push({fatal:String(e?.stack||e)});save();process.exitCode=1}
finally{try{await browser?.close()}catch{}try{await vite?.close()}catch{}try{tileServer?.kill()}catch{}}
