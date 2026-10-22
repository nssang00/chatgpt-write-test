import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]||'.');
async function patch(path,replaces){let s=await readFile(join(root,path),'utf8');for(const [a,b] of replaces){if(!s.includes(a))throw Error('R38 anchor missing '+path+': '+a.slice(0,70));s=s.replace(a,b);}await writeFile(join(root,path),s);console.log('R38_PATCHED',path)}
await patch('tests/round14_gpu_compare/round14_m5.html',[
 ["if(!['off','cold','warm'].includes(workerPoolMode))","if(!['off','cold','warm','deferred'].includes(workerPoolMode))"],
 ["if(workerPoolMode==='off'){","if(workerPoolMode==='off'||workerPoolMode==='deferred'){"],
 ["   if(iter>=0)samples.push(s);",`   if(iter>=0)samples.push(s);
   if(workerPoolMode==='deferred'&&iter>=0){
     // Actual first frame is encoded on main thread; Worker startup and
     // subsequent real PBF group tasks occur after visible GPU pixel capture.
     const tAfterPaint=ms();
     const backgroundPool=createBrowserDirectTileWorkerPool({size:workerCount});
     try{
       await backgroundPool.ready;
       s.deferredWorkerReadyAfterPaintMs=pad(ms()-tAfterPaint);
       const tasks=keys.map(([x,y])=>({allowDuplicateLayers:true,tileKey:"12/"+x+"/"+y,
         layers:spec.map(p=>({layer:p.layer,style:p.style})),
         bytes:bytesByTile.get(x+"/"+y),extent:extent(x,y),options:{
           partialEarcut:globalThis.__m5R29EarcutPartial,
           unclipped:validationClipMode==='legacy-unclipped',drawMode,
           closedLineJoins:validationQuery.get('closedLineJoins')==='1',
           polygonStrokeFringePx:Number(validationQuery.get('polygonStrokeFringePx')||0),
           polygonInsideSegmentFastPath:!round12Baseline,polygonEarBBoxPrecheck:!round12Baseline}}));
       const completed=await backgroundPool.map(tasks);
       s.deferredWorkerFinishedAfterPaintMs=pad(ms()-tAfterPaint);
       s.deferredWorkerJobs=completed.length;
       s.deferredDecodeCalls=completed.reduce((sum,x)=>sum+x.decodeCalls,0);
       if(s.deferredWorkerJobs!==4||s.deferredDecodeCalls!==4)throw Error('Deferred Worker verification failed');
       window.__m5R6Progress('deferred-worker-finished',sceneName,iter,s.deferredWorkerFinishedAfterPaintMs);
     }finally{await backgroundPool.close();}
   }`],
]);
await patch('tests/round14_gpu_compare/run_one.mjs',[
 ["!['off','cold','warm'].includes(expectedWorker.workerPoolMode)","!['off','cold','warm','deferred'].includes(expectedWorker.workerPoolMode)"],
]);