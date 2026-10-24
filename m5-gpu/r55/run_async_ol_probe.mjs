/** R55 real-Chromium asynchronous tile race probe.
 * This probes actual OL tile-loader cancellation/retry; it does NOT claim
 * production M5 Worker pipeline cancellation parity.
 */
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep,extname,join} from 'node:path';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright';
const root=resolve(process.argv[2]||'.'),out=resolve(process.argv[3]||join(root,'RESULTS','R55'));
await mkdir(out,{recursive:true});
let server,browser,page;
const report={pass:false,checks:[],errors:[],events:[],snapshots:{}};
try{
 const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.pbf':'application/octet-stream'};
 server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
  const file=resolve(root,'.'+decodeURIComponent(path));
  if(req.method!=='GET'||!file.startsWith(root+sep)||!existsSync(file))throw Error('not found');
  let body=await readFile(file);
  if(path==='/m5-gpu/r53/actual_32_ol_ui.html'){
   let html=body.toString();
   const needle='  const style=part.layer===';
   if(!html.includes(needle))throw Error('R53 fixture injection anchor changed');
   // Replace loader with delayed async Worker messages, generation guards,
   // intentional first-attempt failure, retry, and late old-generation response.
   const before='   tileLoadFunction:(tile,url)=>tile.setLoader((extent,resolution,projection)=>{';
   if(!html.includes(before))throw Error('R53 tile loader anchor changed');
   html=html.replace(before,`   tileLoadFunction:(tile,url)=>tile.setLoader((extent,resolution,projection)=>{
    const key=url.split('?')[0], seq=++globalThis.__r55.seq;
    const generation=globalThis.__r55.generation;
    const attempt=(globalThis.__r55.attempts[key]||0)+1;
    globalThis.__r55.attempts[key]=attempt;
    globalThis.__r55.events.push({type:'issued',key,seq,generation,attempt});
    const delay=generation===0?500:20;
    setTimeout(()=>{
     const stale=generation!==globalThis.__r55.generation;
     globalThis.__r55.events.push({type:stale?'late':'settled',key,seq,generation,attempt});
     if(stale)return;
     if(generation===1&&!globalThis.__r55.retried[key]){\n      globalThis.__r55.retried[key]=true;
      globalThis.__r55.events.push({type:'retry',key,seq});
      setTimeout(()=>{
       if(generation!==globalThis.__r55.generation)return;
       try{tile.setFeatures(format.readFeatures(pbf.get(key).slice(0),{extent,featureProjection:projection}));info.sourceLoads++}
       catch(e){info.sourceErrors++;info.errors.push(String(e));tile.setState(3)}
      },40);
      return;
     }
     try{tile.setFeatures(format.readFeatures(pbf.get(key).slice(0),{extent,featureProjection:projection}));info.sourceLoads++}
     catch(e){info.sourceErrors++;info.errors.push(String(e));tile.setState(3)}
    },delay);
    return;
   })/* R55_ASYNC */,`);
   // Existing synchronous body remains after injected callback: remove its exact tail.
   const start=html.indexOf('    const raw=pbf.get(url);',html.indexOf('R55_ASYNC'));
   const end=html.indexOf('   })',start);
   if(start<0||end<0)throw Error('R53 synchronous body removal failed');
   html=html.slice(0,start)+html.slice(end+6);
   html=html.replace('const layers=manifest.sources.map',`globalThis.__r55={seq:0,generation:0,attempts:{},retried:{},events:[]};
 const layers=manifest.sources.map`);
   html=html.replace(' globalThis.__r53Snapshot=()=>{',` globalThis.__r55.advance=()=>{globalThis.__r55.generation++;globalThis.__r55.events.push({type:'cancel',generation:0});manifest.sources.forEach((part,i)=>{const source=layers[i].getSource();source.setTileUrlFunction(([,x,y])=>x===i%8&&y===Math.floor(i/8)?part.x+'/'+part.y+'?r55='+globalThis.__r55.generation:undefined,'r55-'+globalThis.__r55.generation);source.clear();source.refresh();layers[i].changed();});map.renderSync();map.render();};
 globalThis.__r53Snapshot=()=>{`);
   body=Buffer.from(html);
  }
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
 }catch(e){res.writeHead(404);res.end(String(e))}});
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok)});
 browser=await chromium.launch({executablePath:process.env.M5_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--disable-software-rasterizer','--disable-background-networking']});
 page=await browser.newPage({viewport:{width:1120,height:720}});
 page.on('pageerror',e=>report.errors.push('pageerror '+e));
 page.on('console',m=>{if(m.type()==='error')report.errors.push('console '+m.text())});
 await page.goto('http://127.0.0.1:'+server.address().port+'/m5-gpu/r53/actual_32_ol_ui.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__r53?.ready||window.__r53?.errors?.length,{timeout:45000});
 const ready=await page.evaluate(()=>({ready:__r53.ready,errors:__r53.errors}));
 if(!ready.ready||ready.errors.length)throw Error('fixture not ready '+JSON.stringify(ready));
 await page.evaluate(()=>__r55.advance());
 await page.mouse.move(790,250);await page.mouse.down();await page.mouse.move(710,280,{steps:5});await page.mouse.up();
 await page.mouse.wheel(0,-120);
 await page.waitForFunction(()=>window.__r55?.events.some(e=>e.type==='issued'&&e.generation===1)||window.__r53?.errors?.length>0,null,{timeout:15000}).catch(async e=>{report.events=await page.evaluate(()=>window.__r55?.events||[]);report.snapshots.timeout=await page.evaluate(()=>({generation:window.__r55?.generation,attempts:window.__r55?.attempts,ready:window.__r53?.ready,errors:window.__r53?.errors,frames:window.__r53?.frames}));throw e});
 await page.waitForTimeout(1200);
 report.events=await page.evaluate(()=>__r55.events);
 report.snapshots.final=await page.evaluate(()=>__r53Snapshot());
 const count=t=>report.events.filter(e=>e.type===t).length;
 if(count('issued')<16||count('cancel')<1||count('late')<1||count('retry')<1||!report.events.some(e=>e.type==='issued'&&e.generation===1))throw Error('race coverage insufficient '+JSON.stringify({issued:count('issued'),cancel:count('cancel'),late:count('late'),retry:count('retry')}));
 report.checks.push('actual OL UI async tile issue, generation cancellation, late response and retry observed');
 if(report.snapshots.final.glError!==0||report.snapshots.final.painted<=0||report.snapshots.final.sourceErrors||report.snapshots.final.errors.length)throw Error('invalid framebuffer '+JSON.stringify(report.snapshots.final));
 report.checks.push('physical GL nonempty and error-free after delayed tile race');
 report.pass=true;
}catch(e){report.error=String(e.stack||e)}
finally{
 if(page){try{await page.screenshot({path:join(out,'r55-final.png')})}catch{}}
 if(report.errors.length){report.pass=false;report.error=(report.error||'')+' console '+JSON.stringify(report.errors)}
 await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));
 try{await browser?.close()}catch{}
 if(server?.listening)await new Promise(ok=>server.close(ok));
}
console.log(report.pass?'R55_ASYNC_OL_PROBE_PASS':'R55_ASYNC_OL_PROBE_FAIL',report.checks);
if(!report.pass)process.exitCode=1;
