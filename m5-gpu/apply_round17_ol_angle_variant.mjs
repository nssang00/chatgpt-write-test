import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const base=process.argv[2]||process.cwd();
const path=join(base,'our-renderer','shaders','lineShaders.js');
let text=await readFile(path,'utf8');
const from=\`float gpuAngleBetween(vec2 p0, vec2 pA, vec2 pB) {
  vec2 a=pA-p0;
  vec2 b=pB-p0;
  if(dot(a,a)==0.0 || dot(b,b)==0.0)return 0.0;
  float theta=atan(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y);
  return theta <= 0.0 ? theta + 6.283185307179586 : theta;
}\`;
const to=\`float gpuAngleBetween(vec2 p0, vec2 pA, vec2 pB) {
  // Match OL coordinate.angleBetween() including its zero-angle guard.
  vec2 a=pA-p0;
  vec2 b=pB-p0;
  float lenA=length(a);
  float lenB=length(b);
  if(lenA==0.0 || lenB==0.0)return 6.283185307179586 - 0.00001;
  vec2 tangentA=a/lenA;
  vec2 tangentB=b/lenB;
  float theta=max(acos(clamp(dot(tangentB,tangentA),-1.0,1.0)),0.00001);
  float clockwise=dot(tangentB,vec2(-tangentA.y,tangentA.x));
  return clockwise>0.0 ? theta : 6.283185307179586-theta;
}\`;
const oldEnd='6.283185307179586 - gpuAngleBetween(a_segmentEnd,a_nextPoint,a_segmentStart);';
const newEnd='gpuAngleBetween(a_segmentEnd,a_segmentStart,a_nextPoint);';
if(!text.includes(from)||!text.includes(oldEnd))throw Error('Original M5 GPU-angle code not found');
text=text.replace(from,to).replace(oldEnd,newEnd);
await writeFile(path,text);
console.log('ROUND17_OL_ANGLE_VARIANT_READY');