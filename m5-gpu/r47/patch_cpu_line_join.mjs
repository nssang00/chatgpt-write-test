/** Diagnostic ONLY: replace direct GPU-join with the original CPU join encoder.
 * Applied to a SHA-pinned R35 + R45 extracted build, not a production change.
 * The test compares raw RTX 512x512 RGBA8 against stock OL 10.10.0.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]||'.');
const file=join(root,'our-renderer/integration/DirectFeatureWebGLPipeline.js');
let s=await readFile(file,'utf8');
const needle='const gpu=appendRenderFeatureGpuJoinNeighborsDirect(flat,ends,stride,lineWriter,rangeStart,rangeEnd,closedLineJoins);';
if(s.split(needle).length!==2)throw Error('R47 diagnostic GPU join anchor changed');
s=s.replace(needle,'const gpu=null; // R47 controlled diagnostic: CPU join for ALL line geometries');
await writeFile(file,s);
console.log('R47_DIAGNOSTIC_CPU_LINE_JOIN_INSTALLED');
