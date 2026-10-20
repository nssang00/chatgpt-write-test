import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const roots=process.argv.slice(2);
if(!roots.length)throw Error('Expected project roots containing RESULTS');
const verdicts=[];
for(const root of roots){
 const entries=(await readdir(join(root,'RESULTS'),{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name.startsWith('ROUND14_VS_OL_GPU_'));
 if(!entries.length)throw Error('Missing real RTX result at '+root);
 const dir=join(root,'RESULTS',entries.sort((a,b)=>a.name.localeCompare(b.name)).at(-1).name);
 const m=JSON.parse(await readFile(join(dir,'manifest.json')));
 const rows=m.rows||[],mandatory=['building-1l','road-1l','mixed-4l'];
 const ok=Boolean(m.complete&&m.performanceComparable&&m.pixelParityAll&&m.withinRendererStable&&rows.length===3&&mandatory.every(n=>rows.some(r=>r.scene===n&&r.pixelExact===true&&r.stableWithinEachRenderer===true)));
 verdicts.push({variant:root,ok,details:rows.map(r=>({scene:r.scene,diff:r.pixelDiffRuns,stable:r.stableWithinEachRenderer,olMs:r.olMedianMs,m5Ms:r.m5MedianMs}))});
}
console.log(JSON.stringify(verdicts,null,2));
if(!verdicts.some(v=>v.ok))throw Error('STRICT_RGBA8_PARITY_FAILED: No full 3-scene equality variant; no success claim permitted');
