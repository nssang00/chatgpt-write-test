import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
const filename=join(root,'our-renderer/integration/DirectFeatureWebGLPipeline.js');
let s=await readFile(filename,'utf8');
const change=(needle,replacement)=>{if(s.split(needle).length!==2)throw Error('Missing unique source anchor '+needle.slice(0,75));s=s.replace(needle,replacement)};
change('  push8(a,b,c,d,e,f,g,h){this.ensure(8);const v=this.data;let n=this.length;\n    v[n++]=a;v[n++]=b;v[n++]=c;v[n++]=d;v[n++]=e;v[n++]=f;v[n++]=g;v[n++]=h;this.length=n;}',
 '  push8(a,b,c,d,e,f,g,h){this.ensure(8);const v=this.data;let n=this.length;const o=this._tileOrigin;v[n++]=o?a-o[0]:a;v[n++]=o?b-o[1]:b;v[n++]=o?c-o[0]:c;v[n++]=o?d-o[1]:d;v[n++]=o?e-o[0]:e;v[n++]=o?f-o[1]:f;v[n++]=o?g-o[0]:g;v[n++]=o?h-o[1]:h;this.length=n;}');
change('  push8Reserved(a,b,c,d,e,f,g,h){const v=this.data;let n=this.length;\n    v[n++]=a;v[n++]=b;v[n++]=c;v[n++]=d;v[n++]=e;v[n++]=f;v[n++]=g;v[n++]=h;this.length=n;}',
 '  push8Reserved(a,b,c,d,e,f,g,h){const v=this.data;let n=this.length;const o=this._tileOrigin;\n    v[n++]=o?a-o[0]:a;v[n++]=o?b-o[1]:b;v[n++]=o?c-o[0]:c;v[n++]=o?d-o[1]:d;v[n++]=o?e-o[0]:e;v[n++]=o?f-o[1]:f;v[n++]=o?g-o[0]:g;v[n++]=o?h-o[1]:h;this.length=n;}');
change('  append(data){this.ensure(data.length);this.data.set(data,this.length);this.length+=data.length;}',
 '  append(data){this.ensure(data.length);const o=this._tileOrigin;if(!o){this.data.set(data,this.length);}else{if(data.length%8)throw Error("Unexpected line CPU fallback stride");for(let i=0;i<data.length;i+=8){const n=this.length+i;this.data[n]=data[i]-o[0];this.data[n+1]=data[i+1]-o[1];this.data[n+2]=data[i+2]-o[0];this.data[n+3]=data[i+3]-o[1];for(let j=4;j<8;j++)this.data[n+j]=data[i+j];}}this.length+=data.length;}');
change('  const verticesWriter=new FloatStreamWriter(hint.vertices),indicesWriter=new IndexStreamWriter(hint.indices),lineWriter=new FloatStreamWriter(hint.lines);',
 '  const verticesWriter=new FloatStreamWriter(hint.vertices),indicesWriter=new IndexStreamWriter(hint.indices),lineWriter=new FloatStreamWriter(hint.lines);\n  if(globalThis.__m5R20TileLocalStroke===true && clipExtent)lineWriter._tileOrigin=[clipExtent[0],clipExtent[1]];');
change('          this.lineUniforms.setUniforms(b,c,p.style,1,frame);',
`          let lineFrame=frame;
          if(this.tileLocalLineCoordinates===true&&tile.clipExtent&&frame?.clipMatrix){
            const m=frame.clipMatrix,local=new Float32Array(m),ox=tile.clipExtent[0],oy=tile.clipExtent[1];
            for(let k=0;k<4;k++)local[12+k]=m[12+k]+m[k]*ox+m[4+k]*oy;
            lineFrame={...frame,clipMatrix:local};
          }
          this.lineUniforms.setUniforms(b,c,p.style,1,lineFrame);`);
await writeFile(filename,s);
const page=join(root,'tests/round14_gpu_compare/round14_m5.html');
s=await readFile(page,'utf8');
const anchor='binding.bridge.pipeline.tileScissorEnabled=true;';
if(!s.includes(anchor))throw Error('Requires Round18 tile clipping');
s=s.replace(anchor,'globalThis.__m5R20TileLocalStroke=true;binding.bridge.pipeline.tileLocalLineCoordinates=true;'+anchor);
await writeFile(page,s);
console.log('ROUND20_OL_LOCAL_TILE_COORDINATES_READY');