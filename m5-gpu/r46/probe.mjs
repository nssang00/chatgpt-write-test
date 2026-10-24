import {createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import MVT from '../../vendor/openlayers-10.10.0-runtime/node_modules/ol/format/MVT.js';
const output=resolve(process.argv[2]||'R46-PROBE');
await mkdir(output,{recursive:true});
const api=['https://demotiles.maplibre.org/tiles-omt/tiles.json','https://demotiles.maplibre.org/tiles/tiles.json'];
const meta=[];
for(const url of api){
 try{const rsp=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'M5-R46-GitHub-CI/1.0 (public MapLibre test fixture)'}});
 const raw=await rsp.text(); const d=JSON.parse(raw);meta.push({url,status:rsp.status,tiles:d.tiles,zoom:[d.minzoom,d.maxzoom],vectorLayers:d.vector_layers?.map(x=>x.id),textLength:raw.length});}
 catch(e){meta.push({url,error:String(e)});}
}
const tests=[];
const candidates=[
 ...[[2176,1435],[2177,1435],[2176,1436],[2177,1436]].map(([x,y])=>({kind:'omt',z:12,x,y,url:'https://demotiles.maplibre.org/tiles-omt/12/'+x+'/'+y+'.pbf'})),
 ...[[32,21],[33,21],[34,21],[35,21]].map(([x,y])=>({kind:'world',z:6,x,y,url:'https://demotiles.maplibre.org/tiles/6/'+x+'/'+y+'.pbf'}))
];
for(const c of candidates){
 try{
 const r=await fetch(c.url,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'M5-R46-GitHub-CI/1.0 (public MapLibre test fixture)'}});
 const bytes=Buffer.from(await r.arrayBuffer());
 const out={...c,status:r.status,mime:r.headers.get('content-type'),byteLength:bytes.length,
  sha256:createHash('sha256').update(bytes).digest('hex')};
 if(r.ok&&bytes.length>20){
  try{const fs=new MVT().readFeatures(bytes,{extent:[0,0,4096,4096]});const counts={};
   for(const f of fs){const name=f.get('layer')||'unknown';counts[name]=(counts[name]||0)+1;}
   out.featureCount=fs.length;out.layerCounts=counts;out.first16=bytes.subarray(0,16).toString('hex');
  }catch(err){out.decodeError=String(err);}
 }
 tests.push(out);console.log('R46-PROBE',JSON.stringify(out));
 }catch(e){tests.push({...c,error:String(e)});console.log('R46-PROBE-ERROR',String(e));}
}
const evidence={source:'Public MapLibre demo vector tiles, intended for reproducible testing',timestamp:new Date().toISOString(),tilejson:meta,tiles:tests};
await writeFile(join(output,'probe.json'),JSON.stringify(evidence,null,2));
console.log('R46-PROBE-COMPLETE');
