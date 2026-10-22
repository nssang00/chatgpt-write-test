import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]||'.');
const edits=[
 ['tests/round11/shared_mvt_decode.mjs',[
 ['extent,shared=true})','extent,shared=true,noCopy=false})'],
 ['format.readFeatures(pbf.slice(0),{extent:extent(x,y)})','format.readFeatures(noCopy?pbf:pbf.slice(0),{extent:extent(x,y)})']
 ]],
 ['tests/round14_gpu_compare/round14_m5.html',[
 ['shared:round11Shared}));',"shared:round11Shared,noCopy:workerPoolMode==='deferred'}));"]
 ]]
];
for(const [path,changes] of edits){
 const file=join(root,path);let s=await readFile(file,'utf8');
 for(const [a,b] of changes){if(!s.includes(a))throw Error('R41 anchor absent '+path+': '+a);s=s.replaceAll(a,b)}
 await writeFile(file,s);console.log('R41_PATCHED '+path);
}