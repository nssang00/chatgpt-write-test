/** R46 32-source one-page GPU/worker stability instrumentation.
 * Does not restart browser/worker during the 30-minute sampling interval.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]||'.');
async function change(file,oldValue,newValue){
 const p=join(root,file);let s=await readFile(p,'utf8');
 const count=s.split(oldValue).length-1;
 if(count!==1)throw Error('R46 stability expected exactly one anchor in '+file+'; found '+count);
 s=s.replace(oldValue,newValue);await writeFile(p,s);
 console.log('R46_STABILITY_PATCHED',file);
}
await change('tests/round14_gpu_compare/run_one.mjs',
 "args.push(url+'&r45='+String(flags.r45||0)+'&r45Dpr='+String(flags.r45Dpr||1)+'&r46=1');",
 "args.push(url+'&r45='+String(flags.r45||0)+'&r45Dpr='+String(flags.r45Dpr||1)+'&r46=1&r46StabilitySeconds='+String(flags.r46StabilitySeconds||0));");
const insert=[
 "if(sceneName==='sources-32'&&iter===0&&r45Enabled){",
 " const targetSeconds=Math.min(1900,Math.max(0,Number(validationQuery.get('r46StabilitySeconds')||0)));",
 " if(targetSeconds>=60){",
 "  const started=ms();let loops=0,nonempty=0,glErrors=0,peakHeap=0;",
 "  const v0={...frame.viewState,center:[...frame.viewState.center]};",
 "  const usedHeap=()=>Number(performance.memory?.usedJSHeapSize||0);",
 "  const startHeap=usedHeap(),heaps=[{elapsedSeconds:0,bytes:startHeap}];",
 "  while(ms()-started<targetSeconds*1000){",
 "   const stage=loops%4;",
 "   frame.viewState={...v0,center:[v0.center[0]+(stage===1?128:stage===3?-160:0),v0.center[1]+(stage===2?96:0)],",
 "     resolution:stage===2?60:64,rotation:stage===3?0.04:0};",
 "   const gpu=binding.renderFrame(frame);",
 "   if(gpu?.glError!==0||backend.gl.isContextLost()||contextLost){glErrors++;throw Error('R46 long-lived RTX WebGL error/context loss '+glErrors);}",
 "   const pixels=rgbaFromCanvas(canvas);let alphaPixels=0;",
 "   for(let i=3;i<pixels.length;i+=4)if(pixels[i])alphaPixels++;",
 "   if(alphaPixels<=0)throw Error('R46 long-lived WebGL unexpectedly blank');",
 "   nonempty++;loops++;",
 "   if(loops%100===0){const heap=usedHeap();peakHeap=Math.max(peakHeap,heap);",
 "     heaps.push({elapsedSeconds:pad((ms()-started)/1000),bytes:heap,frames:loops});",
 "     window.__m5R6Progress('r46-stability',sceneName,loops,JSON.stringify(heaps.at(-1)));",
 "   }",
 "   await new Promise(resolve=>setTimeout(resolve,180));",
 "  }",
 "  frame.viewState=v0;const last=binding.renderFrame(frame);",
 "  if(last?.glError!==0)throw Error('R46 last WebGL frame error');",
 "  const end=rgbaFromCanvas(canvas);let changed=0;",
 "  for(let i=0;i<end.length;i++)if(end[i]!==canvasPixels[i])changed++;",
 "  if(changed!==0)throw Error('R46 after-stress full-frame pixel changed '+changed);",
 "  const durationMs=ms()-started,finalHeap=usedHeap();",
 "  if(durationMs<targetSeconds*980)throw Error('R46 did not run required long-lived interval');",
 "  if(nonempty<targetSeconds*3)throw Error('R46 insufficient real GPU frames '+nonempty);",
 "  if(startHeap>0&&finalHeap-startHeap>512*1024*1024)throw Error('R46 final heap grew >512MB');",
 "  s.r45.stability={targetSeconds,durationMs:pad(durationMs),gpuFrames:loops,nonemptyFrames:nonempty,",
 "    contextLoss:false,glErrors,restoredPixelChangedChannels:changed,startHeap,finalHeap,peakHeap,heaps};",
 "  console.log('R46_32_SOURCE_STABILITY_PASS',JSON.stringify({durationMs:pad(durationMs),loops,nonempty,finalHeap,changed}));",
 " }",
 "}"
].join('\n   ');
await change('tests/round14_gpu_compare/round14_m5.html',
 "if(iter>=0)samples.push(s);",insert+"\n   if(iter>=0)samples.push(s);");
