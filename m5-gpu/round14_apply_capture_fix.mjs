import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const dir = process.argv[2] || process.cwd();
const base = join(dir,'tests','round14_gpu_compare');
const a = join(base,'ol_stock.html'), b = join(base,'round14_m5.html');
const replace = (text,oldValue,newValue,label) => {
  if (!text.includes(oldValue)) throw new Error('Missing expected Round14 anchor: '+label);
  return text.replace(oldValue,newValue);
};
let ol = await readFile(a,'utf8');
let m5 = await readFile(b,'utf8');
ol=replace(ol,"String(e.reason)));","String(e.reason?.stack||e.reason)));",'OL rejection diagnostics');
ol=replace(ol,'rendercomplete + all WebGL contexts gl.finish + 2 RAF + nonempty canvas RGBA8 readback','worker-ready + gl.finish + synchronous postrender pixel capture + 2 RAF','OL timing');
ol=replace(ol,'const sleep=ms=>new Promise(r=>setTimeout(r,ms)),tick=', 'const tick=', 'unused sleep');
const start=ol.indexOf('async function capture(encodePng=true)');
const stop=ol.indexOf('async function bench(name,parts)',start);
if(start<0||stop<0)throw Error('OL capture anchors not found');
ol=ol.slice(0,start)+`function capture(encodePng=false){
 const c=document.createElement('canvas');c.width=c.height=512;
 const ctx=c.getContext('2d',{willReadFrequently:true});
 let drawn=0,errors=[];
 for(const source of parent.querySelectorAll('canvas')){
  try{ctx.drawImage(source,0,0,512,512);drawn++}
  catch(e){errors.push(String(e))}
 }
 const image=ctx.getImageData(0,0,512,512).data;
 let painted=0;for(let j=3;j<image.length;j+=4)if(image[j])painted++;
 return {paintedPixels:painted,canvasCount:drawn,drawErrors:errors,
  pngBase64:encodePng?c.toDataURL('image/png').split(',')[1]:null};
}
function waitForPresentedOlFrame(map,layers,expectedTiles,encodePng,timeoutMs=30000){
 return new Promise((resolve,reject)=>{
  let done=false,emptyFrames=0,diagnostic={},retry=null;
  const cleanup=()=>{clearTimeout(deadline);if(retry!==null)clearTimeout(retry);map.un('postrender',onFrame)};
  const finish=(error,value)=>{if(done)return;done=true;cleanup();if(error)reject(error);else resolve(value)};
  const deadline=setTimeout(()=>finish(new Error('OL worker geometry/presentation timeout: '+JSON.stringify(diagnostic))),timeoutMs);
  function onFrame(){
   if(done)return;
   try{
    const reps=layers.map((layer,index)=>{
     const r=layer.getRenderer();let total=0,ready=0,nonempty=0;
     r?.tileRepresentationCache?.forEach(rep=>{
      total++;if(rep.ready&&rep.buffers){ready++;if(rep.buffers.polygonBuffers?.length||rep.buffers.lineStringBuffers?.length||rep.buffers.pointBuffers?.length)nonempty++}
     });
     return {layer:index,total,ready,nonempty};
    });
    diagnostic={representations:reps,expectedTiles};
    if(!reps.every(x=>x.ready>=4&&x.total>=4))return;
    const renderers=[];let finishedGL=0;
    for(const canvas of parent.querySelectorAll('canvas')){
     const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
     if(!gl)continue;
     gl.finish();const err=gl.getError();if(err!==gl.NO_ERROR)throw Error('Stock OL WebGL error '+err);
     finishedGL++;
     const ext=gl.getExtension('WEBGL_debug_renderer_info');
     renderers.push(ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER));
    }
    if(!finishedGL)throw Error('Stock OL WebGL context missing');
    const image=capture(encodePng);
    diagnostic={...diagnostic,finishedGL,canvasCount:image.canvasCount,paintedPixels:image.paintedPixels,drawErrors:image.drawErrors};
    if(image.paintedPixels>0){finish(null,{image,finishedGL,renderer:renderers.join(' | '),diagnostic});return}
    if(++emptyFrames>=4){finish(new Error('OL pixel readback empty despite ready geometry: '+JSON.stringify(diagnostic)));return}
    retry=setTimeout(()=>{retry=null;if(!done)map.render()},16);
   }catch(error){finish(error)}
  }
  map.on('postrender',onFrame);
  map.renderSync();
 });
}
`+ol.slice(stop);
const a1=ol.indexOf('   const complete=Promise.race([');
const a2=ol.indexOf('   const sharedWall=performance.now()-t0;',a1);
if(a1<0||a2<0)throw Error('OL sample anchors not found');
ol=ol.slice(0,a1)+`   const ready=await waitForPresentedOlFrame(map,layers,parts.length*4,k===0);
   const readyWall=performance.now()-t0;
   if(failures.length)throw Error('OL tile loader failures: '+failures.join(', '));
   if(tileLoaded!==parts.length*4)throw Error('OL did not load exactly four source tiles per layer: '+tileLoaded+' vs '+parts.length*4);
   glCount=ready.finishedGL;gpuRenderer=ready.renderer;
   if(k===0){snap=ready.image;window.__m5R6Progress('ol-captured',name,k,snap.paintedPixels);}
   await tick();
`+ol.slice(a2);
ol=replace(ol,'wallToRendercompleteMs:Number(wall.toFixed(3))','wallToRenderablePixelsMs:Number(readyWall.toFixed(3))','OL sample label');
ol=replace(ol,'paintedPixels:ready.paintedPixels','paintedPixels:ready.image.paintedPixels','OL sample painted');
ol=replace(ol,"   if(k===0){snap=await capture(true);window.__m5R6Progress('ol-captured',name,k,snap.paintedPixels);}\n",'','OL stale capture');
ol=replace(ol,'wallToRendercompleteMs:Number(median(samples.map(x=>x.wallToRendercompleteMs)).toFixed(3))','wallToRenderablePixelsMs:Number(median(samples.map(x=>x.wallToRenderablePixelsMs)).toFixed(3))','OL median');
m5=replace(m5,'   const tPresent=ms();await afterFrame();const framePresentMs=ms()-tPresent;\n   const canvasPixels=rgbaFromCanvas(canvas); // 2D composited readback, same stage as stock OL.','   const canvasPixels=rgbaFromCanvas(canvas);\n   const tPresent=ms();await afterFrame();const framePresentMs=ms()-tPresent;','M5 capture ordering');
await writeFile(a,ol); await writeFile(b,m5);
console.log('INLINE_GPU_CAPTURE_FIX_APPLIED',a,b);
