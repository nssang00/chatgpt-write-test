/** One campaign of stock OL10.10.0 Worker or Round14 Direct WebGL1, no npm/Playwright. */
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const flags=Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--')&&x.includes('=')).map(x=>x.slice(2).split(/=(.*)/s).slice(0,2)));
const mode=flags.mode,runid=flags.id,rounds=Number(flags.rounds||5);
const clipMode=flags.clipMode||'legacy-unclipped';
if(!['legacy-unclipped','bounded'].includes(clipMode))throw Error('Invalid --clipMode');
const expectedConfig={clipMode,fringe:Number(flags.fringe||0),closedJoins:flags.closedJoins==='1'};
if(!['ol','m5'].includes(mode)||!/^([a-z0-9_-]{1,40})$/i.test(runid||'')||!Number.isInteger(rounds)||rounds<1||rounds>20)throw Error('Usage: --mode=ol|m5 --id=ol_1 --rounds=5');
const out=resolve(flags.out||join(root,'RESULTS','ROUND14_OL_GPU_TMP'),runid);
const progress=[];
let report=null,done;
const completed=new Promise(r=>done=r);
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.pbf':'application/octet-stream','.css':'text/css; charset=utf-8'};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(req.method==='POST'&&['/__m5_round6_progress','/__m5_round6_report'].includes(path)){
   let length=0;const chunks=[];
   for await(const chunk of req){length+=chunk.length;if(length>20*1024*1024)throw Error('POST too large');chunks.push(chunk)}
   const msg=JSON.parse(Buffer.concat(chunks).toString());
   if(path.endsWith('progress')){
    progress.push({time:new Date().toISOString(),stage:String(msg.stage||''),scene:String(msg.scene||''),iteration:msg.iteration,info:String(msg.info||'').slice(0,800)});
    if(progress.length>2000)progress.shift();
    console.log(`[${runid}] ${msg.stage} ${msg.scene||''} ${msg.iteration??''} ${String(msg.info||'').slice(0,80)}`);
   } else {
    if(!msg?.result||typeof msg.result.pass!=='boolean'||!Array.isArray(msg.result.scenes))throw Error('Invalid benchmark report');
    report=msg;done();
   }
   res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;
  }
  if(req.method!=='GET')throw Error('Only GET supported');
  const target=resolve(root,'.'+decodeURIComponent(path));
  if(!target.startsWith(root+sep)||!existsSync(target))throw Error('Forbidden/not found');
  const data=await readFile(target);
  res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);
 }catch(e){res.writeHead(404);res.end(String(e));}
});
const win=process.platform==='win32';
const candidates=win?[process.env.M5_BROWSER,process.env.CHROME_EXE,
 join(process.env.LOCALAPPDATA||'C:/Users/Default/AppData/Local','Google/Chrome/Application/chrome.exe'),
 join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),
 join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),
 join(process.env.PROGRAMFILES||'C:/Program Files','Microsoft/Edge/Application/msedge.exe'),
 join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe')]:[process.env.M5_BROWSER,process.env.CHROME_EXE,'/usr/bin/chromium','/usr/bin/google-chrome'];
