import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DeferredDirectTileHandover as Handover} from '../../our-renderer/integration/workers/DeferredDirectTileHandover.js';
import {encodeTileLayerGroupTask} from '../../our-renderer/integration/workers/DirectTileEncodeTask.js';
import {exactEncodedTile} from '../../our-renderer/integration/workers/EncodedTileExactGate.js';
const bytes=readFileSync(new URL('../../tests/fixtures/seoul/12/3492/1586.pbf',import.meta.url));
const source={id:'source'},layer={id:'layer'},style={'stroke-color':'rgba(220,65,55,0.92)','stroke-width':3};
const extent=[0,4096,4096,8192],key='12/3492/1586';
const task={tileKey:key,layers:[{layer:'road',style}],bytes,extent,options:{drawMode:'style-pass',unclipped:true,partialEarcut:true,closedLineJoins:true,polygonInsideSegmentFastPath:true,polygonEarBBoxPrecheck:true}};
const output=encodeTileLayerGroupTask(task),expected=output.rows[0].encoded;
function deferred(){let done;return {promise:new Promise(resolve=>{done=resolve}),release:()=>done()};}
function setup({pool,maxPending=8,afterPaint=()=>Promise.resolve()}={}){
 const trace={commits:[],cpuRestores:[],errors:[],pools:0};
 const state={key:'road-0',source,layer,state:{opacity:1},sink:{replaceEncodedTile(k,row){trace.commits.push({k,row})}},adapter:{tiles:new Map(),ingestTile(t){trace.cpuRestores.push(t)}}};
 const tile={getTileCoord:()=>[12,3492,1586]};state.adapter.tiles.set(key,tile);
 const h=new Handover({enabled:true,resolveTask:async()=>task,createPool:()=>{trace.pools++;return pool},afterPaint,maxPending,getCpuEncoded:()=>expected,onError:e=>trace.errors.push(String(e))});
 function enqueue(){h.enqueue({state,tile,tileKey:key,clipExtent:extent})}
 return {trace,state,tile,h,enqueue};
}
async function spinUntil(predicate){for(let i=0;i<1000&&!predicate();i++)await Promise.resolve();assert.ok(predicate(),'async worker did not reach gate');}
// In-flight Worker response must not revive a cancelled tile.
{
 const gate=deferred();let started=false;
 const pool={ready:Promise.resolve(),submit:async()=>{started=true;await gate.promise;return output},async close(){}};
 const t=setup({pool});t.enqueue();t.h.afterDraw();await spinUntil(()=>started);
 t.h.invalidateTile(t.state,key);t.state.adapter.tiles.delete(key);
 gate.release();await t.h.whenIdle();
 assert.equal(t.trace.commits.length,0);assert.ok(t.h.metrics.staleDrops>=1);assert.equal(t.h.metrics.failures,0);await t.h.close();
}
// 256 rapid enqueue/invalidate operations cannot retain an unbounded backlog.
{
 const gate=deferred(),pool={ready:Promise.resolve(),submit:async()=>output,async close(){}};
 const t=setup({pool,maxPending:3,afterPaint:()=>gate.promise});
 for(let i=0;i<256;i++){
  const x=3492+i%16,otherKey=`12/${x}/1586`;
  const temp={getTileCoord:()=>[12,x,1586]};t.state.adapter.tiles.set(otherKey,temp);
  t.h.enqueue({state:t.state,tile:temp,tileKey:otherKey,clipExtent:extent});
  if(i%2===0){t.h.invalidateTile(t.state,otherKey);t.state.adapter.tiles.delete(otherKey)}
  assert.ok(t.h.pendingCount<=3,'unbounded pending backlog');
 }
 t.h.afterDraw();gate.release();await t.h.whenIdle();
 assert.ok(t.h.metrics.skipped>0);assert.equal(t.h.pendingCount,0);assert.equal(t.h.metrics.failures,0);await t.h.close();
}
// First successful swap, then injected failed Worker submit; fail-closed and explicit fresh-controller recovery.
{
 let count=0,closed=false;
 const pool={ready:Promise.resolve(),submit:async()=>{if(++count===2)throw Error('deliberate worker crash');return output},async close(){closed=true}};
 const t=setup({pool});t.enqueue();t.h.afterDraw();await t.h.whenIdle();
 assert.equal(t.trace.commits.length,1);assert.ok(exactEncodedTile(expected,t.trace.commits[0].row));
 t.enqueue();t.h.afterDraw();await t.h.whenIdle();
 assert.equal(t.h.failed,true);assert.equal(t.h.metrics.failures,1);assert.equal(t.trace.errors.length,1);
 assert.equal(t.trace.commits.length,1,'failed Worker must not partially overwrite CPU tile');
 const prior=t.trace.pools;t.enqueue();t.h.afterDraw();await t.h.whenIdle();assert.equal(t.trace.pools,prior);
 await t.h.close();assert.equal(closed,true);
 const recovered=setup({pool:{ready:Promise.resolve(),submit:async()=>output,async close(){}}});
 recovered.enqueue();recovered.h.afterDraw();await recovered.h.whenIdle();
 assert.equal(recovered.trace.commits.length,1);assert.equal(recovered.h.failed,false);
 assert.ok(exactEncodedTile(expected,recovered.trace.commits[0].row));await recovered.h.close();
}
console.log(JSON.stringify({pass:true,cases:3,checks:['late worker result after invalidation rejected','256 tile churn operations bounded at 3 pending records','worker submit failure fails closed with no failed-task install','fresh controller restart preserves exact real MVT buffer identity'],realPbfBytes:bytes.length},null,2));