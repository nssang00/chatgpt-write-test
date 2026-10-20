import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const path=join(process.argv[2]||process.cwd(),'tests/round14_gpu_compare/run_one.mjs');
let s=await readFile(path,'utf8');
const from='&captureMode=canvas&drawMode=style-pass';
if(s.split(from).length!==2)throw Error('Expected fixed M5 style-pass driver anchor');
s=s.replace(from,'&captureMode=canvas&drawMode=painter');
await writeFile(path,s);
console.log('ROUND17_PAINTER_DRAW_ORDER_VARIANT_READY');