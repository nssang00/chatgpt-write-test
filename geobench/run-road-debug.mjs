import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const port=4175,root='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{
  env:process.env,stdio:['ignore','pipe','pipe']
});
server.stdout.on('data',d=>process.stdout.write('[vite] '+d));
server.stderr.on('data',d=>process.stderr.write('[vite] '+d));
let browser;
const report={cameras:'identical for 3 diagnostic modes',modes:{},browser:'Chromium SwiftShader (NOT RTX)'};
try{
 for(let tries=0;tries<100;tries++){
   try{if((await fetch(root+'/road-debug.html')).ok)break;}catch{}
   if(tries===99)throw Error('Vite diagnostic server failed');
   await new Promise(resolve=>setTimeout(resolve,200));
 }
 const args=['--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader'];
 browser=await chromium.launch({headless:true,args});
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
 const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 await fs.mkdir('results',{recursive:true});
 for(const mode of ['terrain','road','combined']){
   const response=await page.goto(root+'/road-debug.html?mode='+mode,{waitUntil:'load',timeout:120000});
   if(!response.ok())throw Error('Debug page HTTP '+response.status());
   await page.waitForFunction(()=>window.__roadDebug?.ready===true,null,{timeout:120000});
   await page.evaluate(()=>new Promise(requestAnimationFrame));
   report.modes[mode]=await page.evaluate(()=>window.__roadDebug);
   await page.screenshot({path:'results/raw-dem-debug-'+mode+'.png'});
 }
 report.errors=errors;report.pass=errors.length===0;
 await fs.writeFile('results/raw-dem-debug-captures.json',JSON.stringify(report,null,2));
 console.log('RAW_DEM_THREE_MODE_SCREENSHOT_RESULT',JSON.stringify(report));
 if(errors.length)throw Error('Diagnostic mode rendering errors '+JSON.stringify(errors));
}finally{
 if(browser)await browser.close();
 server.kill();
}
