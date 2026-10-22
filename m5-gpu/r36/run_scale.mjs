/** R36 layer-instance scaling experiment; preserves original R35 ZIP. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {readPng} from './tests/round14_gpu_compare/png_compare.mjs';

const root=resolve(process.argv[2]||'.');
const out=resolve(process.argv[3]||join(root,'RESULTS','R36_LAYER_SCALE'));
const counts=[1,2,4,8,16], rounds=Number(process.env.R36_ROUNDS||3);
if(!Number.isInteger(rounds)||rounds<2||rounds>5)throw Error('R36_ROUNDS must be 2-5');
const trials=[
 {id:'ol_a',mode:'ol',pool:'off',workers:2,shared:0},
 {id:'control',mode:'m5',pool:'off',workers:2,shared:0},
 {id:'warm2',mode:'m5',pool:'warm',workers:2,shared:1},
 {id:'warm4',mode:'m5',pool:'warm',workers:4,shared:1},
 {id:'cold2',mode:'m5',pool:'cold',workers:2,shared:1},
 {id:'ol_b',mode:'ol',pool:'off',workers:2,shared:0}
];
const definition=[
 "const R36_BASE=[",
 " {layer:'water',style:{'fill-color':'rgba(90,154,227,0.75)'}},",
 " {layer:'building',style:{'fill-color':'rgba(210,194,169,0.52)','stroke-color':'#766655','stroke-width':1}},",
 " {layer:'road',style:{'stroke-color':'rgba(220,65,55,0.92)','stroke-width':3}},",
 " {layer:'railway',style:{'stroke-color':'rgba(70,70,70,0.9)','stroke-width':2}}",
 "];",
 "const R36_LAYERS=Number(new URL(location.href).searchParams.get('r36Layer'));",
 "if(![1,2,4,8,16].includes(R36_LAYERS))throw Error('Invalid R36 layer count');",
 "const R36_ORDER=R36_LAYERS===1?[1]:R36_LAYERS===2?[1,2]:Array.from({length:R36_LAYERS},(_,i)=>i%4);",
 "const SCENES={['layer-'+R36_LAYERS+'l']:R36_ORDER.map(i=>({layer:R36_BASE[i].layer,style:{...R36_BASE[i].style}}))};"
].join('\n');
const replaceOnce=(s,a,b,label)=>{if(!s.includes(a))throw Error('Missing R36 patch anchor '+label);return s.replace(a,b)};
function replaceScene(s,label){
 const a=s.indexOf('const SCENES={'),b=s.indexOf('};',a);
 if(a<0||b<a||b-a>3000)throw Error('Cannot patch SCENES '+label);
 return s.slice(0,a)+definition+s.slice(b+2);
}
const dir=join(root,'tests','round14_gpu_compare');
for(const [name,ol] of [['round14_m5.html',false],['ol_stock.html',true]]){
 const file=join(dir,name);let s=await readFile(file,'utf8');
 if(s.includes('R36_LAYERS'))throw Error('R36 already patched '+name);
 s=replaceScene(s,name);
 if(ol)s=replaceOnce(s,'result.scenes.length===3','result.scenes.length===1','OL scene count');
 await writeFile(file,s);
}
{
 const file=join(dir,'run_one.mjs');let s=await readFile(file,'utf8');
 s=replaceOnce(s,'const mode=flags.mode,runid=flags.id,rounds=Number(flags.rounds||5);',
 "const mode=flags.mode,runid=flags.id,rounds=Number(flags.rounds||5);const r36LayerCount=Number(flags.r36Layer);if(![1,2,4,8,16].includes(r36LayerCount))throw Error('bad R36 layers');const sceneName='layer-'+r36LayerCount+'l';",'layer args');
 s=replaceOnce(s,'&earcutPool=','&r36Layer='+'$'+'{r36LayerCount}&earcutPool=','browser URL');
 s=replaceOnce(s,'result.scenes.length!==3','result.scenes.length!==1','result scene count');
 s=replaceOnce(s,'/^(building-1l|road-1l|mixed-4l)\\.png$/','/^layer-(1|2|4|8|16)l\\.png$/','PNG name');
 s=replaceOnce(s,"for(const scene of ['building-1l','road-1l','mixed-4l'])",'for(const scene of [sceneName])','scene validation');
 await writeFile(file,s);
}
await mkdir(out,{recursive:true});
const failures=[],rows=[],raw=new Map();
const median=x=>[...x].sort((a,b)=>a-b)[Math.floor(x.length/2)];
const fixed=x=>Number(x.toFixed(3));
for(const n of counts){
 for(const t of trials){
  const id='l'+n+'_'+t.id;
  const args=['tests/round14_gpu_compare/run_one.mjs','--mode='+t.mode,'--id='+id,'--r36Layer='+n,'--rounds='+rounds,
    '--fringe=1','--closedJoins=1','--clipMode=legacy-unclipped','--tileUploadBatch=1','--partialEarcut=1',
    '--workerPool='+t.pool,'--workerCount='+t.workers,'--workerSharedDecode='+t.shared,'--workerCache=0','--out='+out];
  console.log('R36_START layer='+n+' campaign='+t.id);
  const run=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:600000,maxBuffer:4*1024*1024,
    env:{...process.env,M5_GPU_COMPARE_TIMEOUT_MS:'540000'}});
  process.stdout.write((run.stdout||'').slice(-1400));
  if(run.stderr)process.stderr.write(run.stderr.slice(-600));
  if(run.status!==0)failures.push(id+': process failed status='+run.status+' '+String(run.error||'').slice(0,200));
  try{
   const json=JSON.parse(await readFile(join(out,id,'result.json'),'utf8'));
   const scene=json.scenes?.find(s=>s.name==='layer-'+n+'l');
   raw.set(id,json);
   if(!json.pass||!scene?.pass||scene.samples?.length!==rounds)failures.push(id+': invalid GPU capture '+(json.error||scene?.error||''));
   const samples=scene?.samples||[],frame=scene?.medians?.coldToCapturedFrameMs;
   const startup=t.pool==='warm'?json.workerStartupOutsideColdMs:t.pool==='cold'&&samples.length?median(samples.map(s=>s.workerStartupMs)):0;
   const row={
    layerCount:n,campaign:t.id,mode:t.mode,pool:t.pool,workerCount:t.workers,pass:!!json.pass,
    frameMs:frame??null,workerStartupMs:startup??null,
    appStartupInclusiveMs:Number.isFinite(frame)&&Number.isFinite(startup)?fixed(frame+(t.pool==='warm'?startup:0)):null,
    cpuDecodeMs:samples.length?fixed(median(samples.map(s=>s.workerCpuDecodeMs||0))):null,
    cpuEncodeMs:samples.length?fixed(median(samples.map(s=>s.workerCpuEncodeMs||0))):null,
    decodeCalls:samples.length?median(samples.map(s=>s.decodeCalls||0)):null,
    sharedDecode:samples.length?samples.every(s=>s.sharedDecode===true):false,
    uploadBytes:samples.length?median(samples.map(s=>s.uploadBytes||0)):null,
    drawCalls:samples.length?median(samples.map(s=>s.drawCalls||0)):null,
    olWorkerInstances:json.workerInstancesObserved??null,
    gpuRenderer:scene?.renderer??null,
    error:json.error||scene?.error||null
   };
   rows.push(row);
   if(t.mode==='m5'&&!/NVIDIA.*RTX 5060 Ti/i.test(row.gpuRenderer||''))failures.push(id+': RTX 5060 Ti not verified');
   console.log('R36_FRAME '+JSON.stringify({layers:n,campaign:t.id,frameMs:row.frameMs,startupMs:startup,decodeCalls:row.decodeCalls,sharedDecode:row.sharedDecode}));
  }catch(e){failures.push(id+': '+String(e))}
  await writeFile(join(out,'R36_PROGRESS.json'),JSON.stringify({rows,failures},null,2)+'\n');
 }
}
const parity=[];
for(const n of counts){
 const read=async(c)=>readPng(join(out,'l'+n+'_'+c,'layer-'+n+'l.png')).catch(()=>null);
 const baseline=await read('control');
 for(const c of ['warm2','warm4','cold2']){
  const test=await read(c);let changed=null;
  if(baseline&&test&&baseline.w===test.w&&baseline.h===test.h){
   changed=0;for(let j=0;j<baseline.pixels.length;j++)if(baseline.pixels[j]!==test.pixels[j])changed++;
  }
  parity.push({layerCount:n,campaign:c,changedChannelBytes:changed,exact:changed===0});
  if(changed!==0)failures.push('l'+n+'_'+c+': M5 pixel mismatch='+changed);
 }
}
const comparisons=[];
for(const n of counts){
 const ol=rows.filter(x=>x.layerCount===n&&x.mode==='ol'&&Number.isFinite(x.frameMs));
 const olMs=ol.length===2?Math.min(...ol.map(x=>x.frameMs)):null;
 for(const r of rows.filter(x=>x.layerCount===n&&x.mode==='m5'))
  comparisons.push({layerCount:n,campaign:r.campaign,olMs,frameMs:r.frameMs,
   appStartupInclusiveMs:r.appStartupInclusiveMs,
   frameImprovementPct:olMs>0&&r.frameMs!=null?fixed(100*(1-r.frameMs/olMs)):null,
   appImprovementPct:olMs>0&&r.appStartupInclusiveMs!=null?fixed(100*(1-r.appStartupInclusiveMs/olMs)):null});
}
const result={schema:'r36-layer-scaling-exploratory-v1',pass:failures.length===0,
 method:'Distinct layer instances 1,2,4,8,16; at 8/16 only 4 unique Seoul MVT source types repeat. Three cold samples plus warmup for each of six campaigns; not a release gate.',
 rounds,rows,comparisons,parity,failures};
await writeFile(join(out,'R36_LAYER_SCALE_SUMMARY.json'),JSON.stringify(result,null,2)+'\n');
const cols=['layerCount','campaign','frameMs','workerStartupMs','appStartupInclusiveMs','cpuDecodeMs','cpuEncodeMs','decodeCalls','sharedDecode','uploadBytes','drawCalls','olWorkerInstances'];
await writeFile(join(out,'R36_LAYER_SCALE_SUMMARY.csv'),cols.join(',')+'\n'+rows.map(r=>cols.map(k=>JSON.stringify(r[k]??'')).join(',')).join('\n')+'\n');
console.log('R36_COMPLETE '+JSON.stringify({pass:result.pass,records:rows.length,failures:failures.slice(0,10)}));
if(!result.pass)process.exitCode=1;
