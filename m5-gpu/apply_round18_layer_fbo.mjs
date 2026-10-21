import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
const path=join(root,'our-renderer/integration/DirectM5SceneBinding.js');
let s=await readFile(path,'utf8');
const orig=["    this.backend.beginFrame();","    this.bridge.pipeline.draw({frame:toNeutralFrame(frameState),packetSchedule:schedule});","    const tEnd=timed?performance.now():0;"].join('\n');
if(!s.includes(orig))throw Error('Render loop anchor not found');
const repl=["    this.backend.beginFrame();","    const neutralFrame=toNeutralFrame(frameState);","    if(this.vectorTileOptions.olLayerFboComposition===true&&this.layers.size>1){","      this._renderCompositedLayers(neutralFrame,schedule);","    }else{","      this.bridge.pipeline.draw({frame:neutralFrame,packetSchedule:schedule});","    }","    const tEnd=timed?performance.now():0;"].join('\n');
s=s.replace(orig,repl);
const anchor='  renderFrame(frameState){';
if(!s.includes(anchor))throw Error('renderFrame insertion anchor not found');
const func=[
'  _renderCompositedLayers(frame,schedule){',
'    const b=this.backend,gl=b.gl,width=b.canvas.width,height=b.canvas.height;',
'    const prior=this._layerFbo;',
'    if(prior&&(prior.width!==width||prior.height!==height)){',
'      gl.deleteFramebuffer(prior.framebuffer);gl.deleteTexture(prior.texture);',
'      this._layerFbo=null;',
'    }',
'    if(!this._layerFbo){',
'      const framebuffer=gl.createFramebuffer(),texture=gl.createTexture();',
'      gl.bindTexture(gl.TEXTURE_2D,texture);',
'      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);',
'      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);',
'      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);',
'      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);',
'      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);',
'      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);',
'      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);',
'      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error("RGBA8 framebuffer incomplete");',
'      gl.bindFramebuffer(gl.FRAMEBUFFER,null);',
'      this._layerFbo={framebuffer,texture,width,height};',
'    }',
'    const target=this._layerFbo;',
"    const vs='attribute vec2 a_vertex;varying vec2 v_uv;void main(){v_uv=(a_vertex+1.0)*0.5;gl_Position=vec4(a_vertex,0.0,1.0);}';",
"    const fs='precision highp float;uniform sampler2D u_image;varying vec2 v_uv;void main(){gl_FragColor=texture2D(u_image,v_uv);}';",
"    const program=b.program('r18.layer.composite',vs,fs);",
'    if(!this._layerFboQuad){',
"      this._layerFboQuad=b.createBufferResource('ARRAY_BUFFER',32,'STATIC_DRAW');",
"      b.uploadBufferResource('ARRAY_BUFFER',this._layerFboQuad,0,new Float32Array([-1,-1,1,-1,-1,1,1,1]));",
'    }',
'    const flush=items=>{',
'      if(!items.length)return;',
'      gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);',
'      gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);',
'      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);',
'      b.invalidateStateCache();',
'      this.bridge.pipeline.draw({frame,packetSchedule:items});',
'      gl.bindFramebuffer(gl.FRAMEBUFFER,null);',
'      gl.viewport(0,0,width,height);',
'      b.invalidateStateCache();b.disableAllAttribs();b.useProgram(program.program);',
'      b.bindBuffer(gl.ARRAY_BUFFER,this._layerFboQuad);',
"      b.bindFloatAttrib(program,'a_vertex',2,0,0,0);",
'      gl.activeTexture(gl.TEXTURE0);b.bindTexture(gl.TEXTURE_2D,target.texture);',
"      b.uniform1i(b.uniform(program,'u_image'),0);",
'      b.drawArrays(gl.TRIANGLE_STRIP,0,4);',
'    };',
'    let group=[],priorLayer=null;',
'    for(const packet of schedule){',
"      const layerKey=String(packet.tileKey).split('::',1)[0];",
'      if(priorLayer!==null&&layerKey!==priorLayer){flush(group);group=[];}',
'      group.push(packet);priorLayer=layerKey;',
'    }',
'    flush(group);',
'    gl.bindFramebuffer(gl.FRAMEBUFFER,null);',
'    b.invalidateStateCache();',
'  }',''
].join('\n');
s=s.replace(anchor,func+anchor);
await writeFile(path,s);
const page=join(root,'tests/round14_gpu_compare/round14_m5.html');
s=await readFile(page,'utf8');
const pageAnchor='polygonInsideSegmentFastPath:!round12Baseline';
if(!s.includes(pageAnchor))throw Error('bench options anchor not found');
await writeFile(page,s.replace(pageAnchor,'olLayerFboComposition:true,'+pageAnchor));
console.log('R18_OPTIN_PER_LAYER_RGBA8_FBO_COMPOSITION_APPLIED');