import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]||'.'),file=join(root,'r39_verify.mjs');
let s=await readFile(file,'utf8');
const before="s.deferredWorkerRepaintChangedBytes===0&&s.deferredWorkerRepaintMs>0&&s.deferredWorkerRepaintDrawCalls>0&&s.deferredWorkerReadyAfterPaintMs>0",after="s.deferredWorkerRepaintChangedBytes===0&&s.deferredWorkerRepaintMs>0&&s.deferredWorkerRepaintDrawCalls>0&&s.deferredWorkerReadyAfterPaintMs>0&&Array.isArray(s.deferredDynamicParity)&&s.deferredDynamicParity.length===4&&s.deferredDynamicParity.every(v=>v.changedBytes===0&&v.drawCalls>0)";
if(!s.includes(before))throw Error('R43 dynamic gate anchor missing');
s=s.replace(before,after);await writeFile(file,s);console.log('R43_VERIFIER 120 dynamic image checks per two-campaign 3-scene 5-round suite');