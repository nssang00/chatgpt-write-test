import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]||'.');
async function patch(path,replacements){
 const file=join(root,path);let s=await readFile(file,'utf8');
 for(const [needle,change] of replacements){
  if(!s.includes(needle))throw Error('Missing anchor '+path+': '+needle.slice(0,65));
  s=s.replace(needle,change);
 }
 await writeFile(file,s);console.log('R37_PATCHED '+path);
}
await patch('our-renderer/integration/workers/DirectTileEncodeTask.js',[
 ["  if(new Set(layers.map(x=>x.layer)).size!==layers.length)\n    throw Error('R34 group requires unique source layers; use independent tasks for duplicates');", "  const uniqueNames=[...new Set(layers.map(x=>x.layer))];\n  if(uniqueNames.length!==layers.length && task.allowDuplicateLayers!==true)\n    throw Error('R34 group requires unique source layers; use independent tasks for duplicates');"],
 ["const features=formatForLayers(layers.map(x=>x.layer)).readFeatures(bytes,{extent});","const features=formatForLayers(uniqueNames).readFeatures(bytes,{extent});"],
 ["const wanted=new Map(layers.map(({layer},index)=>[layer,index]));\n  const buckets=layers.map(()=>[]);","const wanted=new Map(uniqueNames.map((layer,index)=>[layer,index]));\n  const buckets=uniqueNames.map(()=>[]);"],
 ["encodeFeatures(buckets[i],layers[i].style,extent,options)","encodeFeatures(buckets[wanted.get(layers[i].layer)],layers[i].style,extent,options)"],
]);
await patch('tests/round14_gpu_compare/round14_m5.html',[
 ["if(workerSharedDecode && new Set(spec.map(p=>p.layer)).size===spec.length){","if(workerSharedDecode && (new Set(spec.map(p=>p.layer)).size===spec.length || validationQuery.get('r37DuplicateDecode')==='1')){"],
 ["const tasks=keys.map(([x,y])=>({tileKey:`12/${x}/${y}`,","const tasks=keys.map(([x,y])=>({allowDuplicateLayers:validationQuery.get('r37DuplicateDecode')==='1',tileKey:`12/${x}/${y}`,"],
]);
await patch('tests/round14_gpu_compare/run_one.mjs',[
 ["&workerSharedDecode=${flags.workerSharedDecode||0}&scissorFill=","&workerSharedDecode=${flags.workerSharedDecode||0}&r37DuplicateDecode=${flags.r37DuplicateDecode||1}&scissorFill="],
]);