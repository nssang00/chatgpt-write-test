import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd(),path=join(root,'our-renderer/adapters/openlayers/OlStyleAdapter.js');
let s=await readFile(path,'utf8');
const old="lineCap:style['stroke-line-cap']??'butt', lineJoin:style['stroke-line-join']??'miter',";
const repl="lineCap:style['stroke-line-cap']??'round', lineJoin:style['stroke-line-join']??'round',";
if(s.split(old).length!==2)throw Error('Round14 flat style default mismatch');
await writeFile(path,s.replace(old,repl));
console.log('R16_OL_STROKE_DEFAULTS_CORRECTED');
