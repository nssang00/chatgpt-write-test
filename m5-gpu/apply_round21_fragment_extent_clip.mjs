import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
async function patch(path,old,replacement){
 const file=join(root,path),s=await readFile(file,'utf8');
 if(s.split(old).length!==2)throw Error('Nonunique or missing '+path+': '+old.slice(0,100));
 await writeFile(file,s.replace(old,replacement));
}
const test='vec2 cp=2.0*(gl_FragCoord.xy/u_pixelRatio)/u_viewportSizePx-1.0;vec2 wp=(u_invertProjectionMatrix*vec4(cp,0.0,1.0)).xy;if(abs(u_renderExtent.x-u_renderExtent.z)>0.0&&(wp.x<u_renderExtent.x||wp.y<u_renderExtent.y||wp.x>u_renderExtent.z||wp.y>u_renderExtent.w))discard;';
await patch('our-renderer/shaders/lineShaders.js',
 'uniform float u_pixelRatio;',
 'uniform float u_pixelRatio;\nuniform mat4 u_invertProjectionMatrix;\nuniform vec4 u_renderExtent;');
await patch('our-renderer/shaders/lineShaders.js',
 '  vec2  currentPoint = gl_FragCoord.xy / u_pixelRatio;',
 '  '+test+'\n  vec2  currentPoint = gl_FragCoord.xy / u_pixelRatio;');
await patch('our-renderer/renderers/SimpleRenderer.js',
 'precision mediump float; uniform vec4 u_color;',
 'precision highp float; uniform mat4 u_invertProjectionMatrix; uniform vec4 u_renderExtent; uniform vec2 u_viewportSizePx; uniform float u_pixelRatio; uniform vec4 u_color;');
await patch('our-renderer/renderers/SimpleRenderer.js',
 'void main(){ vec4 color=u_color;',
 'void main(){ '+test+' vec4 color=u_color;');
const helper=[
 '    const r21Cache=new Map();',
 '    const r21Uniforms=(c,key,tile,offsetX)=>{',
 '      const clip=tile.clipExtent,m=frame?.clipMatrix;',
 '      if(!clip||!m){b.uniform4fv(b.uniform(c,\'u_renderExtent\'),new Float32Array([0,0,0,0]));return;}',
 '      const cacheKey=key+"|"+offsetX;',
 '      let params=r21Cache.get(cacheKey);',
 '      if(!params){',
 '        const a=m[0],bb=m[1],cc=m[4],d=m[5],tx=m[12],ty=m[13],det=a*d-bb*cc;',
 '        if(!Number.isFinite(det)||Math.abs(det)<1e-30)throw Error("Noninvertible projection");',
 '        const inv=new Float32Array([d/det,-bb/det,0,0,-cc/det,a/det,0,0,0,0,1,0,',
 '          (cc*ty-d*tx)/det,(bb*tx-a*ty)/det,0,1]);',
 '        const extent=new Float32Array([clip[0]+offsetX,clip[1],clip[2]+offsetX,clip[3]]);',
 '        params={inv,extent};r21Cache.set(cacheKey,params);',
 '      }',
 '      b.uniformMatrix4fv(b.uniform(c,\'u_invertProjectionMatrix\'),false,params.inv);',
 '      b.uniform4fv(b.uniform(c,\'u_renderExtent\'),params.extent);',
 '    };'
].join('\n')+'\n';
await patch('our-renderer/integration/DirectFeatureWebGLPipeline.js',
 '    const drawOne=(key,tile,p,tileWorldOffsetX)=>{',
 helper+'    const drawOne=(key,tile,p,tileWorldOffsetX)=>{');
await patch('our-renderer/integration/DirectFeatureWebGLPipeline.js',
 '          this.lineUniforms.setUniforms(b,c,p.style,1,frame);',
 '          this.lineUniforms.setUniforms(b,c,p.style,1,frame);\n          r21Uniforms(c,key,tile,tileWorldOffsetX);');
await patch('our-renderer/integration/DirectFeatureWebGLPipeline.js',
 "          b.uniformMatrix4fv(b.uniform(c,'u_projectionMatrix'),false,frame?.clipMatrix||DEFAULT_MATRIX);",
 "          b.uniformMatrix4fv(b.uniform(c,'u_projectionMatrix'),false,frame?.clipMatrix||DEFAULT_MATRIX);\n          b.uniform1f(b.uniform(c,'u_pixelRatio'),frame?.pixelRatio||1);\n          b.uniform2f(b.uniform(c,'u_viewportSizePx'),frame?.size?.[0]||b.canvas.width,frame?.size?.[1]||b.canvas.height);\n          r21Uniforms(c,key,tile,tileWorldOffsetX);");
await patch('tests/round14_gpu_compare/round14_m5.html',
 'binding.bridge.pipeline.tileScissorEnabled=true;',
 'binding.bridge.pipeline.tileScissorEnabled=false;binding.bridge.pipeline.tileFragmentClipEnabled=true;');
// The original simple vertex shader declares shared u_pointSize as mediump.
// GLSL ES 1.00 requires matching uniform precision across shader stages.
await patch('our-renderer/renderers/SimpleRenderer.js',
 'uniform float u_pointSize; uniform bool u_premultiplyAlpha;',
 'uniform mediump float u_pointSize; uniform bool u_premultiplyAlpha;');
console.log('ROUND21_PER_FRAGMENT_EXTENT_CLIP_APPLIED');