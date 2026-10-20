import assert from 'node:assert/strict';
import {WebGL1Backend} from '../our-renderer/backend/WebGL1Backend.js';
const make=()=>{const calls=[];return {calls,getContext(type,opts){assert.equal(type,'webgl');calls.push(opts);return{getExtension(key){return key==='ANGLE_instanced_arrays'?{}:null}}}}};
for(const [options,expected] of [[{},undefined],[{contextAntialias:false},{antialias:false}],[{contextAntialias:true},{antialias:true}]]){
 const canvas=make(),backend=new WebGL1Backend(canvas,options);backend.restoreContext();assert.deepEqual(canvas.calls,[expected,expected]);
}
console.log('ROUND16_CONTEXT_OPTIN_PASS');