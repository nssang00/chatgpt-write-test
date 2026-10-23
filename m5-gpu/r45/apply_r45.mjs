/** Apply R45 app-level experimental changes to the pristine R35 ZIP extraction.
 * Safe and reproducible: checks all patch hunks before changing any file.
 * The R37 duplicate-reader changes are included in the patch; do not run
 * r37/patch_duplicate_decode.mjs on this same source a second time.
 */
import {copyFile,readFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(process.argv[2]||'.');
const here=dirname(fileURLToPath(import.meta.url));
const patch=join(here,'R45_APP_PATCH.diff');
execFileSync('git',['apply','--check',patch],{cwd:root,stdio:'inherit'});
execFileSync('git',['apply',patch],{cwd:root,stdio:'inherit'});
for(const [from,to] of [
 ['app/DeferredDirectTileHandover.js','our-renderer/integration/workers/DeferredDirectTileHandover.js'],
 ['app/EncodedTileExactGate.js','our-renderer/integration/workers/EncodedTileExactGate.js'],
 ['tests/verify_r45_handover.mjs','tests/verify_r45_handover.mjs']]){
 await mkdir(dirname(join(root,to)),{recursive:true});await copyFile(join(here,from),join(root,to));
}
console.log('R45 source applied; use: node tests/verify_r45_handover.mjs');