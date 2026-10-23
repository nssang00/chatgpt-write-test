/** Apply R45 app-level experimental changes to the pristine R35 ZIP extraction.
 * Safe and reproducible: checks all patch hunks before changing any file.
 * The R37 duplicate-reader changes are included in the patch; do not run
 * r37/patch_duplicate_decode.mjs on this same source a second time.
 */
import {copyFile,readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(process.argv[2]||'.');
const here=dirname(fileURLToPath(import.meta.url));
const originalHashes={
  "our-renderer/integration/workers/DirectTileEncodeTask.js": "669ce919111aa110592b6afd59f0560839f1b077c8f88c255127c285506f9151",
  "our-renderer/integration/DirectM5SceneBinding.js": "acb356f986fe8c039269046c6e375bcb9bc52012e3c33862930f2e2f9902e8d9",
  "our-renderer/adapters/openlayers/OlVectorTileSourceAdapter.js": "822d87c23468cb53bd59e7997b6ebe478dc060c4937e25363e02266723c15f06"
};
for(const [path,want] of Object.entries(originalHashes)){
 const bytes=await readFile(join(root,path));
 const got=createHash('sha256').update(bytes).digest('hex');
 console.log('R45_PINNED_R35_FILE_SHA256',path,got,'expected',want);
 if(got!==want)throw Error('R45 pinned source contents mismatch '+path);
}
const patch=join(here,'R45_APP_PATCH.diff');
execFileSync('git',['-c','core.autocrlf=false','apply','--ignore-whitespace','--check',patch],{cwd:root,stdio:'inherit'});
execFileSync('git',['-c','core.autocrlf=false','apply','--ignore-whitespace',patch],{cwd:root,stdio:'inherit'});
for(const [from,to] of [
 ['app/DeferredDirectTileHandover.js','our-renderer/integration/workers/DeferredDirectTileHandover.js'],
 ['app/EncodedTileExactGate.js','our-renderer/integration/workers/EncodedTileExactGate.js'],
 ['tests/verify_r45_handover.mjs','tests/verify_r45_handover.mjs'],
 ['tests/verify_r45_duplicate_cpu_equivalence.mjs','tests/verify_r45_duplicate_cpu_equivalence.mjs']]){
 await mkdir(dirname(join(root,to)),{recursive:true});await copyFile(join(here,from),join(root,to));
}
console.log('R45 source applied; use: node tests/verify_r45_handover.mjs');