/** R70 RTX stock OL 10.10.0 vs pinned R69 Worker OFF.
 * Isolated one-map-per-page, ABBA paired cold construction to first complete frame
 * after 32 independent PBF fixtures have been preloaded and all selected sources render.
 * Raw per-sample timings saved. No automatic performance-advantage claim.
 */
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]||'.');
const out=resolve(process.argv[3]||join(root,'artifacts/r70-benchmark'));
const rounds=Number(process.env.R70_ROUNDS||5);
if(!Number.isInteger(rounds)||rounds<3||rounds>12)throw Error('3..12 rounds required');
const playwright=await import(pathToFileURL(join(root,'node_modules/playwright/index.mjs')).href);
const {chromium}=playwright;
await mkdir(out,{recursive:true});
const summary={suite:'R70 isolated OL10.10.0 vs R69 Worker-OFF physical RTX',candidate:'ef70e86dac6dcaa079ee156f635417ef97a7e388',
 metric:'milliseconds from map construction through first all-selected-tiles-rendered frame and gl.finish',
 limitations:['preloaded real PBF fixtures, not a network or full page bootstrap benchmark',
 'Boost arm retains hidden OL layers for live stock-OL fallback, as in product demo',
 'OL rendercomplete versus Boost postrender callback has different completion semantics',
 'does not imply FPS, interaction latency or production performance'],
 rounds,order:['ol_a','boost_a','boost_b','ol_b'],scenes:[],raw:[],errors:[],valid:false,performanceGate:false};
