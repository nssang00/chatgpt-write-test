import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const file=join(resolve(process.argv[2]||'.'),'tests/round14_gpu_compare/round14_m5.html');
let s=await readFile(file,'utf8');
const before="         r43CpuPixels.push(pixels);",after="         let r44Painted=0,r44Changed=0;\n         for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==0)r44Painted++;\n         for(let i=0;i<pixels.length;i++)if(pixels[i]!==canvasPixels[i])r44Changed++;\n         if(r44Painted<=0)throw Error('R44 dynamic CPU control is transparent '+view.name);\n         if(r44Changed<=0)throw Error('R44 view transform did not change GPU pixels '+view.name);\n         r43CpuPixels.push(pixels);";
if(!s.includes(before))throw Error('R44 dynamic CPU control anchor missing');
s=s.replace(before,after);
await writeFile(file,s);console.log('R44_PATCHED require nonempty and visibly transformed GPU CPU control');