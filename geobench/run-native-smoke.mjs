import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const port=4173,host='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:process.env});
server.stdout.on('data',d=>process.stdout.write('[vite] '+d));
server.stderr.on('data',d=>process.stderr.write('[vite] '+d));
let browser;
try{
  for(let i=0;i<100;i++){
    try{if((await fetch(host+'/native-3dtiles.html')).ok)break;}catch(e){}
    await new Promise(r=>setTimeout(r,250));
    if(i===99)throw Error('Vite not ready');
  }
  const options={headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling']};
  if(process.env.GEO_BROWSER_CHANNEL)options.channel=process.env.GEO_BROWSER_CHANNEL;
  if(process.env.GEO_TEST_KIND!=='hardware')options.args.push('--use-gl=angle','--use-angle=swiftshader');
  browser=await chromium.launch(options);
  const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
  const errors=[];const requested=new Set(),success=new Set();
  page.on('pageerror',e=>errors.push('pageerror '+String(e.stack||e)));
  page.on('console',m=>{if(m.type()==='error')errors.push('console '+m.text())});
  page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('.glb'))requested.add(r.url())});
  page.on('response',r=>{if(new URL(r.url()).pathname.endsWith('.glb')&&r.ok())success.add(r.url())});
  await page.goto(host+'/native-3dtiles.html',{waitUntil:'load',timeout:180000});
  try{
    await page.waitForFunction(()=>window.__streamBench?.ready===true,null,{timeout:120000});
    await page.waitForFunction(()=>window.__streamBench?.stats.success>=2,null,{timeout:120000});
  }catch(e){
    const debug=await page.evaluate(()=>({bench:!!window.__streamBench,stats:window.__streamBench?.stats,caption:document.getElementById('info')?.textContent})).catch(x=>({error:String(x)}));
    console.error('NATIVE_SMOKE_DIAGNOSTICS',JSON.stringify({errors,debug,requests:requested.size,success:success.size}));
    throw e;
  }
  for(let i=0;i<60;i++){
    await page.evaluate(i=>window.__streamBench.move(-160+320*i/59),i);
    await page.evaluate(()=>new Promise(requestAnimationFrame));
  }
  const status=await page.evaluate(()=>({
    gpu:window.__streamBench.gpu,
    stats:window.__streamBench.stats,
    rendered:window.__streamBench.rendered,
    manifest:window.__streamBench.manifest
  }));
  await fs.mkdir('results',{recursive:true});
  await page.screenshot({path:'results/native-3dtiles-real-browser.png',fullPage:true});
  const report={status,requestedGLB:requested.size,loadedGLB:success.size,errors};
  await fs.writeFile('results/native-smoke.json',JSON.stringify(report,null,2));
  console.log('NATIVE_3DTILES_SMOKE_RESULT',JSON.stringify(report));
  if(status.stats.errors||errors.length)throw Error('Native 3D Tiles errors: '+JSON.stringify(errors).slice(0,1800));
  if(status.rendered<20||status.stats.success<2||success.size<2)throw Error('Native 3D Tiles did not render/load sufficient GLBs');
  await page.close();
}finally{
  if(browser)await browser.close();
  server.kill();
}
