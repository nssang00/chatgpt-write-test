import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,sep,extname} from 'node:path';
import {chromium} from 'playwright';
const root=resolve(process.argv[2]||'.'),out=resolve(process.argv[3]||join(root,'RESULTS','R58'));
await mkdir(out,{recursive:true});
let browser,server,page;
const report={pass:false,checks:[],metrics:{},errors:[]};
try{
 server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
   const file=resolve(root,'.'+decodeURIComponent(url.pathname));
   if(!file.startsWith(root+sep))throw Error('invalid resource path');
   const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.pbf':'application/octet-stream'};
   const payload=await readFile(file);
   res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
   res.end(payload);
  }catch(e){res.writeHead(404);res.end(String(e));}
 });
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});
 browser=await chromium.launch({executablePath:process.env.M5_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--disable-software-rasterizer']});
 page=await browser.newPage();
 page.on('pageerror',e=>report.errors.push('pageerror: '+String(e)));
 page.on('console',m=>{if(m.type()==='error')report.errors.push('console: '+m.text())});
 await page.goto('http://127.0.0.1:'+server.address().port+'/m5-gpu/r58/real_worker_crash_32.html',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__r58?.done===true,null,{timeout:100000});
 const state=await page.evaluate(()=>window.__r58);
 Object.assign(report,{pass:state.pass,checks:state.checks,metrics:state.metrics,errors:[...report.errors,...state.errors]});
 if(!report.pass||report.checks.length!==2||report.errors.length||report.metrics.streamsExact<288||report.metrics.abortCycles!==3||report.metrics.recoveredTasks!==96||report.metrics.tiles!==32)throw Error('R58 32 MVT Worker crash storm gate failed: '+JSON.stringify(report));
 console.log('R58_ACTUAL_CHROMIUM_WORKER_32_3_CYCLE_PASS',JSON.stringify(report.metrics));
}catch(e){report.pass=false;report.error=String(e.stack||e);console.error('R58_FAIL',report.error);}
finally{await writeFile(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');try{await page?.screenshot({path:join(out,'worker-crash.png'),fullPage:true})}catch{}try{await browser?.close()}catch{}if(server?.listening)await new Promise(r=>server.close(r));}
if(!report.pass)process.exitCode=1;