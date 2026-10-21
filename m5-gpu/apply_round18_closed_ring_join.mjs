import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
const file=join(root,'our-renderer/integration/DirectFeatureWebGLPipeline.js');
let text=await readFile(file,'utf8');
const a='        const prev=path[i?i-1:0],next=path[i+2<count?i+2:i+1];';
const b=`        // Experimental: treat the first/last duplicate vertex of an uncut polygon ring as a join.
        const closed=globalThis.__m5R18ClosedRingJoin===true&&count>=4&&path[0]&&path[count-1]&&path[0][0]===path[count-1][0]&&path[0][1]===path[count-1][1];
        const prev=path[i?i-1:(closed?count-2:0)],next=path[i+2<count?i+2:(closed?1:i+1)];`;
if(!text.includes(a))throw Error('appendStrokePath anchor missing');
text=text.replace(a,b);await writeFile(file,text);
const page=join(root,'tests/round14_gpu_compare/round14_m5.html');
let src=await readFile(page,'utf8');
const needle='globalThis.__m5R18PolygonStrokeUnclipped=true;';
if(!src.includes(needle))throw Error('Must use polygon unclip before closed ring join experiment');
await writeFile(page,src.replace(needle,'globalThis.__m5R18ClosedRingJoin=true;\n'+needle));
console.log('R18_CLOSED_POLYGON_RING_JOIN_EXPERIMENT_READY');
