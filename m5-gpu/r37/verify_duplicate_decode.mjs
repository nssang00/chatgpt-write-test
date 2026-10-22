import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {DirectTileWorkerPool} from '../our-renderer/integration/workers/DirectTileWorkerPool.js';
import {encodeTileLayerGroupTask,encodeTileWorkerTask} from '../our-renderer/integration/workers/DirectTileEncodeTask.js';
const named=[
 {layer:'water',style:{'fill-color':'rgba(90,154,227,0.75)'}},
 {layer:'building',style:{'fill-color':'rgba(210,194,169,0.52)','stroke-color':'#766655','stroke-width':1}},
 {layer:'road',style:{'stroke-color':'rgba(220,65,55,0.92)','stroke-width':3}},
 {layer:'railway',style:{'stroke-color':'rgba(70,70,70,0.9)','stroke-width':2}}
];
const coords=[[3492,1586],[3493,1586],[3492,1587],[3493,1587]];
const options={partialEarcut:true,unclipped:true,drawMode:'style-pass',closedLineJoins:true,polygonStrokeFringePx:1,polygonInsideSegmentFastPath:true,polygonEarBBoxPrecheck:true};
const tiles=coords.map(([x,y])=>({tileKey:`12/${x}/${y}`,bytes:readFileSync(new URL(`./fixtures/seoul/12/${x}/${y}.pbf`,import.meta.url)),extent:[(x-3492)*4096,(1587-y)*4096,(x-3491)*4096,(1588-y)*4096],options}));
const buffer=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const pool=new DirectTileWorkerPool({size:2,createWorker:()=>new Worker(new URL('../our-renderer/integration/workers/DirectTileEncodeWorker.node.mjs',import.meta.url))});await pool.ready;
let exact=0;
try{
 for(const count of [1,2,4,8,16]){
  const list=count===1?[named[1]]:count===2?[named[1],named[2]]:Array.from({length:count},(_,i)=>named[i%4]);
  for(let tileIndex=0;tileIndex<tiles.length;tileIndex++){
   const tile=tiles[tileIndex],groupTask={...tile,layers:list,allowDuplicateLayers:true};
   const result=encodeTileLayerGroupTask(groupTask),worker=await pool.submit(groupTask);
   assert.equal(result.decodeCalls,1);assert.equal(result.rows.length,count);assert.equal(worker.rows.length,count);
   for(let li=0;li<count;li++){
    const row=result.rows[li],work=worker.rows[li],single=encodeTileWorkerTask({...tile,...list[li]});
    assert.equal(row.layer,list[li].layer);assert.equal(row.featureCount,single.featureCount);
    for(const key of ['vertices','indices','lineInstances']){
     assert.ok(buffer(row.encoded[key]).equals(buffer(single.encoded[key])),`direct count=${count} tile=${tileIndex} layer=${li} key=${key}`);
     assert.ok(buffer(work.encoded[key]).equals(buffer(single.encoded[key])),`worker count=${count} tile=${tileIndex} layer=${li} key=${key}`);exact++;
    }
    assert.deepEqual(row.encoded.packets,single.encoded.packets);assert.deepEqual(work.encoded.packets,single.encoded.packets);
   }
  }
 }
 console.log(JSON.stringify({pass:true,layerCounts:[1,2,4,8,16],tiles:4,matchedStreams:exact,oneDecodePerTile:true}));
}finally{await pool.close()}