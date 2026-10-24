/** Actual physical Chrome + OL Map drag/wheel E2E against R48 CPU-first overlay.
 * Not a substitute for full 32-source cancellation/retry churn or Worker crash recovery.
 */
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep,extname,join} from 'node:path';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright';
const root=resolve(process.argv[2]||'.'),out=resolve(process.argv[3]||join(root,'RESULTS','R50_UI'));
await mkdir(out,{recursive:true});
let page,browser,server;
const trace={pass:false,checks:[],snapshots:{},errors:[]};
try{
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.pbf':'application/octet-stream','.css':'text/css'};
 server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1'),file=resolve(root,'.'+decodeURIComponent(url.pathname));
   if(req.method!=='GET'||!file.startsWith(root+sep)||!existsSync(file))throw Error('Forbidden');
   res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
   res.end(await readFile(file));
  }catch(e){res.writeHead(404);res.end(String(e));}
 });
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});
 const exe=process.env.M5_BROWSER||'C:\Program Files\Google\Chrome\Application\chrome.exe';
 browser=await chromium.launch({executablePath:exe,headless:true,
  args:['--enable-webgl','--disable-software-rasterizer','--disable-background-networking','--window-size=1120,720']});
 page=await browser.newPage({viewport:{width:1120,height:720},deviceScaleFactor:1});
 page.on('pageerror',e=>trace.errors.push('pageerror '+String(e)));
 page.on('console',m=>{if(m.type()==='error')trace.errors.push('console '+m.text())});
 const url='http://127.0.0.1:'+server.address().port+'/m5-gpu/r50/actual_ol_ui.html';
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__r50?.ready===true||window.__r50?.errors?.length>0,{timeout:45000});
 let snapshot=()=>page.evaluate(()=>window.__r50Snapshot?.());
 let init=await snapshot();
 if(!init?.ready||init.errors?.length)throw Error('Map initialization failed '+JSON.stringify(init));
 await page.waitForFunction(()=>{const s=window.__r50Snapshot?.();return s?.tiles>0&&s?.painted>0&&s?.frames>0},{timeout:45000});
 init=await snapshot();trace.snapshots.initial=init;
 if(!/NVIDIA.*RTX 5060 Ti/i.test(init.renderer||''))throw Error('Hardware renderer wrong '+init.renderer);
 if(init.glError!==0||init.sourceErrors||init.errors.length||init.tiles<1||init.painted<=0)throw Error('initial rendering invalid '+JSON.stringify(init));
 trace.checks.push('physical RTX actual OL map source loaded and M5 framebuffer nonempty');
 await page.mouse.move(800,250);await page.mouse.down();await page.mouse.move(690,250,{steps:10});await page.mouse.up();
 await page.waitForTimeout(800);
 const drag=await snapshot();trace.snapshots.drag=drag;
 if(Math.abs(drag.view.center[0]-init.view.center[0])<50||drag.frames<=init.frames||drag.glError!==0||drag.painted<=0)
  throw Error('OL pointer drag did not change valid M5 frame '+JSON.stringify({init,drag}));
 trace.checks.push('real mouse pointer drag modifies OL View and repaints M5');
 await page.mouse.move(800,250);await page.mouse.wheel(0,-330);await page.waitForTimeout(1600);
 const zoom=await snapshot();trace.snapshots.zoom=zoom;
 if(Math.abs(zoom.view.resolution-drag.view.resolution)<0.01||zoom.frames<=drag.frames||zoom.glError!==0||zoom.painted<=0)
  throw Error('OL mouse wheel zoom did not change valid M5 frame '+JSON.stringify({drag,zoom}));
 if(zoom.hash===drag.hash)throw Error('OL zoom did not alter M5 RGBA8 framebuffer');
 trace.checks.push('real mouse wheel zoom changes OL resolution and M5 RGBA8');
 let frameCount=zoom.frames;
 for(let i=0;i<12;i++){
  const sign=i%2?-1:1;
  await page.mouse.move(800,260);await page.mouse.down();
  await page.mouse.move(800+sign*60,260+sign*35,{steps:3});await page.mouse.up();
  if(i%3===0){await page.mouse.wheel(0,sign*90);}
 }
 await page.waitForTimeout(1800);
 const churn=await snapshot();trace.snapshots.churn=churn;
 if(churn.frames<=frameCount||churn.glError!==0||churn.sourceErrors||churn.errors.length||churn.painted<=0)
  throw Error('OL repeated input map frame incorrect '+JSON.stringify(churn));
 trace.checks.push('12 drag interactions with intermittent wheel input retain nonempty GL frame');
 trace.pass=true;
}catch(e){trace.error=String(e?.stack||e);console.error('R50_UI_E2E_FAIL',trace.error)}
finally{
 if(page){try{await page.screenshot({path:join(out,'actual-ol-ui.png'),fullPage:true})}catch{}}
 await writeFile(join(out,'result.json'),JSON.stringify(trace,null,2)+'\n');
 try{await browser?.close()}catch{}
 if(server?.listening)await new Promise(r=>server.close(r));
}
console.log(trace.pass?'R50_ACTUAL_OL_UI_E2E_PASS':'R50_ACTUAL_OL_UI_E2E_FAIL',JSON.stringify(trace.checks));
if(!trace.pass)process.exitCode=1;