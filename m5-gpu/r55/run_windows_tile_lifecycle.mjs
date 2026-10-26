import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
import {build} from 'esbuild';
const out=resolve('R55-WINDOWS');await mkdir(out,{recursive:true});
const report={pass:false,events:[],errors:[],checks:[]};
const html=`<!doctype html><html><body style="margin:0"><div id="map" style="width:512px;height:512px"></div><script type="module">
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import VectorTileSource from 'ol/source/VectorTile.js';
import VectorTileLayer from 'ol/layer/VectorTile.js';
import TileGrid from 'ol/tilegrid/TileGrid.js';
import Projection from 'ol/proj/Projection.js';
const events=[];window.__probe={events,ready:false,errors:[]};
const proj=new Projection({code:'TEST:LOCAL',units:'m',extent:[0,0,256,256]});
const grid=new TileGrid({extent:[0,0,256,256],origin:[0,256],resolutions:[1],tileSize:256});
let generation=0;
const makeSource=()=>{
 const gen=generation;
 const src=new VectorTileSource({projection:proj,tileGrid:grid,wrapX:false,
  tileUrlFunction:()=>'/tile?generation='+gen,
  tileLoadFunction:(tile,url)=>{events.push({type:'loader',gen,url});
   tile.setLoader(()=>{events.push({type:'issued',gen,url});
    setTimeout(()=>{if(gen!==generation){events.push({type:'late',gen});return;}
      tile.setFeatures([]);events.push({type:'settled',gen});},gen===0?450:20);
   });
  }
 });
 src.on('tileloadstart',()=>events.push({type:'tileloadstart',gen}));
 src.on('tileloadend',()=>events.push({type:'tileloadend',gen}));
 src.on('tileloaderror',()=>events.push({type:'tileloaderror',gen}));
 return src;
};
const layer=new VectorTileLayer({source:makeSource()});
const map=new Map({target:'map',layers:[layer],view:new View({projection:proj,center:[128,128],resolution:1,constrainResolution:false}),controls:[]});
window.__probe.advance=()=>{generation++;events.push({type:'cancel',gen:generation});
 layer.setSource(makeSource());map.renderSync();};
map.renderSync();window.__probe.ready=true;
</script></body></html>`;
const moduleBody=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if(!moduleBody)throw Error('OL module missing');
await build({stdin:{contents:moduleBody,resolveDir:process.cwd(),sourcefile:'ol-lifecycle-entry.js',loader:'js'},bundle:true,format:'esm',platform:'browser',outfile:out+'/ol-app.js'});
const servedHtml=html.replace(/<script type="module">[\s\S]*?<\/script>/,'<script type="module" src="/ol-app.js"></script>');
let server,browser,page;
try{
 server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end(servedHtml);return;}
 if(pathname==='/ol-app.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(out+'/ol-app.js'));return;}
 if(pathname.startsWith('/tile')){res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end('');return;}
 const path=resolve('.'+decodeURIComponent(pathname));
 if(!path.startsWith(process.cwd()+sep))throw Error('invalid path');
 const data=await readFile(path);
 res.writeHead(200,{'Content-Type':extname(path)==='.js'?'text/javascript':'application/octet-stream'});res.end(data);
 }catch(e){res.writeHead(404);res.end(String(e))}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});
 page=await browser.newPage({viewport:{width:800,height:600}});
 page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>window.__probe?.ready,{timeout:15000});
 await page.waitForFunction(()=>window.__probe.events.some(e=>e.type==='issued'&&e.gen===0),{timeout:15000});
 await page.evaluate(()=>window.__probe.advance());
 await page.waitForTimeout(900);
 report.events=await page.evaluate(()=>window.__probe.events);
 for(const [name,ok] of Object.entries({
  'initial tile request':report.events.some(e=>e.type==='issued'&&e.gen===0),
  'source replacement generation-1 request':report.events.some(e=>e.type==='issued'&&e.gen===1),
  'old generation late callback':report.events.some(e=>e.type==='late'&&e.gen===0),
  'new generation completion':report.events.some(e=>e.type==='settled'&&e.gen===1)
 })){report.checks.push({name,pass:ok});}
 report.pass=report.checks.every(x=>x.pass)&&!report.errors.length;
 await page.screenshot({path:out+'/tile-lifecycle.png'});
}catch(e){report.errors.push(String(e.stack||e))}
finally{await writeFile(out+'/result.json',JSON.stringify(report,null,2));await browser?.close();if(server?.listening)await new Promise(ok=>server.close(ok));}
console.log(JSON.stringify({pass:report.pass,checks:report.checks,errors:report.errors,events:report.events.length}));
if(!report.pass)process.exitCode=1;
