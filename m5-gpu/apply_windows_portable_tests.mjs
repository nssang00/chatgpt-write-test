import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
const fixes={
 'tests/round8/verify_pixel_comparator.mjs':[
  ["resolve(new URL('compare_three_images.mjs',import.meta.url).pathname)","fileURLToPath(new URL('compare_three_images.mjs',import.meta.url))"]],
 'tests/verify_polygon_ol_cpu_pipeline.mjs':[
  ['resolve(new URL(`./fixtures/seoul/12/${tile}.pbf`,import.meta.url).pathname)','fileURLToPath(new URL(`./fixtures/seoul/12/${tile}.pbf`,import.meta.url))']],
 'tests/verify_disable_worker_feature_buffers.mjs':[
  ['fixture.pathname','fileURLToPath(fixture)']],
 'tests/bench_disable_worker_feature_buffers.mjs':[
  ['fixture.pathname','fileURLToPath(fixture)']],
 'tests/bench_polygon_ol_cpu_pipeline.mjs':[
  ['resolve(new URL(`./fixtures/seoul/12/${tile}.pbf`,import.meta.url).pathname)','fileURLToPath(new URL(`./fixtures/seoul/12/${tile}.pbf`,import.meta.url))']],
 'tests/verify_round14_cpu_gate.mjs':[
  ["cwd:new URL('../',import.meta.url).pathname","cwd:fileURLToPath(new URL('../',import.meta.url))"]]
};
for(const [path,entries] of Object.entries(fixes)){
 const file=join(root,path);let s=await readFile(file,'utf8');
 for(const [oldText,newText] of entries){if(!s.includes(oldText))throw Error(path+' missing original URL path');s=s.replaceAll(oldText,newText);}
 s="import {fileURLToPath} from 'node:url';\n"+s;
 await writeFile(file,s);console.log('WIN32_PORTABLE_FILEURL',path);
}