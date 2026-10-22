import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const file=join(resolve(process.argv[2]||'.'),'r36_scale.mjs');
let src=await readFile(file,'utf8');
const updates=[
 ['const counts=[1,2,4,8,16],','const counts=[32],'],
 ["[1,2,4,8,16].includes(R36_LAYERS)","[1,2,4,8,16,32].includes(R36_LAYERS)"],
 ["[1,2,4,8,16].includes(r36LayerCount)","[1,2,4,8,16,32].includes(r36LayerCount)"],
 ["(1|2|4|8|16)l","(1|2|4|8|16|32)l"],
 ["R36_ORDER.map(i=>({layer:R36_BASE[i].layer,style:{...R36_BASE[i].style}}))",
  "R36_ORDER.map((i,k)=>({layer:R36_BASE[i].layer,style:{...R36_BASE[i].style,...('stroke-width' in R36_BASE[i].style?{'stroke-width':R36_BASE[i].style['stroke-width']+(k%3)*0.25}:{})}}))"]
];
for(const [a,b] of updates){if(!src.includes(a))throw Error('R40 anchor missing '+a);src=src.replaceAll(a,b)}
await writeFile(file,src);
console.log('R40_PATCHED 32 layer variant with differentiated source styles');