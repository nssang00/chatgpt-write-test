// On-GPU per-draw sampling and shader-program census for the real map WebGL context.
// Do not infer total GPU time by summing isolated query times: query instrumentation changes the workload.
(function(){
  if(window.__perDrawGPU)throw Error('PROFILER_ALREADY_INSTALLED');
  const contexts=[];
  const getContext=HTMLCanvasElement.prototype.getContext;
  let active=null;
  let nextProgram=0,nextShader=0;
  const programs=new WeakMap(),shaders=new WeakMap();
  const programLog=[];
  const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(16).padStart(8,'0')};
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function webGLCurrent(){
    if(contexts.length!==1)throw Error('EXPECTED_ONE_ACTUAL_GL_CONTEXT '+contexts.length);
    const c=contexts[0];
    if(!c.ext)throw Error('MISSING_GPU_DISJOINT_TIMER_EXTENSION');
    return c;
  }
  function patch(gl){
    const webgl2=typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext;
    const ext=gl.getExtension(webgl2?'EXT_disjoint_timer_query_webgl2':'EXT_disjoint_timer_query');
    const info=gl.getExtension('WEBGL_debug_renderer_info');
    const renderer=String(info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER));
    const ctx={gl,ext,webgl2,renderer,webglVersion:webgl2?2:1,type:webgl2?'webgl2':'webgl1'};
    contexts.push(ctx);
    const wrap=(name,callback)=>{
      const original=gl[name];if(typeof original!=='function')return;
      const replacement=function(...args){return callback.call(this,original,args)};
      try{gl[name]=replacement;if(gl[name]!==replacement)throw Error('not patched');}
      catch(e){throw Error('WEBGL_PROBE_PATCH_FAILED '+name+' '+String(e))}
    };
    wrap('createProgram',function(original,args){
      const p=original.apply(gl,args);
      if(p){const meta={id:++nextProgram,shaders:[],linked:0};programs.set(p,meta);programLog.push(meta)}
      return p;
    });
    wrap('createShader',function(original,args){
      const sh=original.apply(gl,args);
      if(sh)shaders.set(sh,{id:++nextShader,type:args[0]===gl.FRAGMENT_SHADER?'fragment':'vertex',hash:null,bytes:0});
      return sh;
    });
    wrap('shaderSource',function(original,args){
      const sh=shaders.get(args[0]);if(sh){sh.hash=hash(String(args[1]));sh.bytes=String(args[1]).length;}
      return original.apply(gl,args);
    });
    wrap('attachShader',function(original,args){
      const p=programs.get(args[0]),sh=shaders.get(args[1]);
      if(p&&sh)p.shaders.push({...sh});
      return original.apply(gl,args);
    });
    wrap('linkProgram',function(original,args){
      const p=programs.get(args[0]);if(p)p.linked++;
      return original.apply(gl,args);
    });
    wrap('useProgram',function(original,args){
      ctx.currentProgram=args[0]?programs.get(args[0])||null:null;
      return original.apply(gl,args);
    });
    const makeDraw=(method,fn)=>{
      wrap(method,function(original,args){
        let record=null,query=null;
        if(active){
          const a=active,number=a.ordinal++;
          const program=ctx.currentProgram;
          const id=program?.id||0;
          const stat=a.perProgram.get(id)||{id,drawCalls:0,elements:0,drawsByMode:{}};
          stat.drawCalls++;
          const n=Number(args[method.startsWith('drawElements')?1:2])||0;
          stat.elements+=n;
          const mode=String(args[0]);
          stat.drawsByMode[mode]=(stat.drawsByMode[mode]||0)+1;
          a.perProgram.set(id,stat);
          if(a.picks.has(number)){
            if(gl.getParameter(ext.GPU_DISJOINT_EXT))throw Error('GPU_DISJOINT_BEFORE_INDIVIDUAL_DRAW');
            query=webgl2?gl.createQuery():ext.createQueryEXT();
            if(!query)throw Error('CREATE_PER_DRAW_QUERY_FAILED');
            if(webgl2)gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
            else ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,query);
            record={ordinal:number,programId:id,method,mode,vertexOrIndexCount:n,query};
            a.timed.push(record);
          }
        }
        try{return fn?fn(original,args):original.apply(gl,args)}
        finally{if(query){if(webgl2)gl.endQuery(ext.TIME_ELAPSED_EXT);else ext.endQueryEXT(ext.TIME_ELAPSED_EXT)}}
      });
    };
    for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced'])makeDraw(name);
    const nativeExtension=gl.getExtension.bind(gl);
    gl.getExtension=function(name){
      const out=nativeExtension(name);
      if(name==='ANGLE_instanced_arrays'&&out&&!out.__perDrawPatched){
        for(const method of ['drawElementsInstancedANGLE','drawArraysInstancedANGLE']){
          const f=out[method];if(typeof f!=='function')continue;
          out[method]=function(...args){
            // WebGL1 ANGLE draw methods are counted as draw calls.
            let record=null,query=null;
            if(active){
              const a=active,number=a.ordinal++,id=ctx.currentProgram?.id||0;
              const stat=a.perProgram.get(id)||{id,drawCalls:0,elements:0,drawsByMode:{}};
              stat.drawCalls++;stat.elements+=Number(args[1])||0;
              stat.drawsByMode[String(args[0])]=(stat.drawsByMode[String(args[0])]||0)+1;
              a.perProgram.set(id,stat);
              if(a.picks.has(number)){
                query=webgl2?gl.createQuery():ext.createQueryEXT();
                if(!query)throw Error('CREATE_EXT_DRAW_QUERY_FAILED');
                if(webgl2)gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
                else ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,query);
                record={ordinal:number,programId:id,method,mode:String(args[0]),vertexOrIndexCount:Number(args[1])||0,query};
                a.timed.push(record);
              }
            }
            try{return f.apply(out,args)}
            finally{if(query){if(webgl2)gl.endQuery(ext.TIME_ELAPSED_EXT);else ext.endQueryEXT(ext.TIME_ELAPSED_EXT)}}
          }
        }
        try{Object.defineProperty(out,'__perDrawPatched',{value:true})}catch{}
      }
      return out;
    };
  }
  HTMLCanvasElement.prototype.getContext=function(type,...args){
    const gl=getContext.call(this,type,...args);
    if(gl&&['webgl2','webgl','experimental-webgl'].includes(type)&&!contexts.some(x=>x.gl===gl))patch(gl);
    return gl;
  };
  function start(picks=[]){
    if(active)throw Error('OVERLAPPING_FRAMES');
    const p=new Set(picks);
    active={ordinal:0,perProgram:new Map(),picks:p,timed:[]};
  }
  function end(){
    if(!active)throw Error('NO_ACTIVE_FRAME');
    const a=active;active=null;
    const programsByDraw=[...a.perProgram.values()].sort((x,y)=>y.drawCalls-x.drawCalls);
    return {drawCalls:a.ordinal,programs:programsByDraw,
      timed:a.timed,
      shaderProgramsCreated:programLog.length};
  }
  const info=()=>{const c=webGLCurrent();return {
    renderer:c.renderer,webglVersion:c.webglVersion,
    timerSupported:!!c.ext,programsCreated:programLog.length,
    programs:programLog.map(x=>({id:x.id,shaders:x.shaders,linked:x.linked}))
  }};
  async function redraw(engine,map){
    if(engine==='maplibre'){
      await new Promise((resolve,reject)=>{
        const t=setTimeout(()=>reject(Error('MAPLIBRE_RENDER_EVENT_TIMEOUT')),12000);
        map.once('render',()=>{clearTimeout(t);resolve()});
        map.triggerRepaint();
      });
    }else{
      map.renderSync();
    }
  }
  async function waitQueries(timed){
    const c=webGLCurrent(),{gl,ext,webgl2}=c;
    if(!timed.length)return [];
    gl.flush();
    const deadline=performance.now()+15000;
    while(performance.now()<deadline){
      const available=timed.every(x=>webgl2?
        gl.getQueryParameter(x.query,gl.QUERY_RESULT_AVAILABLE):
        ext.getQueryObjectEXT(x.query,ext.QUERY_RESULT_AVAILABLE_EXT));
      if(available)break;
      await sleep(8);
    }
    if(timed.some(x=>!(webgl2?gl.getQueryParameter(x.query,gl.QUERY_RESULT_AVAILABLE):
      ext.getQueryObjectEXT(x.query,ext.QUERY_RESULT_AVAILABLE_EXT))))throw Error('INDIVIDUAL_QUERY_TIMEOUT');
    const disjoint=Boolean(gl.getParameter(ext.GPU_DISJOINT_EXT));
    if(disjoint)throw Error('GPU_DISJOINT_AFTER_QUERIES');
    const values=timed.map(x=>{
      const nanoseconds=webgl2?gl.getQueryParameter(x.query,gl.QUERY_RESULT):
        ext.getQueryObjectEXT(x.query,ext.QUERY_RESULT_EXT);
      return {ordinal:x.ordinal,programId:x.programId,method:x.method,
        mode:x.mode,vertexOrIndexCount:x.vertexOrIndexCount,
        gpuNanoseconds:Number(nanoseconds),gpuMs:Number(nanoseconds)/1e6};
    });
    for(const x of timed){
      if(webgl2)gl.deleteQuery(x.query);else ext.deleteQueryEXT(x.query);
    }
    if(values.some(x=>!Number.isFinite(x.gpuMs)||x.gpuMs<=0))throw Error('BAD_PER_DRAW_NANOSECONDS '+JSON.stringify(values));
    return values;
  }
  async function census(engine,map){
    start();
    try{await redraw(engine,map);const result=end();
      return {drawCalls:result.drawCalls,programs:result.programs,
        programsCreated:result.shaderProgramsCreated};
    }catch(e){if(active)active=null;throw e}
  }
  async function fullFrame(engine,map){
    const c=webGLCurrent(),{gl,ext,webgl2}=c;
    if(gl.getParameter(ext.GPU_DISJOINT_EXT))throw Error('GPU_DISJOINT_BEFORE_FRAME');
    const q=webgl2?gl.createQuery():ext.createQueryEXT();
    if(!q)throw Error('CREATE_FRAME_QUERY_FAILED');
    let opened=false,closed=false;
    try{
      start();
      if(webgl2)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);else ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,q);
      opened=true;
      await redraw(engine,map);
      if(webgl2)gl.endQuery(ext.TIME_ELAPSED_EXT);else ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
      closed=true;
      const drawn=end();
      const a=await waitQueries([{query:q,ordinal:0,programId:0,method:'all',mode:'',vertexOrIndexCount:drawn.drawCalls}]);
      return {gpuMs:a[0].gpuMs,drawCalls:drawn.drawCalls};
    }finally{
      if(opened&&!closed){try{if(webgl2)gl.endQuery(ext.TIME_ELAPSED_EXT);else ext.endQueryEXT(ext.TIME_ELAPSED_EXT)}catch{}}
      if(active)active=null;
    }
  }
  function choose(total,samples,offset){
    return Array.from({length:Math.min(samples,total)},(_,i)=>Math.min(total-1,Math.floor((i+(offset+0.5)/4)*total/Math.min(samples,total))));
  }
  async function profile(engine,map,picks){
    start(picks);
    try{
      await redraw(engine,map);
      const frame=end();
      const values=await waitQueries(frame.timed);
      if(values.length!==new Set(picks).size)throw Error('MISSING_PROFILED_DRAWS '+values.length+' of '+picks.length+' total '+frame.drawCalls);
      return {drawCalls:frame.drawCalls,values};
    }catch(e){if(active)active=null;throw e}
  }
  window.__perDrawGPU={info,census,fullFrame,choose,profile,redraw};
})();