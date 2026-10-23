/** R45 Chromium WebGL real view transforms before and after Worker handover. */
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const file=join(resolve(process.argv[2]||'.'),'tests/round14_gpu_compare/round14_m5.html');
let s=await readFile(file,'utf8');
function replaceOnce(a,b){
 const count=s.split(a).length-1;
 if(count!==1)throw Error('R45 dynamic instrumentation expected one anchor, got '+count+': '+a.slice(0,70));
 s=s.replace(a,b);
}
replaceOnce(" await handover.whenIdle();",[
 " const r45BaseView={...frame.viewState,center:[...frame.viewState.center]};",
 " const r45Cases=[",
 "  {name:'pan',center:[4512,3840],resolution:16,rotation:0},",
 "  {name:'zoom',center:[4096,4096],resolution:12,rotation:0},",
 "  {name:'rotate',center:[4096,4096],resolution:16,rotation:0.3},",
 "  {name:'panZoomRotate',center:[4360,3890],resolution:14,rotation:-0.21}",
 " ];",
 " const r45Controls=[];",
 " for(const view of r45Cases){",
 "  frame.viewState={...r45BaseView,center:view.center,resolution:view.resolution,rotation:view.rotation};",
 "  const stat=binding.renderFrame(frame);",
 "  if(stat?.glError!==0)throw Error('R45 dynamic CPU GL error '+view.name);",
 "  const pix=rgbaFromCanvas(canvas);",
 "  if(pix.length!==canvasPixels.length)throw Error('R45 dynamic framebuffer dimensions differ');",
 "  let painted=0,transformed=0;",
 "  for(let i=3;i<pix.length;i+=4)if(pix[i]!==0)painted++;",
 "  for(let i=0;i<pix.length;i++)if(pix[i]!==canvasPixels[i])transformed++;",
 "  if(painted===0||transformed===0)throw Error('R45 dynamic blank/unchanged '+view.name);",
 "  r45Controls.push({pixels:pix,painted,transformed});",
 " }",
 " frame.viewState=r45BaseView;",
 " binding.renderFrame(frame);",
 " await handover.whenIdle();"
].join('\n'));
replaceOnce(" const after=rgbaFromCanvas(canvas);",[
 " const after=rgbaFromCanvas(canvas);",
 " const r45Dynamic=[];",
 " for(let j=0;j<r45Cases.length;j++){",
 "  const view=r45Cases[j],ctrl=r45Controls[j];",
 "  frame.viewState={...r45BaseView,center:view.center,resolution:view.resolution,rotation:view.rotation};",
 "  const st=binding.renderFrame(frame);",
 "  if(st?.glError!==0)throw Error('R45 dynamic Worker GPU error '+view.name);",
 "  const pix=rgbaFromCanvas(canvas);",
 "  let changedChannels=0;",
 "  if(pix.length!==ctrl.pixels.length)throw Error('R45 Worker frame dimensions differ');",
 "  for(let k=0;k<pix.length;k++)if(pix[k]!==ctrl.pixels[k])changedChannels++;",
 "  r45Dynamic.push({view:view.name,paintedPixels:ctrl.painted,",
 "    viewChangedChannels:ctrl.transformed,workerChangedChannels:changedChannels,drawCalls:st.drawCalls});",
 "  if(changedChannels!==0||st.drawCalls<=0)throw Error('R45 dynamic Worker discrepancy '+view.name+' channels='+changedChannels);",
 " }",
 " frame.viewState=r45BaseView;",
 " binding.renderFrame(frame);"
].join('\n'));
replaceOnce(" r45Evidence={...snap,differentChannels,dpr:r45Dpr,rendererName,",
 " r45Evidence={...snap,differentChannels,dynamicTests:r45Dynamic,dpr:r45Dpr,rendererName,");
await writeFile(file,s);
console.log('R45_DYNAMIC_INSTRUMENTED real pan zoom rotate and panZoomRotate transforms with nonempty CPU and Worker exact frame checks');
