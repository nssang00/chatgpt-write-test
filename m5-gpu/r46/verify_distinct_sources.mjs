import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import MVT from '../../vendor/openlayers-10.10.0-runtime/node_modules/ol/format/MVT.js';
import {encodeDirectFeatureTile} from '../../our-renderer/integration/DirectFeatureWebGLPipeline.js';
import {DirectTileWorkerPool} from '../../our-renderer/integration/workers/DirectTileWorkerPool.js';
import {exactEncodedTile} from '../../our-renderer/integration/workers/EncodedTileExactGate.js';
const data=resolve(process.argv[2]||'R46-DATA'),manifest=JSON.parse(await readFile(join(data,'manifest.json'),'utf8'));
const out=resolve(process.argv[3]||join(data,'verify'));
await mkdir(out,{recursive:true});
const options={drawMode:'style-pass',unclipped:true,partialEarcut:true,
 closedLineJoins:true,polygonInsideSegmentFastPath:true,polygonEarBBoxPrecheck:true,polygonStrokeFringePx:0};
globalThis.__m5R29EarcutPartial=true;
globalThis.__m5R18PolygonStrokeUnclipped=true;
globalThis.__m5R18FlatUnclippedStroke=true;
globalThis.__m5R18ClosedRingJoin=true;
globalThis.__m5R30ScissorFill=false;
globalThis.__m5R30FastStrokeRing=false;
globalThis.__m5R30EarcutPool=false;
const styleFor=layer=>layer==='transportation'?{'stroke-color':'rgba(220,65,55,0.92)','stroke-width':3}:
 {'fill-color':'rgba(210,194,169,0.52)','stroke-color':'#766655','stroke-width':1};
const tasks=[];
for(const s of manifest.sources){
 const bytes=await readFile(join(data,'tiles',String(s.z),String(s.x),s.y+'.pbf'));
 const extent=[(s.x-2174)*4096,(1438-s.y-1)*4096,(s.x-2173)*4096,(1438-s.y)*4096];
 tasks.push({tileKey:s.z+'/'+s.x+'/'+s.y,layers:[{layer:s.layer,style:styleFor(s.layer)}],
  bytes,extent,options,index:s.index,sourceSHA:s.sha256});
}
assert.equal(tasks.length,32);
assert.equal(new Set(tasks.map(x=>x.sourceSHA)).size,32);
assert.equal(new Set(tasks.map(x=>x.tileKey)).size,32);
const suites=[];
for(const n of [8,16,32]){
 const started=performance.now();
 const pool=new DirectTileWorkerPool({size:2,maxQueue:64,maxCacheBytes:0,
  createWorker:()=>new Worker(new URL('../../our-renderer/integration/workers/DirectTileEncodeWorker.node.mjs',import.meta.url),{type:'module'})});
 const rows=[];
 try{
  await pool.ready;
  // Create independent source tasks; each task points to its own input bytes.
  const answers=await pool.map(tasks.slice(0,n));
  let matched=0,sumBytes=0,featureCount=0;
  for(let i=0;i<n;i++){
   const task=tasks[i],got=answers[i];
   assert.equal(got.tileKey,task.tileKey);
   assert.equal(got.decodeCalls,1);
   assert.equal(got.rows.length,1);
   const encoded=got.rows[0].encoded;
   const fs=new MVT({layers:[task.layers[0].layer]}).readFeatures(task.bytes,{extent:task.extent});
   assert.ok(fs.length>0,'nonempty real MVT source '+task.tileKey);
   const cpu=encodeDirectFeatureTile(fs,{styleFor:()=>task.layers[0].style,clipExtent:task.extent,
    drawMode:options.drawMode,polygonStrokeFringePx:0,closedLineJoins:true,
    polygonInsideSegmentFastPath:true,polygonEarBBoxPrecheck:true,stableStyleIdentityCache:true});
   assert.ok(exactEncodedTile(cpu,encoded),'byte-exact GPU vertex/index/line/packets '+task.tileKey);
   assert.equal(fs.length,got.rows[0].featureCount);
   assert.ok(encoded.byteLength>0,'nonempty encoded tile '+task.tileKey);
   matched++;sumBytes+=encoded.byteLength;featureCount+=fs.length;
   rows.push({tile:task.tileKey,sourceSHA:task.sourceSHA,featureCount:fs.length,encodedBytes:encoded.byteLength,exact:true});
  }
  const result={sourceCount:n,uniquePbfSHA:n,decodedTasks:n,workerRows:matched,
    exactGpuEncodedTiles:matched,featureCount,encodedBytes:sumBytes,
    elapsedMs:Math.round((performance.now()-started)*1000)/1000,poolStats:pool.stats,pass:true,rows};
  suites.push(result);console.log('R46_DISTINCT_CPU_WORKER_PASS',JSON.stringify({...result,rows:undefined}));
 }finally{await pool.close();}
}
const output={pass:suites.length===3&&suites.every(x=>x.pass),hardwareScope:'Node CPU/Worker equivalence only; GPU frames tested separately',suites};
await writeFile(join(out,'exact-parity.json'),JSON.stringify(output,null,2)+'\n');
if(!output.pass)process.exitCode=1;
