import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
const pipeline=join(root,'our-renderer/integration/DirectFeatureWebGLPipeline.js');
let s=await readFile(pipeline,'utf8');
const old='  const result={vertices,indices,lineInstances,packets,counters,indexType,indexBytes:indices.BYTES_PER_ELEMENT,';
if(!s.includes(old))throw Error('missing tile metadata anchor');
s=s.replace(old,'  const result={vertices,indices,lineInstances,packets,counters,clipExtent:clipExtent?Array.from(clipExtent):null,indexType,indexBytes:indices.BYTES_PER_ELEMENT,');
const anchor='    const drawOne=(key,tile,p,tileWorldOffsetX)=>{';
const helper=[
'    // OL limits rasterized fragments to each unbuffered source tile extent.',
'    const clipToTile=(tile,worldOffsetX)=>{',
'      if(!this.tileScissorEnabled||!frame?.clipMatrix||!tile.clipExtent){',
'        if(this.tileScissorEnabled)g.disable(g.SCISSOR_TEST);',
'        return;',
'      }',
'      const [minX,minY,maxX,maxY]=tile.clipExtent,m=frame.clipMatrix;',
'      const width=b.canvas.width,height=b.canvas.height;',
'      const point=(x,y)=>{',
'        const xx=x+worldOffsetX;',
'        return [(m[0]*xx+m[4]*y+m[12]+1)*width*0.5,(m[1]*xx+m[5]*y+m[13]+1)*height*0.5];',
'      };',
'      const corners=[point(minX,minY),point(minX,maxY),point(maxX,minY),point(maxX,maxY)];',
'      const left=Math.max(0,Math.min(width,Math.ceil(Math.min(...corners.map(p=>p[0]))-0.000001)));',
'      const bottom=Math.max(0,Math.min(height,Math.ceil(Math.min(...corners.map(p=>p[1]))-0.000001)));',
'      const right=Math.max(0,Math.min(width,Math.ceil(Math.max(...corners.map(p=>p[0]))-0.000001)));',
'      const top=Math.max(0,Math.min(height,Math.ceil(Math.max(...corners.map(p=>p[1]))-0.000001)));',
'      g.enable(g.SCISSOR_TEST);',
'      g.scissor(left,bottom,Math.max(0,right-left),Math.max(0,top-bottom));',
'    };',''
].join('\n');
if(!s.includes(anchor))throw Error('missing draw anchor');s=s.replace(anchor,helper+anchor);
const call='      const {vertexBase,indexBase,lineBase,vertexBuffer,indexBuffer,lineBuffer}=resolve(key,tile);';
if(!s.includes(call))throw Error('missing resolve');s=s.replace(call,'      clipToTile(tile,tileWorldOffsetX);\n'+call);
const end='    }else{\n      for(const [key,tile] of this.tiles)for(const p of tile.packets)drawOne(key,tile,p,worldOffsetX);\n    }\n  }';
if(!s.includes(end))throw Error('missing draw end');s=s.replace(end,end.replace('    }\n  }','    }\n    if(this.tileScissorEnabled)g.disable(g.SCISSOR_TEST);\n  }'));
await writeFile(pipeline,s);
const page=join(root,'tests/round14_gpu_compare/round14_m5.html');s=await readFile(page,'utf8');
const a='binding.start({renderSync:false});';
if(!s.includes(a))throw Error('missing binding start');
s=s.replace(a,'binding.bridge.pipeline.tileScissorEnabled=true;'+a);
await writeFile(page,s);
console.log('R18_OPTIN_TILE_SCISSOR_APPLIED');