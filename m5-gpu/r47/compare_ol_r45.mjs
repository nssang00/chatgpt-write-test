/** Deterministic PNG RGBA8 oracle for two independent OL/R45 ABBA trials. */
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readPng,comparePixels} from '../../tests/round14_gpu_compare/png_compare.mjs';
const dir=resolve(process.argv[2]||'.');
const report={suite:'R47 CPU join vs stock OL strict pixel audit',scenes:{},exact:true};
for(const scene of ['sources-8','sources-16','sources-32']){
 const imgs={};
 for(const id of ['ol_a','ol_b','r45_a','r45_b'])imgs[id]=await readPng(join(dir,id,scene+'.png'));
 const pairs=[['ol_a','r45_a'],['ol_b','r45_b'],['ol_a','ol_b'],['r45_a','r45_b']];
 const out={};
 for(const [a,b] of pairs){
  const c=comparePixels(imgs[a],imgs[b]);
  out[a+'__'+b]={diffPixels:c.diffPixels,diffPercent:c.diffPercent,maxChannelDifference:c.maxChannelDifference,exactRGBA8:c.exactRGBA8};
 }
 report.scenes[scene]=out;
 report.exact &&=out.ol_a__r45_a.exactRGBA8 && out.ol_b__r45_b.exactRGBA8;
 console.log('R47_PIXEL_AUDIT',scene,JSON.stringify(out));
}
await writeFile(join(dir,'r47-cpu-join-pixel-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(report.exact?'R47_CPU_JOIN_STOCK_OL_EXACT_RGBA8_PASS':'R47_CPU_JOIN_STOCK_OL_EXACT_RGBA8_FAIL');
