import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,sep,extname} from 'node:path';
import {chromium} from 'playwright';
const root=resolve(process.argv[2]||'.'),out=resolve(process.argv[3]||join(root,'RESULTS','R52'));
await mkdir(out,{recursive:true});
let browser,server,page;
const report={pass:false,checks:[],metrics:{},errors:[]};
try{
 server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1'),file=resolve(root,'.'+decodeURIComponent(url.pathname));
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
 await page.goto('http://127.0.0.1:'+server.address().port+'/m5-gpu/r52/real_worker_crash.html',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>window.__r52?.done===true,null,{timeout:45000});
 const state=await page.evaluate(()=>window.__r52);
 Object.assign(report,{pass:state.pass,checks:state.checks,metrics:state.metrics,errors:[...report.errors,...state.errors]});
 if(!report.pass||report.checks.length!==2||report.errors.length||report.metrics.streamsExact!==12)throw Error('R52 actual browser Worker crash test failed: '+JSON.stringify(report));
 console.log('R52_ACTUAL_CHROMIUM_WORKER_CRASH_RESTART_PASS',JSON.stringify(report.metrics));
}catch(e){report.pass=false;report.error=String(e.stack||e);console.error('R52_FAIL',report.error);}
finally{await writeFile(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');try{await page?.screenshot({path:join(out,'worker-crash.png'),fullPage:true})}catch{}try{await browser?.close()}catch{}if(server?.listening)await new Promise(r=>server.close(r));}
if(!report.pass)process.exitCode=1;