import { chromium } from 'playwright';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const cwd=dirname(fileURLToPath(import.meta.url));
const mbtiles=resolve(process.env.MBTILES_PATH??join(cwd,'seoul.mbtiles'));
if(!existsSync(mbtiles))throw Error('Real MBTiles file required');
const output=resolve(process.env.TRANSITION_OUTPUT??join(cwd,'transition-results'));
mkdirSync(output,{recursive:true});
const regions=[
 {name:'gangnam',lon:127.0276,lat:37.4979},
 {name:'hongdae',lon:126.9238,lat:37.5563}
];
const counts=[0,1,18];
const rounds=4;
const raw=[],errors=[];
let tileServer,vite,browser,gpu;

const pctl=(a,p)=>{
 if(!a.length)return null;
 const v=[...a].sort((x,y)=>x-y);
 return Math.round(v[Math.ceil(v.length*p)-1]*100)/100;
};
function save(){
 writeFileSync(join(output,'raw.json'),JSON.stringify({regions,counts,rounds,raw,errors},null,2));
}
async function ready(){
 for(let i=0;i<100;i++){
  try{const r=await fetch('http://127.0.0.1:8787/health');if(r.ok)return await r.json()}catch{}
  await sleep(200);
 }
 throw Error('MBTiles HTTP service unavailable');
}
async function sample(region,count,transitionMs,round){
 const context=await browser.newContext({
  viewport:{width:1280,height:720},deviceScaleFactor:1,
  serviceWorkers:'block',reducedMotion:'no-preference'
 });
 const page=await context.newPage();
 let fetched=0,jsErrors=[];
 page.on('response',r=>{if(r.url().includes('/tiles/')&&r.status()===200)fetched++});
 page.on('pageerror',e=>jsErrors.push(String(e)));
 try{
  await page.goto('http://127.0.0.1:5173/',{waitUntil:'load'});
  await page.evaluate(async()=>{await import('/src/transition-probe.js')});
  const r=await page.evaluate(a=>window.__transitionProbe.run(a),
   {count,transitionMs,lon:region.lon,lat:region.lat});
  if(r.layerCount!==count)throw Error('Wrong MapLibre style layer count '+JSON.stringify(r));
  if(r.canvasSize[0]!==1280||r.canvasSize[1]!==720)throw Error('Wrong canvas size '+JSON.stringify(r));
  if(!r.loaded||!r.isStyleLoaded)throw Error('Map not complete');
  if(count>0&&fetched<1)throw Error('No real vector tile fetch for '+count);
  if(jsErrors.length)throw Error('Browser script errors '+JSON.stringify(jsErrors));
  return {region:region.name,count,transitionMs,round,tiles200:fetched,...r};
 }finally{await context.close()}
}
async function main(){
 const chrome=process.env.CHROME_PATH;
 if(!chrome||!existsSync(chrome))throw Error('Installed hardware Chrome required');
 tileServer=spawn(process.env.PYTHON_CMD??'python',['-u','tileserver.py',mbtiles],
  {cwd,stdio:['ignore','pipe','pipe']});
 tileServer.stdout.on('data',x=>process.stdout.write('[tiles] '+x));
 tileServer.stderr.on('data',x=>process.stderr.write('[tiles] '+x));
 const tileInfo=await ready();
 vite=await createServer({configFile:join(cwd,'vite.config.js'),logLevel:'error'});
 await vite.listen();
 browser=await chromium.launch({executablePath:chrome,headless:true,
  args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11','--enable-webgl']});
 const p=await browser.newPage({viewport:{width:1280,height:720}});
 await p.goto('http://127.0.0.1:5173/');
 await p.waitForFunction(()=>Boolean(window.__seoulBench));
 gpu=await p.evaluate(()=>window.__seoulBench.gpu);
 await p.close();
 if(!gpu.webgl||!/NVIDIA|RTX|AMD|Radeon|Intel/i.test(gpu.renderer)
  ||/SwiftShader|WARP|Software|llvmpipe|Microsoft Basic/i.test(gpu.renderer))
  throw Error('Real hardware WebGL required '+JSON.stringify(gpu));
 const modes=[null,0]; // No style.transition vs root duration zero
 for(const region of regions)for(const count of counts)for(let round=0;round<rounds;round++){
  const order=round%2===0?modes:[...modes].reverse();
  for(const transitionMs of order){
   try{
    const r=await sample(region,count,transitionMs,round);
    raw.push(r);save();
    console.log('MEASURE '+JSON.stringify({area:region.name,count,transitionMs,
     load:r.events.loadMs,idle:r.events.idleMs,finish:r.finishMs,tiles:r.tiles200}));
   }catch(e){
    errors.push({region:region.name,count,round,transitionMs,error:String(e?.stack??e)});
    save();throw e;
   }
  }
 }
 const cells=counts.map(count=>{
  const obj={count};
  for(const transitionMs of modes){
   const rows=raw.filter(x=>x.count===count&&x.transitionMs===transitionMs);
   obj[transitionMs===null?'default':'zero']={
    n:rows.length,
    loadP50:pctl(rows.map(x=>x.events.loadMs),.5),
    idleP50:pctl(rows.map(x=>x.events.idleMs),.5),
    finishP50:pctl(rows.map(x=>x.finishMs),.5),
    idleMinusLoadP50:pctl(rows.map(x=>x.events.idleMs-x.events.loadMs),.5)
   };
  }
  return obj;
 });
 const expected=regions.length*counts.length*rounds*modes.length;
 const valid=raw.length===expected&&errors.length===0;
 const summary={valid,expected,observed:raw.length,regions,counts,rounds,
  gpu,chromium:browser.version(),tileInfo,cells,errors};
 writeFileSync(join(output,'summary.json'),JSON.stringify(summary,null,2));
 const lines=[
  '## MapLibre first idle style transition A/B',
  'Valid '+valid+', samples '+raw.length+'/'+expected+', GPU '+gpu.renderer,
  '|style entries|default load P50|default idle P50|zero-transition load P50|zero-transition idle P50|idle improvement|',
  '|---|---:|---:|---:|---:|---:|',
  ...cells.map(c=>'|'+[c.count,c.default.loadP50,c.default.idleP50,c.zero.loadP50,
   c.zero.idleP50,Math.round((c.default.idleP50-c.zero.idleP50)*100)/100].join('|')+'|'),
  '',
  'Only changed variable: root style.transition duration (omitted/default vs 0). Map options include fadeDuration=0 in both arms.',
  'Each arm uses a new browser context, same local Planetiler MBTiles and identical viewport.'
 ];
 const md=lines.join('\n')+'\n';
 writeFileSync(join(output,'summary.md'),md);
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
 console.log('TRANSITION_AB_VALID '+valid+' '+raw.length+'/'+expected);
 if(!valid)process.exitCode=1;
}
try{await main()}catch(e){
 console.error('TRANSITION_AB_FAILED',e);
 errors.push({fatal:String(e?.stack??e)});save();process.exitCode=1;
}finally{
 try{await browser?.close()}catch{}
 try{await vite?.close()}catch{}
 try{tileServer?.kill()}catch{}
}
