/** R62 fail-closed CPU-first release SOURCE candidate audit, after R35+R45+R48 reconstruction.
 * Scope: tests/source integrity, NOT production/browser-release approval.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(process.argv[2]||'.'),out=resolve(process.argv[3]||join(root,'RESULTS','R62_RELEASE'));
await mkdir(out,{recursive:true});
const sha=async path=>createHash('sha256').update(await readFile(join(root,path))).digest('hex');
const files=['our-renderer/integration/DirectFeatureWebGLPipeline.js',
 'our-renderer/integration/DirectM5SceneBinding.js',
 'our-renderer/adapters/openlayers/OlVectorTileSourceAdapter.js',
 'our-renderer/integration/workers/DeferredDirectTileHandover.js',
 'our-renderer/integration/workers/EncodedTileExactGate.js',
 'our-renderer/integration/workers/DirectTileEncodeTask.js'];
const record={pass:false,schema:'R62-CPU-first-beta-source-candidate-v1',source:'SHA256-pinned R35+R45+R48',
 workerDefault:'OFF',limitations:['Not a deployable installer or binary','Original legacy GPU line join mandated test not compatible with intentional CPU fallback',
 'Requires R61 complete CI','Requires actual application feature-flag rollback E2E','Limited dataset and RTX GPU'],
 checks:[],tests:[],criticalFileShas:{},errors:[]};
const check=(name,ok)=>{record.checks.push({name,pass:!!ok});if(!ok)throw Error('R62 audit failed '+name)};
try{
 for(const path of files)record.criticalFileShas[path]=await sha(path);
 const pipeline=await readFile(join(root,files[0]),'utf8');
 const binding=await readFile(join(root,files[1]),'utf8');
 const bridge=await readFile(join(root,'our-renderer/OpenLayersRendererBinding.js'),'utf8');
 check('R48 CPU line join fallback exactly once',pipeline.split('const gpu=null; // R48 strict-OL candidate: use existing CPU line-join encoder').length===2);
 check('R45 Worker default OFF, explicit opt-in only',binding.includes('deferredWorker=null')&&
  binding.includes('this._deferredConfig=deferredWorker?.enabled===true?deferredWorker:null'));
 check('R45 opt-in config flows to real OL binding',bridge.includes('static async createDirectScene(options={})')&&bridge.includes('new DirectM5SceneBinding(options)'));
 check('R45 actual handover implementation exists',record.criticalFileShas[files[3]].length===64);
 const tests=['verify_r45_handover.mjs','verify_r45_duplicate_cpu_equivalence.mjs','verify_r34_shared_worker_pool.mjs',
  'verify_r33_worker_pool.mjs','verify_direct_feature_edge_cases.mjs'];
 for(const test of tests){
  const start=performance.now();
  try{
   const stdout=execFileSync(process.execPath,[join(root,'tests',test)],{cwd:root,encoding:'utf8',timeout:70000,maxBuffer:8*1024*1024});
   record.tests.push({test,pass:true,elapsedMs:Number((performance.now()-start).toFixed(1)),
    outputTail:stdout.slice(-500)});
  }catch(e){
   record.tests.push({test,pass:false,error:String(e.stderr||e.message).slice(-800)});throw Error('CPU-first regression failed: '+test);
  }
 }
 record.pass=true;
}catch(e){record.errors.push(String(e.stack||e));record.pass=false}
finally{
 await writeFile(join(out,'R62_GATE.json'),JSON.stringify(record,null,2)+'\n');
 console.log('R62_SOURCE_CANDIDATE',JSON.stringify({pass:record.pass,tests:record.tests.map(x=>({name:x.test,pass:x.pass})),
  checks:record.checks,errors:record.errors},null,2));
}
if(!record.pass)process.exitCode=1;