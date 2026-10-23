/** Real 8/16/32 source stock OL 10.10.0, same MVT SHA/style/positions as R45. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]||'.');
const path=join(root,'tests/round14_gpu_compare/ol_stock.html');
let s=await readFile(path,'utf8');
const replace=(a,b)=>{const n=s.split(a).length-1;if(n!==1)throw Error('R46 OL patch anchor '+n+': '+a.slice(0,100));s=s.replace(a,b);};
const i=s.indexOf('const SCENES={');
const j=s.indexOf('\nconst count=',i);
if(i<0||j<0)throw Error('OL SCENES fixture anchors missing');
s=s.slice(0,i)+"let SCENES={},tileNames=[];"+s.slice(j);
replace("input:'Seoul z12 4 source PBFs in synthetic local 2x2 projection'",
 "input:'32 independent MapLibre OpenMapTiles XYZ12 sources x2174-2181 y1434-1437 (no duplicates)'");
replace("const proj=new Projection({code:'M5:LOCAL',units:'m',extent:[0,0,8192,8192]});",
 "const proj=new Projection({code:'M5:LOCAL',units:'m',extent:[0,0,32768,16384]});");
replace("const grid=new TileGrid({extent:[0,0,8192,8192],origin:[0,8192],resolutions:[16],tileSize:256});",
 "const grid=new TileGrid({extent:[0,0,32768,16384],origin:[0,16384],resolutions:[64],tileSize:64});");
replace("if(!reps.every(x=>x.ready>=4&&x.total>=4))return;",
 "if(!reps.every(x=>x.ready>=1&&x.total>=1))return;");
replace("tileUrlFunction:([,x,y])=>x>=0&&x<=1&&y>=0&&y<=1?",
 "tileUrlFunction:([,x,y])=>x===part.slotX&&y===part.slotY?");
replace("3492+x","part.x");
replace("1586+y","part.y");
replace("center:[4096,4096],resolution:16,constrainResolution:true",
 "center:[16384,8192],resolution:64,constrainResolution:true");
s=s.replaceAll("parts.length*4","parts.length");
replace("const prefetch=performance.now();for(const [x,y] of tileNames){",
 [
 "const manifestRsp=await fetch('/tests/fixtures/r46-data/manifest.json',{cache:'no-store'});",
 "if(!manifestRsp.ok)throw Error('R46 manifest unavailable for OL baseline');",
 "const manifest=await manifestRsp.json();",
 "if(manifest.sources?.length!==32||new Set(manifest.sources.map(s=>s.sha256)).size!==32||new Set(manifest.sources.map(s=>s.url)).size!==32)",
 " throw Error('R46 stock OL source identity invalid');",
 "tileNames=manifest.sources.map(s=>[s.x,s.y]);",
 "const styleFor=s=>s.layer==='transportation'?{'stroke-color':'rgba(220,65,55,0.92)','stroke-width':3}:",
 "  {'fill-color':'rgba(210,194,169,0.52)','stroke-color':'#766655','stroke-width':1};",
 "const partFor=(s,i)=>({layer:s.layer,style:styleFor(s),x:s.x,y:s.y,slotX:i%8,slotY:Math.floor(i/8)});",
 "SCENES={'sources-8':manifest.sources.slice(0,8).map(partFor),",
 " 'sources-16':manifest.sources.slice(0,16).map(partFor),",
 " 'sources-32':manifest.sources.slice(0,32).map(partFor)};",
 "const prefetch=performance.now();for(const [x,y] of tileNames){"
 ].join('\n  '));
replace("tests/fixtures/seoul/12/","tests/fixtures/r46-data/tiles/12/");
await writeFile(path,s);
console.log('R46_STOCK_OL_DISTINCT_PATCHED sources=8,16,32 tileGrid=8x4');
