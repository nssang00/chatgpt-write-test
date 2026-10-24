/** R48 candidate correctness fallback for stock OpenLayers line joins.
 * The R47 paired physical-RTX experiment showed that bypassing the direct
 * GPU-neighbor join path restores strict 512x512 RGBA8 parity for 8/16/32
 * independent MVT feeds. This retains the existing CPU encoder for joins.
 *
 * Applied to a SHA-pinned R35 extraction after R45 app patch. This is an
 * experimental build-time patch, NOT a production release or a proof of the
 * exact floating-point/neighbor bug inside the GPU join implementation.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const root=resolve(process.argv[2]||'.');
const file=join(root,'our-renderer/integration/DirectFeatureWebGLPipeline.js');
const source=await readFile(file,'utf8');
const anchor='const gpu=appendRenderFeatureGpuJoinNeighborsDirect(flat,ends,stride,lineWriter,rangeStart,rangeEnd,closedLineJoins);';
if(source.split(anchor).length!==2)throw Error('R48 CPU fallback anchor missing or duplicated; refusing ambiguous patch');
const updated=source.replace(anchor,
 'const gpu=null; // R48 strict-OL candidate: use existing CPU line-join encoder');
if(updated===source)throw Error('R48 patch had no effect');
await writeFile(file,updated);
console.log('R48_CPU_JOIN_FALLBACK_INSTALLED (experimental, Worker default unchanged)');