const port=4178;
const server=spawn(process.execPath,[join(root,'examples/compare/serve.mjs')],{cwd:root,env:{...process.env,OLVT_EXAMPLE_PORT:String(port)},stdio:'pipe'});
let serverOutput='';
server.stdout.on('data',b=>serverOutput+=b.toString());
server.stderr.on('data',b=>serverOutput+=b.toString());
let browser;
const base='http://127.0.0.1:'+port;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const median=x=>{const a=[...x].sort((p,q)=>p-q);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2};
try{
 let live=false;
 for(let n=0;n<90;n++){
   if(server.exitCode!==null)throw Error('Example server exited '+server.exitCode+' '+serverOutput);
   try{const r=await fetch(base+'/examples/compare/');if(r.ok){live=true;break;}}catch{}
   await sleep(150);
 }
 if(!live)throw Error('Static HTTP server not ready '+serverOutput);
 const chrome=process.env.M5_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';
 browser=await chromium.launch({executablePath:chrome,headless:true,
   args:['--enable-webgl','--disable-software-rasterizer','--disable-background-networking','--window-size=560,580']});
 const probe=await browser.newPage({viewport:{width:512,height:512},deviceScaleFactor:1});
 summary.gpu=await probe.evaluate(()=>{
   const gl=document.createElement('canvas').getContext('webgl');
   if(!gl)throw Error('WebGL unavailable');
   const ext=gl.getExtension('WEBGL_debug_renderer_info');
   return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null};
 });
 await probe.close();
 if(!/NVIDIA.*RTX 5060 Ti/i.test(summary.gpu.renderer||''))throw Error('GPU wrong '+JSON.stringify(summary.gpu));
 console.log('R70_RTX_GPU_PASS',JSON.stringify(summary.gpu));
 async function sample(arm,count,phase,round){
   const page=await browser.newPage({viewport:{width:512,height:512},deviceScaleFactor:1});
   const errors=[];
   page.on('pageerror',e=>errors.push(String(e)));
   page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
   let result;
   try{
     const url=base+'/examples/perf/index.html?arm='+arm+'&count='+count;
     await page.goto(url,{waitUntil:'domcontentloaded',timeout:40000});
     await page.waitForFunction(()=>globalThis.__r70?.done===true,{timeout:42000});
     result=await page.evaluate(()=>({...globalThis.__r70}));
     if(errors.length||!result.ready||result.errors.length||result.loadedSources!==count||
       result.sourceShaCount!==count||result.glFinishCount<1||result.glCount<1||
       !result.workerOff||!Number.isFinite(result.ms)||result.ms<=0||
       (arm==='boost'&&result.packets<=0))
       throw Error('invalid sample '+JSON.stringify({result,errors}));
     if(round===0){
       const shot=await page.screenshot({path:join(out,'sample-'+arm+'-'+count+'-'+phase+'.png')});
       const img=shot.toString('base64');
       result.pixels=await page.evaluate(async b64=>{
         const image=new Image();
         image.src='data:image/png;base64,'+b64;await image.decode();
         const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
         const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
         const pixels=ctx.getImageData(0,0,c.width,c.height).data;
         let nonBackground=0;const different=new Set();
         for(let k=0;k<pixels.length;k+=4){const key=pixels[k]+','+pixels[k+1]+','+pixels[k+2];
           if(pixels[k]!==11||pixels[k+1]!==18||pixels[k+2]!==32)nonBackground++;
           if(k%64===0)different.add(key);
         }
         return {width:c.width,height:c.height,nonBackground,uniqueSampledColors:different.size};
       },img);
       if(result.pixels.nonBackground<30||result.pixels.uniqueSampledColors<3)
         throw Error('Blank/near-blank framebuffer '+JSON.stringify(result.pixels));
     }
     return result;
   }finally{await page.close()}
 }
 for(const count of [8,16,32]){
   const record={count,armMedians:{},samples:{}};
   for(const phase of summary.order){
     const arm=phase.startsWith('ol')?'ol':'boost';
     // Discard warm-up per phase; collect fresh-map pages for all measured rounds.
     const warm=await sample(arm,count,phase,0);
     const readings=[];
     for(let round=1;round<=rounds;round++){
       const data=await sample(arm,count,phase,round);
       const s={arm,count,phase,round,ms:Number(data.ms.toFixed(3)),
         loaded:data.loadedSources,glCount:data.glCount,
         glFinishCount:data.glFinishCount,packets:data.packets,frames:data.frames,
         gpu:summary.gpu.renderer};
       readings.push(s);summary.raw.push(s);
       console.log('R70_SAMPLE',JSON.stringify(s));
     }
     record.samples[phase]=readings.map(s=>s.ms);
     record.armMedians[phase]=Number(median(readings.map(s=>s.ms)).toFixed(3));
     console.log('R70_PHASE',JSON.stringify({count,phase,warmMs:warm.ms,medianMs:record.armMedians[phase]}));
   }
   const m=record.armMedians;
   record.olMedianMs=Number(median([m.ol_a,m.ol_b]).toFixed(3));
   record.boostMedianMs=Number(median([m.boost_a,m.boost_b]).toFixed(3));
   record.reductionPct=Number(((record.olMedianMs-record.boostMedianMs)/record.olMedianMs*100).toFixed(2));
   record.boostFasterBothArms=m.boost_a<m.ol_a&&m.boost_b<m.ol_b;
   summary.scenes.push(record);
   console.log('R70_SCENE_RESULT',JSON.stringify({count,stockOlMs:record.olMedianMs,boostMs:record.boostMedianMs,reductionPct:record.reductionPct,boostFasterBothArms:record.boostFasterBothArms}));
 }
 summary.valid=summary.errors.length===0&&summary.scenes.length===3&&summary.raw.length===rounds*12;
 summary.performanceGate=summary.valid&&summary.scenes.every(x=>x.boostFasterBothArms&&x.reductionPct>0);
}catch(e){summary.errors.push(String(e?.stack||e));console.error('R70_BENCH_FAIL',summary.errors.at(-1));}
finally{
 await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
 try{await browser?.close()}catch{}
 if(server.exitCode===null){server.kill();await sleep(1000);}
}
console.log('R70_BENCH_SUMMARY',JSON.stringify({valid:summary.valid,performanceGate:summary.performanceGate,scenes:summary.scenes.map(s=>({count:s.count,ol:s.olMedianMs,boost:s.boostMedianMs,reductionPct:s.reductionPct})),errors:summary.errors}));
if(!summary.valid)process.exitCode=1;
