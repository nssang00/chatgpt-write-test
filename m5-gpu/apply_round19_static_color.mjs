import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
const file=join(root,'our-renderer/integration/DirectFeatureWebGLPipeline.js');
let s=await readFile(file,'utf8');
const old="          const c=b.program(gpuJoin?'direct-feature-line-gpu':'direct-feature-line-cpu',gpuJoin?lineGpuJoinVertexShader:lineVertexShader,lineFragmentShader);";
const replacement=[
"          // OL FlatStyle literals are embedded in generated GLSL; compare",
"          // static colors against uniform-driven M5 to isolate ULP rounding.",
"          const fmt=v=>{const t=Number(v).toString();return t.includes('.')?t:t+'.0'};",
"          const useStatic=globalThis.__m5R19StaticStylePrecision===true;",
"          const signature=Array.from(p.style.strokeColor||[1,1,1,1]).map(fmt).join(', ');",
"          const frag=lineFragmentShader.replace('vec4 color = u_strokeColor;',",
"            'vec4 color = vec4('+signature+');');",
"          const c=b.program((gpuJoin?'direct-feature-line-gpu':'direct-feature-line-cpu')+(useStatic?'|r19static|'+signature:''),",
"            gpuJoin?lineGpuJoinVertexShader:lineVertexShader,useStatic?frag:lineFragmentShader);"
].join('\n');
if(s.split(old).length!==2)throw Error('Expected unique M5 line shader program source');
s=s.replace(old,replacement);
await writeFile(file,s);
const page=join(root,'tests/round14_gpu_compare/round14_m5.html');
let html=await readFile(page,'utf8');
const anchor='globalThis.__m5R18FlatUnclippedStroke=true;';
if(!html.includes(anchor))throw Error('M5 benchmark flags missing');
html=html.replace(anchor,'globalThis.__m5R19StaticStylePrecision=true;'+anchor);
await writeFile(page,html);
console.log('R19_FLAT_STYLE_STATIC_GLSL_COLOR_READY');
