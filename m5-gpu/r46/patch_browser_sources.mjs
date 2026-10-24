import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]||'.');
async function patch(file,changes){
 const path=join(root,file);let s=await readFile(path,'utf8');
 for(const [a,b] of changes){
  const n=s.split(a).length-1;
  if(n!==1)throw Error('R46 expected one anchor, found '+n+' in '+file+': '+a.slice(0,100));
  s=s.replace(a,b);
 }
 await writeFile(path,s);console.log('R46_DISTINCT_BROWSER_PATCHED',file);
}
await patch('tests/round14_gpu_compare/run_one.mjs',[
 ["args.push(url+'&r45='+String(flags.r45||0)+'&r45Dpr='+String(flags.r45Dpr||1));",
 "args.push(url+'&r45='+String(flags.r45||0)+'&r45Dpr='+String(flags.r45Dpr||1)+'&r46=1');"],
 ["^(building-1l|road-1l|mixed-4l)","^(sources-8|sources-16|sources-32)"],
 ["['building-1l','road-1l','mixed-4l']","['sources-8','sources-16','sources-32']"]
]);
const p='tests/round14_gpu_compare/round14_m5.html';
let s=await readFile(join(root,p),'utf8');
function one(a,b){const n=s.split(a).length-1;if(n!==1)throw Error('R46 M5 anchor '+n+': '+a.slice(0,110));s=s.replace(a,b)}
const start=s.indexOf('const SCENES={');
const end=s.indexOf('\nconst clampRounds=',start);
if(start<0||end<0)throw Error('Original M5 SCENES anchors missing');
s=s.slice(0,start)+"let SCENES={};"+s.slice(end);
one('const keys=[[3492,1586],[3493,1586],[3492,1587],[3493,1587]];','let keys=[];');
one('getTileRangeForExtentAndZ:()=>({minX:3492,maxX:3493,minY:1586,maxY:1587})',
 'getTileRangeForExtentAndZ:()=>({minX:2174,maxX:2181,minY:1434,maxY:1437})');
one('const extent=(x,y)=>[(x-3492)*TILE,(1587-y)*TILE,(x-3491)*TILE,(1588-y)*TILE];',
 'const extent=(x,y)=>[(x-2174)*TILE,(1437-y)*TILE,(x-2173)*TILE,(1438-y)*TILE];');
one('pixelRatio:r45Dpr,extent:[0,0,8192,8192],viewState:{center:[4096,4096],resolution:16',
 'pixelRatio:r45Dpr,extent:[0,0,32768,16384],viewState:{center:[16384,8192],resolution:64');
one('getResolution:()=>16','getResolution:()=>64');
one("suite:'Round7 Real Seoul MVT 4 tiles - style-pass batch smoke',input:'Seoul zoom12 x3492-3493 y1586-1587'",
 "suite:'R46 8/16/32 independent MapLibre OpenMapTiles source instances',input:'32 different PBF hashes; Innsbruck XYZ12 x2174-2181 y1434-1437'");
one("({perLayer,featureCount,decodeCalls,shared:sharedDecode}=decodeSceneFeatures({\n       MVT,keys,spec,bytesByTile,extent,shared:round11Shared}));",[
 "perLayer=[];featureCount=0;decodeCalls=0;sharedDecode=false;",
 "for(const part of spec){",
 " const {x,y}=part;const raw=bytesByTile.get(x+'/'+y);",
 " if(!raw)throw Error('R46 tile source missing '+x+'/'+y);",
 " const features=new MVT({layers:[part.layer]}).readFeatures(raw,{extent:extent(x,y)});",
 " if(!features.length)throw Error('R46 empty direct CPU source '+x+'/'+y+' '+part.layer);",
 " perLayer.push([{x,y,features}]);featureCount+=features.length;decodeCalls++;",
 "}"
].join('\n       '));
s=s.replaceAll("spec.length*4","spec.length");
one("const prefetch=ms();",[
 "const manifestRsp=await fetch('/tests/fixtures/r46-data/manifest.json',{cache:'no-store'});",
 "if(!manifestRsp.ok)throw Error('R46 manifest missing');",
 "const manifest=await manifestRsp.json();",
 "if(manifest.sources?.length!==32||new Set(manifest.sources.map(s=>s.sha256)).size!==32||new Set(manifest.sources.map(s=>s.url)).size!==32)",
 " throw Error('R46 not 32 independent real source hashes/URLs');",
 "keys=manifest.sources.map(s=>[s.x,s.y]);",
 "const styleFor=s=>s.layer==='transportation'?{'stroke-color':'rgba(220,65,55,0.92)','stroke-width':3}:",
 "  {'fill-color':'rgba(210,194,169,0.52)','stroke-color':'#766655','stroke-width':1};",
 "const partFor=s=>({layer:s.layer,style:styleFor(s),x:s.x,y:s.y,sourceSHA:s.sha256});",
 "SCENES={'sources-8':manifest.sources.slice(0,8).map(partFor),",
 " 'sources-16':manifest.sources.slice(0,16).map(partFor),",
 " 'sources-32':manifest.sources.slice(0,32).map(partFor)};",
 "const prefetch=ms();"
].join('\n '));
one("tests/fixtures/seoul/12/","tests/fixtures/r46-data/tiles/12/");
one("return {name:sceneName,pass,layerCount:spec.length,sourceLayers:spec.map(s=>s.layer),tileCount:4,",
 "return {name:sceneName,pass,layerCount:spec.length,sourceLayers:spec.map(s=>s.layer),tileCount:spec.length,");
one("results.fixtureBytes=[...bytesByTile.values()].reduce((s,b)=>s+b.byteLength,0);",
 "results.fixtureBytes=[...bytesByTile.values()].reduce((s,b)=>s+b.byteLength,0);results.distinctPbfSHA256=32;");
await writeFile(join(root,p),s);
console.log('R46_DISTINCT_BROWSER_PATCHED',p);
