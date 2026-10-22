import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const file=join(resolve(process.argv[2]||'.'),'tests/round14_gpu_compare/round14_m5.html');
let s=await readFile(file,'utf8');
const anchors=[
 ["import MVT from '../../vendor/openlayers-10.10.0-runtime/node_modules/ol/format/MVT.js';",
  "import MVT from '../../vendor/openlayers-10.10.0-runtime/node_modules/ol/format/MVT.js';\nimport FastMVT from '../../vendor/openlayers-10.10.0-runtime/node_modules/ol/format/MVT.worker.js';"],
 ["MVT,keys,spec,bytesByTile,extent,shared:round11Shared,noCopy:workerPoolMode==='deferred'",
  "MVT:workerPoolMode==='deferred'?FastMVT:MVT,keys,spec,bytesByTile,extent,shared:round11Shared,noCopy:workerPoolMode==='deferred'"]
];
for(const [a,b] of anchors){if(!s.includes(a))throw Error('R42 anchor missing '+a);s=s.replace(a,b)}
await writeFile(file,s);console.log('R42_PATCHED worker-safe PBF parser for deferred first frame');