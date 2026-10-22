import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {readPng} from './tests/round14_gpu_compare/png_compare.mjs';
const root=resolve(process.argv[2]||'.'),out=resolve(process.argv[3]||join(root,'RESULTS','R38_DEFERRED_GPU')),rounds=5;
const trials=[['ol_a','ol','off',2],['m5_a','m5','off',2],['deferred2_a','m5','deferred',2],['deferred4','m5','deferred',4],['deferred2_b','m5','deferred',2],['m5_b','m5','off',2],['ol_b','ol','off',2]];
const scenes=['building-1l','road-1l','mixed-4l'],failures=[],records=[],median=x=>[...x].sort((a,b)=>a-b)[Math.floor(x.length/2)];
await mkdir(out,{recursive:true});
for(const [id,mode,pool,workers] of trials){
 const args=['tests/round14_gpu_compare/run_one.mjs','--mode='+mode,'--id='+id,'--rounds='+rounds,'--fringe=1','--closedJoins=1','--clipMode=legacy-unclipped','--tileUploadBatch=1','--partialEarcut=1','--workerPool='+pool,'--workerCount='+workers,'--workerSharedDecode='+(pool==='deferred'?1:0),'--r37DuplicateDecode=1','--workerCache=0','--out='+out];
 console.log('R38_START '+id);
 const run=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:900000,maxBuffer:6*1024*1024,env:{...process.env,M5_GPU_COMPARE_TIMEOUT_MS:'750000'}});
 console.log((run.stdout||'').slice(-1000));
 if(run.stderr)console.error(run.stderr.slice(-500));
 if(run.status!==0)failures.push(id+': browser runner failed '+run.status);
 try{
  const json=JSON.parse(await readFile(join(out,id,'result.json'),'utf8'));
  if(!json.pass||json.scenes?.length!==3)failures.push(id+': invalid scene suite '+(json.error||''));
  for(const scene of scenes){
   const x=json.scenes?.find(s=>s.name===scene),samples=x?.samples||[];
   if(!x?.pass||samples.length!==rounds)failures.push(id+'/'+scene+': missing samples');
   if(mode==='m5'&&!/NVIDIA.*RTX 5060 Ti/i.test(x?.renderer||''))failures.push(id+'/'+scene+': RTX hardware not confirmed');
   if(pool==='deferred'&&!samples.every(s=>s.deferredWorkerReadyAfterPaintMs>0&&s.deferredWorkerJobs===4&&s.deferredDecodeCalls===4))failures.push(id+'/'+scene+': background Worker did not run after foreground');
   records.push({trial:id,scene,mode,pool,workers,frameMs:x?.medians?.coldToCapturedFrameMs??null,
    postPaintWorkerReadyMs:pool==='deferred'&&samples.length?median(samples.map(s=>s.deferredWorkerReadyAfterPaintMs)):null,
    postPaintWorkerDoneMs:pool==='deferred'&&samples.length?median(samples.map(s=>s.deferredWorkerFinishedAfterPaintMs)):null});
  }
 }catch(e){failures.push(id+': '+String(e))}
 await writeFile(join(out,'R38_PROGRESS.json'),JSON.stringify({records,failures},null,2)+'\n');
}
const imageParity=[];
for(const scene of scenes){
 try{
  const base=await readPng(join(out,'m5_a',scene+'.png'));
  for(const id of ['deferred2_a','deferred2_b','deferred4']){
   const a=await readPng(join(out,id,scene+'.png'));
   let changed=a.w!==base.w||a.h!==base.h?-1:0;
   if(changed===0)for(let i=0;i<a.pixels.length;i++)if(a.pixels[i]!==base.pixels[i])changed++;
   imageParity.push({scene,trial:id,changedChannelBytes:changed,exact:changed===0});
   if(changed!==0)failures.push(id+'/'+scene+': pixel mismatch='+changed);
  }
 }catch(e){failures.push(scene+': PNG unavailable '+String(e))}
}
const comparisons=[];
for(const scene of scenes){
 const ol=records.filter(x=>x.scene===scene&&x.mode==='ol');
 const olBaselineMs=ol.length===2?Math.min(...ol.map(x=>x.frameMs)):null;
 for(const r of records.filter(x=>x.scene===scene&&x.pool==='deferred')){
  const improvementPct=olBaselineMs>0&&r.frameMs>0?Number((100*(1-r.frameMs/olBaselineMs)).toFixed(3)):null;
  comparisons.push({scene,trial:r.trial,olBaselineMs,frameMs:r.frameMs,improvementPct,pass:improvementPct!==null&&improvementPct>=50,postPaintWorkerReadyMs:r.postPaintWorkerReadyMs});
  if(!(improvementPct>=50))failures.push(r.trial+'/'+scene+': visible first-paint reduction <50%');
 }
}
const result={schema:'r38-deferred-worker-foreground-v1',pass:failures.length===0,rounds,records,comparisons,imageParity,failures,
 caveat:'First visible frame is CPU encoded. Worker startup plus subsequent real PBF work occurs after first pixels, measured separately; this is NOT an always-worker cold start and does not replace R35 strict acceptance.'};
await writeFile(join(out,'R38_ACCEPTANCE.json'),JSON.stringify(result,null,2)+'\n');
console.log('R38_RESULT '+JSON.stringify({pass:result.pass,comparisons,failures}));
if(!result.pass)process.exitCode=1;