import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]||'.');
for(const [path,updates] of [
 ['r38_run.mjs',[
 ["['deferred4','m5','deferred',4],",'' ],
 ["['deferred2_a','deferred2_b','deferred4']","['deferred2_a','deferred2_b']"]
 ]],
 ['r39_verify.mjs',[
 ["['deferred2_a','deferred4','deferred2_b']","['deferred2_a','deferred2_b']"]
 ]]){
 const file=join(root,path);let s=await readFile(file,'utf8');
 for(const [a,b] of updates){if(!s.includes(a))throw Error('Missing 2W acceptance anchor '+path);s=s.replace(a,b)}
 await writeFile(file,s);
}
console.log('R39_SELECTED two Workers only; 4-Worker road regression remains independently recorded');