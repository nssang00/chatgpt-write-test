/** R73 physical RTX exclusive-host integration gate, executed against the pinned source demo.
 * 12 RGBA8 screenshot audits (8/16/32 x DPR1/2 x 2 fresh contexts).
 * Nine real OL fallback + input + stock screenshot-pixel-parity cases.
 * Uses the product's examples/compare page, not the legacy standalone GPU harness.
 */
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=resolve(process.argv[2]||'candidate');
const out=resolve(process.argv[3]||join(root,'artifacts/r73-exclusive-integration'));
const expected='03ac83377b3362f207289b58692bc3617a910fca';
const summary={schema:'r73-exclusive-integration-physical-rtx-v1',candidate:expected,
  olVersion:'10.10.0',matrix:'8/16/32 x DPR1/2 x two fresh pages',
  rawRgba8Passed:0,fallbackPassed:0,raw:[],fallback:[],errors:[],pass:false,
  parityThresholds:{differentPixelFractionMax:0.03,meanAbsoluteChannelErrorMax:2.0}};
await mkdir(out,{recursive:true});
let browser,server;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(ok,message)=>{if(!ok)throw Error(message)};
async function audit(page,one,two=null){
  const a=one.toString('base64'),b=two?.toString('base64')||null;
  return await page.evaluate(async ([a,b])=>{
    async function pixels(base64){
      const im=new Image();im.src='data:image/png;base64,'+base64;await im.decode();
      const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;
      const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(im,0,0);
      return {width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data};
    }
    const x=await pixels(a),y=b?await pixels(b):null;
    let nonBackground=0,hash=2166136261,changedPixels=0,totalAbs=0;
    const unique=new Set();
    for(let i=0;i<x.data.length;i+=4){
      const r=x.data[i],g=x.data[i+1],bl=x.data[i+2],al=x.data[i+3];
      if(Math.abs(r-11)>8||Math.abs(g-18)>8||Math.abs(bl-32)>8)nonBackground++;
      if(i%256===0)unique.add(r+','+g+','+bl+','+al);
      for(let c=0;c<4;c++)hash=Math.imul(hash^x.data[i+c],16777619)>>>0;
      if(y){
        let changed=false;
        for(let c=0;c<4;c++){const d=Math.abs(x.data[i+c]-y.data[i+c]);totalAbs+=d;if(d>4)changed=true;}
        if(changed)changedPixels++;
      }
    }
    const n=x.width*x.height;
    return {width:x.width,height:x.height,format:'RGBA8',nonBackground,uniqueSampledColors:unique.size,
      fnv1a32:hash.toString(16).padStart(8,'0'),
      ...(y?{referenceWidth:y.width,referenceHeight:y.height,changedPixels,
        differentPixelFraction:changedPixels/n,meanAbsoluteChannelError:totalAbs/(4*n)}:{})};
  },[a,b]);
}
async function capture(page,selector,path){
  return page.locator(selector).screenshot({path,animations:'disabled'});
}
function parityGood(p){
  return p.width===p.referenceWidth&&p.height===p.referenceHeight&&
    p.differentPixelFraction<=0.03&&p.meanAbsoluteChannelError<=2.0&&p.nonBackground>500;
}
async function input(page){
  const box=await page.locator('#boost-map').boundingBox();
  assert(box,'fallback OL map bounding box absent');
  const x=box.x+256,y=box.y+256;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x-65,y+27,{steps:9});await page.mouse.up();
  await sleep(650);
  await page.mouse.move(x,y);await page.mouse.wheel(0,-230);
  await sleep(1000);
}
try{
  const sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  assert(sha===expected,'candidate SHA drift '+sha);
  const original=await readFile(join(root,'examples/compare/index.html'),'utf8');
  const needle='const selected=manifest.sources.slice(0,8);';
  const hostNeedle='exclusive=new OlExclusiveVectorTileRenderHost({map:boostMap,layers:optimized.layers,onError:fail}).start();';
  assert(original.includes(needle)&&original.includes(hostNeedle)&&original.includes('exclusive?.stop();'),
    'source demo exclusive-host/fallback integration contract changed');
  const modified=original.replace(needle,
    "const selected=manifest.sources.slice(0,Number(new URLSearchParams(location.search).get('count')||8));")
    .replace(hostNeedle,hostNeedle+'\n  globalThis.__r73ExclusiveSnapshot=()=>exclusive.snapshot();'+
      '\n  globalThis.__r73ViewSnapshot=()=>({center:boostMap.getView().getCenter().slice(),resolution:boostMap.getView().getResolution(),rotation:boostMap.getView().getRotation()});'+
      '\n  globalThis.__r73GlError=()=>backend.gl.getError();');
  await mkdir(join(root,'examples/r73-exclusive-test'),{recursive:true});
  await writeFile(join(root,'examples/r73-exclusive-test/index.html'),modified);
  const playwright=await import(pathToFileURL(join(root,'node_modules/playwright/index.mjs')).href);
  const {chromium}=playwright;
  const port=4197,base='http://127.0.0.1:'+port;
  server=spawn(process.execPath,[join(root,'examples/compare/serve.mjs')],{
    cwd:root,env:{...process.env,OLVT_EXAMPLE_PORT:String(port)},stdio:'pipe'});
  let output='';
  server.stdout.on('data',b=>output+=b.toString());
  server.stderr.on('data',b=>output+=b.toString());
  let ready=false;
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw Error('server exited '+output);
    try{if((await fetch(base+'/examples/compare/')).ok){ready=true;break}}catch{}
    await sleep(150);
  }
  assert(ready,'local static server unavailable '+output);
  browser=await chromium.launch({executablePath:process.env.M5_BROWSER||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
    args:['--enable-webgl','--disable-software-rasterizer','--disable-background-networking','--window-size=1280,760']});
  let index=0;
  for(const count of [8,16,32])for(const dpr of [1,2])for(const seed of [1,2]){
    index++;
    const id='s'+count+'-dpr'+dpr+'-seed'+seed;
    const page=await browser.newPage({viewport:{width:1280,height:760},deviceScaleFactor:dpr});
    const browserErrors=[];
    page.on('pageerror',e=>browserErrors.push('pageerror '+String(e)));
    page.on('console',m=>{if(m.type()==='error')browserErrors.push('console '+m.text())});
    await page.route('**/favicon.ico',route=>route.fulfill({status:204,body:''}));
    try{
      await page.goto(base+'/examples/r73-exclusive-test/index.html?count='+count,
        {waitUntil:'domcontentloaded',timeout:40000});
      await page.waitForFunction(n=>{
        const r=globalThis.__olvtExample;
        return r?.ready&&r?.sourceCount===n&&r?.sourceLoads>=2*n&&
          r?.stockFrames>0&&r?.boostFrames>0||r?.errors?.length>0;
      },count,{timeout:45000});
      await sleep(550);
      const before=await page.evaluate(()=>{
        const r=globalThis.__olvtExample,e=globalThis.__r73ExclusiveSnapshot?.();
        const gl=document.createElement('canvas').getContext('webgl');
        const ext=gl?.getExtension('WEBGL_debug_renderer_info');
        return {report:{...r},exclusive:e,
          gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,
          stockCanvases:document.querySelectorAll('#stock-map canvas').length,
          boostStockCanvases:document.querySelectorAll('#boost-map canvas').length,
          glError:globalThis.__r73GlError?.()};
      });
      assert(/NVIDIA.*RTX 5060 Ti/i.test(before.gpu||''),id+' nonphysical GPU '+before.gpu);
      assert(before.glError===0,id+' GL error '+before.glError);
      assert(before.report.workerDefaultOff===true&&before.report.errors.length===0,
        id+' Worker ON or source errors '+JSON.stringify(before.report));
      assert(before.report.sourceLoads>=count*2&&before.stockCanvases>0,
        id+' distinct stock/exclusive sources not ready');
      assert(before.exclusive?.active===true&&before.exclusive?.tileRequests>0&&
        before.exclusive?.suppressedDraws>0&&before.boostStockCanvases===0,
        id+' OL GPU draw not exclusively suppressed '+JSON.stringify(before));
      const raw=await capture(page,'#boost-viewport',join(out,id+'-exclusive.png'));
      const pixels=await audit(page,raw);
      assert(pixels.format==='RGBA8'&&pixels.nonBackground>500&&pixels.uniqueSampledColors>=3,
        id+' blank exclusive RGBA8 '+JSON.stringify(pixels));
      summary.raw.push({id,count,dpr,seed,sourceLoads:before.report.sourceLoads,
        gpu:before.gpu,exclusive:before.exclusive,pixels,errors:browserErrors});
      assert(browserErrors.length===0,id+' browser errors '+JSON.stringify(browserErrors));
      summary.rawRgba8Passed++;
      console.log('R73_EXCLUSIVE_RGBA8_PASS',id,JSON.stringify(pixels));
      if(index<=9){
        await page.evaluate(()=>globalThis.__olvtFallback());
        await page.waitForFunction(()=>globalThis.__olvtExample?.fallback===true&&
          document.querySelectorAll('#boost-map canvas').length>0,null,{timeout:20000});
        await sleep(650);
        const restored=await page.evaluate(()=>globalThis.__r73ExclusiveSnapshot?.());
        assert(restored?.active===false&&restored?.restored===true,
          id+' exclusive host not restored '+JSON.stringify(restored));
        const viewBefore=await page.evaluate(()=>globalThis.__r73ViewSnapshot());
        await input(page);
        const viewAfter=await page.evaluate(()=>globalThis.__r73ViewSnapshot());
        assert(Math.hypot(viewAfter.center[0]-viewBefore.center[0],viewAfter.center[1]-viewBefore.center[1])>10&&
          Math.abs(viewAfter.resolution-viewBefore.resolution)>0.01,
          id+' fallback pointer/wheel failed to move stock OL view '+JSON.stringify({viewBefore,viewAfter}));
        const stock=await capture(page,'#stock-map',join(out,id+'-stock-after-input.png'));
        const fallback=await capture(page,'#boost-map',join(out,id+'-fallback-after-input.png'));
        const parity=await audit(page,stock,fallback);
        const after=await page.evaluate(()=>({...globalThis.__olvtExample}));
        assert(after.errors.length===0&&browserErrors.length===0,
          id+' fallback browser errors '+JSON.stringify({after,browserErrors}));
        assert(parityGood(parity),id+' stock OL screenshot pixel parity failure '+JSON.stringify(parity));
        summary.fallback.push({id,count,dpr,seed,restored,parity,
          frames:{stock:after.stockFrames,boost:after.boostFrames},errors:browserErrors});
        summary.fallbackPassed++;
        console.log('R73_EXCLUSIVE_OL_FALLBACK_PARITY_PASS',id,JSON.stringify(parity));
      }
    }catch(e){
      const report=await page.evaluate(()=>globalThis.__olvtExample||null).catch(()=>null);
      throw Error(id+': '+String(e?.stack||e)+' report='+JSON.stringify(report));
    }finally{
      await page.close();
      await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
    }
  }
  summary.pass=summary.rawRgba8Passed===12&&summary.fallbackPassed===9&&summary.errors.length===0;
}catch(e){summary.errors.push(String(e?.stack||e));console.error('R73_EXCLUSIVE_INTEGRATION_FAIL',summary.errors.at(-1));}
finally{
  await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  try{await browser?.close()}catch{}
  if(server?.exitCode===null){server.kill();await sleep(500)}
}
console.log(summary.pass?'R73_EXCLUSIVE_INTEGRATION_12_9_PASS':'R73_EXCLUSIVE_INTEGRATION_FAIL',
  JSON.stringify({candidate:summary.candidate,rawRgba8Passed:summary.rawRgba8Passed,
    fallbackPassed:summary.fallbackPassed,errors:summary.errors}));
if(!summary.pass)process.exitCode=1;
