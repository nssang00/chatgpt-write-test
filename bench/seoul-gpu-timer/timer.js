// Capture the WebGL renderer's *actual* context before map construction.
// Timer queries execute on GPU; reading the result is deliberately asynchronous.
(function(){
  if(window.__gpuTimer)throw Error('GPU_TIMER_ALREADY_INSTALLED');
  const previous=HTMLCanvasElement.prototype.getContext;
  const contexts=[];
  HTMLCanvasElement.prototype.getContext=function(type,...args){
    const gl=previous.call(this,type,...args);
    if(gl&&['webgl','experimental-webgl','webgl2'].includes(type)&&!contexts.some(x=>x.gl===gl)){
      const webgl2=(typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext);
      const ext=gl.getExtension(webgl2?'EXT_disjoint_timer_query_webgl2':'EXT_disjoint_timer_query');
      const infoExt=gl.getExtension('WEBGL_debug_renderer_info');
      let renderer=String(gl.getParameter(gl.RENDERER));
      if(infoExt)renderer=String(gl.getParameter(infoExt.UNMASKED_RENDERER_WEBGL));
      contexts.push({gl,ext,webgl2,renderer,type,canvas:this});
    }
    return gl;
  };
  const sleep=(t)=>new Promise(r=>setTimeout(r,t));
  const waitEvent=(map,event,trigger,timeoutMs=12000)=>new Promise((resolve,reject)=>{
    let done=false;
    const timeout=setTimeout(()=>{if(!done){done=true;reject(Error('FRAME_RENDER_TIMEOUT_'+event))}},timeoutMs);
    const onEvent=()=>{if(done)return;done=true;clearTimeout(timeout);resolve()};
    if(event==='render'&&typeof map.off==='function'){
      map.once(event,onEvent);
    } else {
      map.once(event,onEvent);
    }
    try{trigger()}catch(e){clearTimeout(timeout);reject(e)}
  });
  const details=()=>contexts.map(x=>({webglVersion:x.webgl2?2:1,type:x.type,
    extensionSupported:!!x.ext,renderer:x.renderer}));
  function getRendererCtx(){
    if(contexts.length!==1)throw Error('EXPECTED_EXACTLY_ONE_RENDER_CONTEXT '+JSON.stringify(details()));
    const x=contexts[0];
    if(!x.ext)throw Error('EXT_DISJOINT_TIMER_QUERY_NOT_SUPPORTED '+JSON.stringify(details()));
    return x;
  }
  async function repaint(engine,map){
    if(engine==='maplibre'){
      await waitEvent(map,'render',()=>map.triggerRepaint());
    }else{
      // Synchronous OpenLayers render ensures draw commands are submitted before return.
      map.renderSync();
    }
  }
  async function timeFrame(engine,map){
    const {gl,ext,webgl2}=getRendererCtx();
    const target=ext.TIME_ELAPSED_EXT;
    if(gl.getParameter(ext.GPU_DISJOINT_EXT))throw Error('GPU_DISJOINT_BEFORE_QUERY');
    const query=webgl2?gl.createQuery():ext.createQueryEXT();
    if(!query)throw Error('GPU_TIMER_QUERY_CREATION_FAILED');
    let started=false,ended=false;
    try{
      if(webgl2)gl.beginQuery(target,query);
      else ext.beginQueryEXT(target,query);
      started=true;
      // Note: for MapLibre endQuery runs *during* the render callback, after map draws.
      // This excludes browser compositor and any other GL context.
      if(engine==='maplibre'){
        await waitEvent(map,'render',()=>{
          map.triggerRepaint();
        }).then(()=>{
          if(webgl2)gl.endQuery(target);else ext.endQueryEXT(target);
          ended=true;
        });
      }else{
        map.renderSync();
        if(webgl2)gl.endQuery(target);else ext.endQueryEXT(target);
        ended=true;
      }
      gl.flush();
      // Poll without gl.finish, avoiding CPU/GPU synchronization and blocking.
      // Cannot access QUERY_RESULT until QUERY_RESULT_AVAILABLE is true.
      const deadline=performance.now()+12000;
      let ready=false,iterations=0;
      while(performance.now()<deadline){
        ready=webgl2?gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE):
          ext.getQueryObjectEXT(query,ext.QUERY_RESULT_AVAILABLE_EXT);
        if(ready)break;
        iterations++;await sleep(8);
      }
      if(!ready)throw Error('GPU_QUERY_TIMEOUT');
      const disjoint=Boolean(gl.getParameter(ext.GPU_DISJOINT_EXT));
      if(disjoint)throw Error('GPU_DISJOINT_AFTER_QUERY');
      const nanoseconds=webgl2?gl.getQueryParameter(query,gl.QUERY_RESULT):
        ext.getQueryObjectEXT(query,ext.QUERY_RESULT_EXT);
      if(!Number.isFinite(nanoseconds)||nanoseconds<=0)throw Error('INVALID_GPU_ELAPSED_NS '+nanoseconds);
      return {gpuMs:Math.round(nanoseconds/1e4)/100, nanoseconds,waitPolls:iterations,
        disjoint:false,webglVersion:webgl2?2:1};
    }finally{
      if(started&&!ended){try{if(webgl2)gl.endQuery(target);else ext.endQueryEXT(target)}catch{}}
      if(webgl2)gl.deleteQuery(query);else ext.deleteQueryEXT(query);
    }
  }
  window.__gpuTimer={details,repaint,timeFrame};
})();