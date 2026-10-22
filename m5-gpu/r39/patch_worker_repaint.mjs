import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]||'.'),file=join(root,'tests/round14_gpu_compare/round14_m5.html');
let s=await readFile(file,'utf8');
const needle='       s.deferredWorkerJobs=completed.length;';
if(!s.includes(needle))throw Error('Missing R38 background group anchor');
s=s.replace(needle,`       const nextFrameStart=ms();
       for(let li=0;li<spec.length;li++)for(let ti=0;ti<keys.length;ti++){
         const [x,y]=keys[ti],row=completed[ti].rows[li];
         sources[li].emit('tileloadend',{tile:{getTileCoord:()=>[12,x,y],
           getFeatures:()=>[],getEncodedTile:()=>row.encoded,featureCount:row.featureCount??0}});
       }
       const nextStats=binding.renderFrame(frame);
       if(nextStats?.glError!==0)throw Error('R39 next-frame WebGL error '+nextStats?.glError);
       const nextPixels=rgbaFromCanvas(canvas);
       let changedBytes=0;
       for(let i=0;i<nextPixels.length;i++)if(nextPixels[i]!==canvasPixels[i])changedBytes++;
       s.deferredWorkerRepaintMs=pad(ms()-nextFrameStart);
       s.deferredWorkerRepaintChangedBytes=changedBytes;
       s.deferredWorkerRepaintDrawCalls=nextStats?.drawCalls;
       if(changedBytes!==0)throw Error('R39 Worker next-frame pixel bytes changed '+changedBytes);
       s.deferredWorkerJobs=completed.length;`);
await writeFile(file,s);console.log('R39_PATCHED next-frame Worker repaint and byte parity');