import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd(),alpha=process.argv[3];
if(!['1.0','0.5'].includes(alpha))throw Error('Expected alpha 1.0 or 0.5');
for(const page of ['ol_stock.html','round14_m5.html']){
 const path=join(root,'tests/round14_gpu_compare',page);
 let s=await readFile(path,'utf8');
 const needle="rgba(220,65,55,0.92)";
 if(s.split(needle).length!==3)throw Error('Expected exactly two road styles in '+page);
 s=s.replaceAll(needle,'rgba(220,65,55,'+alpha+')');
 await writeFile(path,s);
}
console.log('ROUND20_CAUSAL_ROAD_ALPHA_BOTH_OL_M5',alpha);