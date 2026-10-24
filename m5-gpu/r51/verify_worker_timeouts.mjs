import assert from 'node:assert/strict';
import {DirectTileWorkerPool} from '../../our-renderer/integration/workers/DirectTileWorkerPool.js';
const sleep=t=>new Promise(r=>setTimeout(r,t));
function fake({ready=true,respond=true}={}){
 const f={handlers:new Map(),terminated:false,addEventListener(k,fn){this.handlers.set(k,fn)},
  postMessage(m){if(respond)queueMicrotask(()=>this.handlers.get('message')?.({data:{type:'result',id:m.id,ok:true,answer:{tileKey:m.task.tileKey,rows:[]}}}))},
  terminate(){this.terminated=true}};
 if(ready)setTimeout(()=>f.handlers.get('message')?.({data:{type:'ready'}}),1);
 return f;
}
// Silent, unreported Worker exit cannot strand an in-flight promise.
{
 let w;const p=new DirectTileWorkerPool({size:1,createWorker:()=>w=fake({respond:false}),bootTimeoutMs:100,taskTimeoutMs:20});
 await p.ready;await assert.rejects(p.submit({tileKey:'x'}),/result deadline exceeded/);
 assert.equal(p.closed,true);assert.equal(w.terminated,true);assert.equal(p.stats.workerErrors,1);
 await assert.rejects(p.submit({tileKey:'y'}),/closed/);
}
// Missing ready event cannot stall browser Worker boot indefinitely.
{
 let w;const p=new DirectTileWorkerPool({size:1,createWorker:()=>w=fake({ready:false}),bootTimeoutMs:20,taskTimeoutMs:100});
 await assert.rejects(p.ready,/boot deadline exceeded/);
 assert.equal(p.closed,true);assert.equal(w.terminated,true);
}
// Healthy Worker completion must clear deadline, not trigger spurious failure.
{
 let w;const p=new DirectTileWorkerPool({size:1,createWorker:()=>w=fake(),bootTimeoutMs:100,taskTimeoutMs:20});
 await p.ready;await p.submit({tileKey:'ok'});await sleep(40);
 assert.equal(p.closed,false);assert.equal(p.stats.completed,1);
 await p.close();assert.equal(w.terminated,true);
}
// A fresh controller can recover with original pool behavior after a silent failure.
{
 const p=new DirectTileWorkerPool({size:1,createWorker:()=>fake(),bootTimeoutMs:100,taskTimeoutMs:40});
 await p.ready;const r=await p.submit({tileKey:'recovered'});
 assert.equal(r.tileKey,'recovered');await p.close();
}
// postMessage synchronous failure must clear all deadlines and fail closed.
{
 let w;const p=new DirectTileWorkerPool({size:1,createWorker:()=>{
  w=fake();w.postMessage=()=>{throw Error('deliberate structured clone failure')};return w;
 },bootTimeoutMs:100,taskTimeoutMs:20});
 await p.ready;
 await assert.rejects(p.submit({tileKey:'bad-clone'}),/deliberate structured clone failure/);
 assert.equal(p.closed,true);assert.ok(p.stats.workerErrors>=1);assert.equal(w.terminated,true);
 await assert.rejects(p.submit({tileKey:'next'}),/closed/);
 await sleep(40);assert.equal(p.stats.workerErrors,1);
}
console.log(JSON.stringify({pass:true,cases:5,checks:['silent Worker termination task deadline','missing ready boot deadline','healthy task completion cancels deadline','fresh pool restart succeeds','postMessage synchronous failure fail-closed without orphan timer']},null,2));