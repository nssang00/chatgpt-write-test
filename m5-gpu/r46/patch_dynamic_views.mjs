import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const file=join(resolve(process.argv[2]||'.'),'tests/round14_gpu_compare/round14_m5.html');
let s=await readFile(file,'utf8');
const changes=[
 ['center:[4512,3840],resolution:16','center:[16064,7936],resolution:64'],
 ['center:[4096,4096],resolution:12','center:[16384,8192],resolution:55'],
 ['center:[4096,4096],resolution:16','center:[16384,8192],resolution:64'],
 ['center:[4360,3890],resolution:14','center:[16020,8010],resolution:59']
];
for(const [oldVal,newVal] of changes){const n=s.split(oldVal).length-1;if(n!==1)throw Error('R46 dynamic view anchor '+n+': '+oldVal);s=s.replace(oldVal,newVal);}
await writeFile(file,s);
console.log('R46_DYNAMIC_VIEW_CASES 4 R46-wide pan/zoom/rotate transformed controls');