const browser=candidates.find(x=>x&&existsSync(x));
let chrome,profile,stderr='',stdout='',exitCode=null;
const timeout=Number(process.env.M5_GPU_COMPARE_TIMEOUT_MS)||240000;
const terminate=()=>{if(!chrome||chrome.exitCode!==null)return;
 if(win)spawnSync('taskkill',['/PID',String(chrome.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
 else try{process.kill(-chrome.pid,'SIGKILL')}catch{try{chrome.kill('SIGKILL')}catch{}}};
const delay=ms=>new Promise(r=>{const timer=setTimeout(r,ms);timer.unref?.();});
let result={pass:false,error:'Benchmark did not run',scenes:[]};
await mkdir(out,{recursive:true});
try{
 if(!browser)throw Error('Chrome/Edge missing; set M5_BROWSER to the full browser executable path');
 await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
 profile=await mkdtemp(join(tmpdir(),'round14-ol-gpu-'));
 const url=`http://127.0.0.1:${server.address().port}/tests/round14_gpu_compare/${mode==='ol'?'ol_stock':'round14_m5'}.html?rounds=${rounds}&captureMode=canvas&drawMode=style-pass&polygonStrokeFringePx=${flags.fringe||0}&closedLineJoins=${flags.closedJoins||0}&clipMode=${clipMode}&tileUploadBatch=${flags.tileUploadBatch||0}&partialEarcut=${flags.partialEarcut||0}`;
 const args=[`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--enable-webgl',...(process.env.M5_SWIFTSHADER==='1'?['--enable-unsafe-swiftshader','--use-angle=swiftshader']:['--disable-software-rasterizer']),
 '--disable-background-networking','--disable-extensions','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--window-size=1120,720'];
 if(!process.argv.includes('--visible'))args.push('--headless=new');
 if(!win)args.push('--no-sandbox','--disable-dev-shm-usage');
 args.push(url);
 console.log(`[${runid}] Browser=${browser} url=${url}`);
 chrome=spawn(browser,args,{stdio:['ignore','pipe','pipe'],windowsHide:!process.argv.includes('--visible'),detached:!win});
 chrome.stdout.on('data',b=>stdout=(stdout+b.toString()).slice(-120000));
 chrome.stderr.on('data',b=>stderr=(stderr+b.toString()).slice(-200000));
 const exited=new Promise(r=>{chrome.once('exit',(code,signal)=>{exitCode=code;r({state:'exit',code,signal})});chrome.once('error',e=>r({state:'error',error:String(e)}))});
 const outcome=await Promise.race([completed.then(()=>({state:'report'})),exited,delay(timeout).then(()=>({state:'timeout'}))]);
 if(!report)throw Error(`No valid GPU report (${JSON.stringify(outcome)}); lastProgress=${JSON.stringify(progress.at(-1)||null)}; browserTail=${stderr.slice(-700)}`);
 const actualConfig=report.result.validationConfig;
 if(mode==='m5' && (!actualConfig || Object.keys(actualConfig).length!==3 ||
    actualConfig.clipMode!==expectedConfig.clipMode || actualConfig.fringe!==expectedConfig.fringe ||
    actualConfig.closedJoins!==expectedConfig.closedJoins))
   throw Error('Browser validation configuration mismatch: '+JSON.stringify({expectedConfig,received:actualConfig}));
 result={...report.result,mode,runid,reportReceived:true,browserExe:browser,completedAt:new Date().toISOString(),requestedConfig:mode==='m5'?expectedConfig:null};
 if(!result.pass||result.scenes.length!==3)throw Error('Rendered scene suite failed: '+(result.error||JSON.stringify(result.scenes.map(s=>({name:s.name,pass:s.pass,error:s.error})))));
 for(const image of report.images||[]){if(!/^(building-1l|road-1l|mixed-4l)\.png$/.test(image.filename)||!image.pngBase64)continue;
  await writeFile(join(out,image.filename),Buffer.from(image.pngBase64,'base64'));}
 for(const scene of ['building-1l','road-1l','mixed-4l']){
  if(!result.scenes.some(s=>s.name===scene&&s.pass&&s.medians?.coldToCapturedFrameMs>0&&s.samples?.length===rounds))throw Error('Invalid/missing shared performance samples: '+scene);
  if(!existsSync(join(out,scene+'.png')))throw Error('Missing screenshot '+scene);
 }
 if(mode==='ol'&&result.workerInstancesObserved<1)throw Error('OpenLayers Worker not observed');
}catch(error){result={...result,pass:false,error:String(error),mode,runid,lastProgress:progress.at(-1)||null,stderrTail:stderr.slice(-4000)};console.error(`[${runid}] ${result.error}`)}
finally{
 await writeFile(join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
 await writeFile(join(out,'progress.json'),JSON.stringify(progress,null,2)+'\n');
 await writeFile(join(out,'browser.log'),`Browser=${browser||'not found'}\nExit code=${exitCode}\nSTDERR\n${stderr}\nSTDOUT\n${stdout}\n`);
 terminate();if(server.listening){server.closeAllConnections();await Promise.race([new Promise(r=>server.close(r)),delay(2000)])}
 if(profile)await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
console.log(`[${runid}] RESULT pass=${result.pass}`);
if(!result.pass)process.exitCode=1;