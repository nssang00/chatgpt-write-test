// Inspect WebGL command submission, not GPU execution time.
// Installed after Vite boot but BEFORE either map instance is constructed.
(function installWebGLAudit() {
  if (window.__glAudit) throw Error('GL_AUDIT_ALREADY_INSTALLED');
  const contexts = new WeakSet();
  const tracked = [];
  const phases = {};
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  let current = 'unassigned';

  const empty = () => ({
    drawCalls:0, drawArrays:0,drawElements:0,drawArraysInstanced:0,drawElementsInstanced:0,
    programsCreated:0,shadersCreated:0,shaderCompiles:0,programLinks:0,programUses:0,
    buffersCreated:0,bufferDataCalls:0,bufferDataBytes:0,bufferSubDataCalls:0,bufferSubDataBytes:0,
    vertexArraysCreated:0,framebufferBinds:0,clears:0,
    glCallCpuMs:0, callsObserved:0
  });
  const get = () => (phases[current] ??= empty());
  function byteSize(value){
    if(typeof value==='number')return Math.max(0,value);
    if(value && typeof value.byteLength==='number')return value.byteLength;
    return 0;
  }
  function wrap(gl,name,field,detail){
    const original=gl[name];
    if(typeof original!=='function')return;
    function wrapped(...args){
      const start=performance.now();
      const result=original.apply(gl,args);
      const duration=performance.now()-start;
      const s=get();
      if(field)s[field]++;
      if(field==='drawArrays'||field==='drawElements'||field==='drawArraysInstanced'||field==='drawElementsInstanced')s.drawCalls++;
      if(name==='bufferData'){
        s.bufferDataCalls++;
        s.bufferDataBytes+=byteSize(args[1]);
      }
      if(name==='bufferSubData'){
        s.bufferSubDataCalls++;
        s.bufferSubDataBytes+=byteSize(args[2]);
      }
      s.callsObserved++;
      s.glCallCpuMs+=duration;
      return result;
    }
    try{
      gl[name]=wrapped;
      if(gl[name]!==wrapped)throw Error('wrapper did not install');
    }catch(e){
      throw Error('GL_AUDIT_METHOD_NOT_PATCHABLE '+name+' '+String(e));
    }
  }
  function patchContext(gl,kind){
    if(!gl||contexts.has(gl))return gl;
    contexts.add(gl);
    const id=tracked.length;
    const support=(gl.getSupportedExtensions?.()||[]).filter(x=>/disjoint_timer_query/i.test(x));
    tracked.push({id,kind,extTimer:support});
    const trackedCalls=[
      ['drawArrays','drawArrays'],['drawElements','drawElements'],
      ['drawArraysInstanced','drawArraysInstanced'],['drawElementsInstanced','drawElementsInstanced'],
      ['createShader','shadersCreated'],['compileShader','shaderCompiles'],
      ['createProgram','programsCreated'],['linkProgram','programLinks'],
      ['useProgram','programUses'],
      ['createBuffer','buffersCreated'],['bufferData',null],['bufferSubData',null],
      ['createVertexArray','vertexArraysCreated'],
      ['bindFramebuffer','framebufferBinds'],['clear','clears']
    ];
    for(const [name,field] of trackedCalls)wrap(gl,name,field);

    // WebGL1's ANGLE_instanced_arrays draws bypass core drawArraysInstanced.
    const originalExtension=gl.getExtension;
    if(typeof originalExtension==='function'){
      gl.getExtension=function(name){
        const ext=originalExtension.call(gl,name);
        if(ext && name==='ANGLE_instanced_arrays'&&!ext.__auditWrapped){
          for(const [method,field] of [
            ['drawArraysInstancedANGLE','drawArraysInstanced'],
            ['drawElementsInstancedANGLE','drawElementsInstanced']
          ]){
            if(typeof ext[method]!=='function')continue;
            const f=ext[method];
            ext[method]=function(...a){
              const result=f.apply(ext,a),s=get();
              s[field]++;s.drawCalls++;s.callsObserved++;
              return result;
            };
          }
          try{Object.defineProperty(ext,'__auditWrapped',{value:true});}catch{}
        }
        return ext;
      };
    }
    return gl;
  }
  HTMLCanvasElement.prototype.getContext=function(type,...args){
    const ctx=originalGetContext.call(this,type,...args);
    if(type==='webgl'||type==='experimental-webgl'||type==='webgl2')return patchContext(ctx,type);
    return ctx;
  };
  window.__glAudit={
    setPhase(name){current=name;if(!phases[name])phases[name]=empty()},
    snapshot(name){return {...(phases[name]??empty()),
      glCallCpuMs:Math.round((phases[name]?.glCallCpuMs||0)*100)/100}},
    info(){return {contexts:tracked,contextCount:tracked.length,phaseNames:Object.keys(phases),
      caveat:'Command counts and uploaded bytes are instrumented JS->WebGL API calls, not GPU execution time or true GPU memory residency.'}},
    getSnapshotAll(){return JSON.parse(JSON.stringify(phases))}
  };
})();
