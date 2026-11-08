// R82 prerequisite probe: does this exact self-hosted RTX runner have real WebGL1
// GPU timer query support and a headed desktop? Not an FPS/presentation test.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const candidate=resolve(process.argv[2]||'candidate');
const output=resolve(process.argv[3]||'artifacts/r82-probe');
const {chromium}=await import(pathToFileURL(join(candidate,'node_modules/playwright/index.mjs')).href);
await mkdir(output,{recursive:true});
const results={schema:'r82-windows-rtx-capability-probe-v1',
  candidateSha:process.env.R82_CANDIDATE_SHA??null,headless:{},headed:{},
  timestampUtc:new Date().toISOString(),errors:[]};
const args=['--enable-webgl','--disable-software-rasterizer','--disable-background-networking'];
for(const headed of [false,true]){
 const key=headed?'headed':'headless';
 let browser=null;
 try{
  browser=await chromium.launch({
   executablePath:process.env.M5_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',
   headless:!headed,args
  });
  const page=await browser.newPage({viewport:{width:1100,height:700}});
  await page.goto('about:blank');
  const data=await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');
   canvas.width=128;canvas.height=128;
   document.body.appendChild(canvas);
   const gl=canvas.getContext('webgl',{preserveDrawingBuffer:true});
   if(!gl)return {webgl1:false};
   const debug=gl.getExtension('WEBGL_debug_renderer_info');
   const gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;
   const ext=gl.getExtension('EXT_disjoint_timer_query');
   const result={webgl1:true,gpu,webglVersion:gl.getParameter(gl.VERSION),
      extensions:gl.getSupportedExtensions()||[],timerSupported:!!ext,
      queryMs:null,queryAvailable:false,disjoint:null};
   if(ext){
    const q=ext.createQueryEXT();
    if(q){
     ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,q);
     gl.clearColor(.2,.4,.6,1);gl.clear(gl.COLOR_BUFFER_BIT);
     ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
     gl.flush();
     const started=performance.now();
     // Yield to browser between polls; never sync-loop for a query.
     while(performance.now()-started<4000){
      await new Promise(resolve=>setTimeout(resolve,75));
      if(gl.getParameter(ext.GPU_DISJOINT_EXT)){
       result.disjoint=true;break;
      }
      if(ext.getQueryObjectEXT(q,ext.QUERY_RESULT_AVAILABLE_EXT)){
       result.queryAvailable=true;
       result.disjoint=false;
       result.queryMs=Number(ext.getQueryObjectEXT(q,ext.QUERY_RESULT_EXT))/1e6;
       break;
      }
     }
     ext.deleteQueryEXT(q);
    }
   }
   return result;
  });
  results[key]={launched:true,...data};
  await page.close();
 }catch(e){results[key]={launched:false,error:String(e)};results.errors.push(key+': '+String(e));}
 finally{await browser?.close().catch(()=>{});}
}
await writeFile(join(output,'capability.json'),JSON.stringify(results,null,2)+'\n');
console.log('R82_CAPABILITY_RESULT',JSON.stringify(results));
if(!results.headless.webgl1) process.exitCode=1;
