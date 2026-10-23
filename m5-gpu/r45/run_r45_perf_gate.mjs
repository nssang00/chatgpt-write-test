/** Paired RTX-only OL 10.10.0 vs R45 CPU-first real-app first-frame gate.
 * Source ZIP and GPU identity are checked by workflow. Worker work after first
 * paint is measured separately and never folded into initial screenshot time.
 */
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]||'.');
const out=resolve(process.argv[3]||join(root,'RESULTS','R45_PERF'));
const rounds=Number(process.env.R45_PERF_ROUNDS||5);
if(!Number.isInteger(rounds)||rounds<3||rounds>15)throw Error('Require >=3 <=15 rounds per scene');
await mkdir(out,{recursive:true});
const runs=[['ol_a','ol'],['r45_a','m5'],['r45_b','m5'],['ol_b','ol']];
const results={pass:false,suite:'R45 paired RTX OL 10.10.0 vs opt-in first frame',rounds,
 comparisonMethod:'ABBA; paired OL median average baseline; 50% threshold applies to each R45 run, each scene',
 runs:{},scenes:[],errors:[]};
for(const [id,mode] of runs){
 const args=[join(root,'tests/round14_gpu_compare/run_one.mjs'),
   '--mode='+mode,'--id='+id,'--rounds='+rounds,'--out='+out,
   '--workerPool=off','--partialEarcut=1','--closedJoins=1','--r45='+(mode==='m5'?'1':'0'),'--r45Dpr=1'];
 const p=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:12*60*1000,maxBuffer:32*1024*1024});
 const log=[p.stdout||'',p.stderr||''].join('\n');
 await writeFile(join(out,id+'.console.log'),log);
 console.log('R45_ABBA_RUN',id,'exit',p.status,log.slice(-650));
 if(p.status!==0){results.errors.push('run '+id+' failed: '+log.slice(-1400));break;}
 const data=JSON.parse(await readFile(join(out,id,'result.json'),'utf8'));
 if(data.pass!==true||data.scenes?.length!==3){results.errors.push('invalid run '+id);break;}
 results.runs[id]=Object.fromEntries(data.scenes.map(s=>[s.name,{medianMs:s.medians.coldToCapturedFrameMs,renderer:s.renderer, samples:s.samples.map(x=>x.coldToCapturedFrameMs)}]));
}
if(!results.errors.length){
 for(const scene of ['building-1l','road-1l','mixed-4l']){
  const olA=results.runs.ol_a[scene].medianMs,olB=results.runs.ol_b[scene].medianMs;
  const baseline=(olA+olB)/2;
  for(const id of ['r45_a','r45_b']){
   const frame=results.runs[id][scene].medianMs;
   const improvementPct=Number(((baseline-frame)/baseline*100).toFixed(3));
   const pass=improvementPct>=50;
   results.scenes.push({scene,trial:id,olA,olB,olPairedMedianBaseline:baseline,r45FirstFrameMs:frame,improvementPct,pass});
   if(!pass)results.errors.push(scene+' '+id+' under 50%: '+improvementPct+'%');
  }
 }
}
results.pass=results.errors.length===0&&results.scenes.length===6;
await writeFile(join(out,'r45-performance.json'),JSON.stringify(results,null,2)+'\n');
console.log('R45_ABBA_RESULT',JSON.stringify({pass:results.pass,scenes:results.scenes,errors:results.errors}));
if(!results.pass)process.exitCode=1;
