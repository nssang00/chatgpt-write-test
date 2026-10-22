import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const dir=resolve(process.argv[2]||'RESULTS/R39_DEFERRED_REPAINT');
const scenes=['building-1l','road-1l','mixed-4l'],ids=['deferred2_a','deferred4','deferred2_b'];
const failures=[],rows=[];
for(const id of ids)for(const scene of scenes){
 try{
  const report=JSON.parse(await readFile(join(dir,id,'result.json'),'utf8'));
  const ss=report.scenes.find(x=>x.name===scene).samples;
  if(ss.length!==5)failures.push(id+'/'+scene+': sample count');
  for(const [i,s] of ss.entries()){
   const ok=s.deferredWorkerRepaintChangedBytes===0&&s.deferredWorkerRepaintMs>0&&s.deferredWorkerRepaintDrawCalls>0&&s.deferredWorkerReadyAfterPaintMs>0;
   if(!ok)failures.push(id+'/'+scene+'/'+i+': incomplete or inexact Worker repaint');
   rows.push({trial:id,scene,iteration:i,changedBytes:s.deferredWorkerRepaintChangedBytes,repaintMs:s.deferredWorkerRepaintMs,readyMs:s.deferredWorkerReadyAfterPaintMs});
  }
 }catch(e){failures.push(id+'/'+scene+': '+String(e))}
}
const result={schema:'r39-deferred-worker-repaint-v1',pass:failures.length===0,checks:rows.length,rows,failures};
await writeFile(join(dir,'R39_WORKER_REPAINT_ACCEPTANCE.json'),JSON.stringify(result,null,2)+'\n');
console.log('R39_REPAINT_RESULT '+JSON.stringify({pass:result.pass,checks:result.checks,failures}));
if(!result.pass)process.exitCode=1;