/** Real OpenLayers source adapter tileloaderror -> recovery -> CPU/Worker full-frame parity. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const file=join(resolve(process.argv[2]||'.'),'tests/round14_gpu_compare/round14_m5.html');
let s=await readFile(file,'utf8');
const needle='if(iter>=0)samples.push(s);';
if(s.split(needle).length!==2)throw Error('R46 retry anchor not unique');
const probe=[
 "if(r45Enabled&&iter===0){",
 " const part=spec[0],key='12/'+part.x+'/'+part.y;",
 " const firstState=[...binding.layers.values()][0];",
 " const oldTile=firstState?.adapter.tiles.get(key);",
 " if(!oldTile)throw Error('R46 tile cancellation missing live original '+key);",
 " const before=firstState.adapter.tiles.size;",
 " sources[0].emit('tileloaderror',{tile:oldTile});",
 " if(firstState.adapter.tiles.has(key)||firstState.adapter.tiles.size!==before-1)",
 "  throw Error('R46 live tileloaderror did not remove MVT tile');",
 " const removedStats=binding.renderFrame(frame);",
 " if(removedStats.glError!==0)throw Error('R46 tile failure GL error');",
 " const lost=rgbaFromCanvas(canvas);let removedDiff=0;",
 " for(let i=0;i<lost.length;i++)if(lost[i]!==canvasPixels[i])removedDiff++;",
 " const raw=bytesByTile.get(part.x+'/'+part.y);",
 " const repairedFs=new MVT({layers:[part.layer]}).readFeatures(raw,{extent:extent(part.x,part.y)});",
 " if(!repairedFs.length)throw Error('R46 recovery tile unexpectedly empty');",
 " const reloaded={getTileCoord:()=>[12,part.x,part.y],getFeatures:()=>repairedFs};",
 " sources[0].emit('tileloadend',{tile:reloaded});",
 " if(firstState.adapter.tiles.get(key)!==reloaded)throw Error('R46 tile re-request not loaded');",
 " const cpuFrame=binding.renderFrame(frame);",
 " if(cpuFrame.glError!==0)throw Error('R46 recovery CPU GL error');",
 " const cpu=rgbaFromCanvas(canvas);",
 " await binding.deferredWorker.whenIdle();",
 " const postWorker=binding.renderFrame(frame);",
 " if(postWorker.glError!==0)throw Error('R46 recovery Worker GL error');",
 " const gpu=rgbaFromCanvas(canvas);",
 " let parityDiff=0,restoredDiff=0;",
 " for(let i=0;i<gpu.length;i++){if(gpu[i]!==cpu[i])parityDiff++;if(gpu[i]!==canvasPixels[i])restoredDiff++;}",
 " const m=binding.deferredWorker.snapshot();",
 " if(parityDiff!==0||restoredDiff!==0||m.failures!==0||m.parityRejects!==0||m.workerRows<spec.length+1)",
 "  throw Error('R46 failed/retried source stale pixel '+JSON.stringify({parityDiff,restoredDiff,metrics:m}));",
 " if(removedDiff<=0)throw Error('R46 tile cancellation visually did not remove features '+key);",
 " s.r45.eventRetry={sourceIndex:0,sourceSHA:part.sourceSHA,removedDiff,parityDiff,restoredDiff,",
 "   workerRowsAfterRetry:m.workerRows,groupsAfterRetry:m.groups,glErrors:0,",
 "   removedFromAdapter:true,loadedAfterRetry:true};",
 " console.log('R46_TILE_ERROR_RECOVERY_GPU_PASS',JSON.stringify(s.r45.eventRetry));",
 "}"
].join('\n   ');
s=s.replace(needle,probe+'\n   '+needle);
await writeFile(file,s);
console.log('R46_TILE_RETRY_INSTRUMENTED');
