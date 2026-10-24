/** R51 experimental bounded Worker boot and response timeouts; CPU-first default unchanged. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const file=join(resolve(process.argv[2]||'.'),'our-renderer/integration/workers/DirectTileWorkerPool.js');
let s=await readFile(file,'utf8');
const patches=[
['constructor({createWorker,size=2,maxCacheBytes=32*1024*1024,maxQueue=256}={}){',
 'constructor({createWorker,size=2,maxCacheBytes=32*1024*1024,maxQueue=256,taskTimeoutMs=45000,bootTimeoutMs=15000}={}){'],
["if(!Number.isInteger(size)||size<1||size>16)throw Error('size must be between 1 and 16');",
 "if(!Number.isInteger(size)||size<1||size>16)throw Error('size must be between 1 and 16');\n    if(!Number.isInteger(taskTimeoutMs)||taskTimeoutMs<1||taskTimeoutMs>300000||!Number.isInteger(bootTimeoutMs)||bootTimeoutMs<1||bootTimeoutMs>300000)throw Error('Worker deadlines out of range');\n    this.taskTimeoutMs=taskTimeoutMs;this.bootTimeoutMs=bootTimeoutMs;"],
['});promises.push(ready);',
 "});promises.push(ready);\n      slot.bootTimer=setTimeout(()=>this._failAll(Error('Tile Worker boot deadline exceeded'),slot),this.bootTimeoutMs);"],
["slot.ready=true;slot.resolveReady();this._pump();return;",
 "clearTimeout(slot.bootTimer);slot.ready=true;slot.resolveReady();this._pump();return;"],
["this.inflight.delete(message.id);slot.busy=false;",
 "clearTimeout(job.timer);this.inflight.delete(message.id);slot.busy=false;"],
["for(const entry of this.slots){if(!entry.ready)entry.rejectReady(reason);}",
 "for(const entry of this.slots){clearTimeout(entry.bootTimer);if(!entry.ready)entry.rejectReady(reason);}"],
["for(const job of this.inflight.values())job.reject(reason);",
 "for(const job of this.inflight.values()){clearTimeout(job.timer);job.reject(reason);}"],
["const job=this.queue.shift();slot.busy=true;this.inflight.set(job.id,job);",
 "const job=this.queue.shift();slot.busy=true;this.inflight.set(job.id,job);\n      job.timer=setTimeout(()=>this._failAll(Error('Tile Worker result deadline exceeded'),slot),this.taskTimeoutMs);"],
["catch(error){slot.busy=false;this.inflight.delete(job.id);job.reject(error);}",
 "catch(error){clearTimeout(job.timer);slot.busy=false;this.inflight.delete(job.id);job.reject(error);this._failAll(error,slot);}"],
["for(const job of this.inflight.values())job.reject(error);",
 "for(const job of this.inflight.values()){clearTimeout(job.timer);job.reject(error);}"],
["for(const slot of this.slots)if(!slot.ready)slot.rejectReady(error);",
 "for(const slot of this.slots){clearTimeout(slot.bootTimer);if(!slot.ready)slot.rejectReady(error);}"],
];
for(const [a,b] of patches){
 const n=s.split(a).length-1;
 if(n!==1)throw Error('R51 worker pool anchor mismatch '+n+': '+a);
 s=s.replace(a,b);
}
await writeFile(file,s);console.log('R51_WORKER_POOL_DEADLINES_INSTALLED');