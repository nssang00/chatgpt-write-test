import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd(),mode=process.argv[3]||'both';
if(!['vertex','fragment','both'].includes(mode))throw Error('Expected vertex|fragment|both');
const file=join(root,'our-renderer/shaders/lineShaders.js');
let s=await readFile(file,'utf8');
function once(needle,replacement,label){if(s.split(needle).length!==2)throw Error('OL shader math anchor not unique: '+label);s=s.replace(needle,replacement)}
if(mode==='vertex'||mode==='both'){
 once([
'  float normalDir  = a_quadCorner.y < 0.0 ?  1.0 : -1.0;',
'  float tangentDir = a_quadCorner.x < 0.0 ?  1.0 : -1.0;',
'  float angle = a_quadCorner.x < 0.0 ? v_angleStart : v_angleEnd;',
'  vec2 joinDirection;  ',
'  vec2  positionPx = a_quadCorner.x < 0.0 ? segmentStartPx : segmentEndPx;',
'',
'  float cosAngle = a_quadCorner.x < 0.0 ? cosAngleStart : cosAngleEnd;'
].join('\n'),[
'  float startEndRatio = a_quadCorner.x * 0.5 + 0.5;',
'  float normalDir = -1.0 * a_quadCorner.y;',
'  float tangentDir = -1.0 * a_quadCorner.x;',
'  float angle = mix(v_angleStart, v_angleEnd, startEndRatio);',
'  vec2 joinDirection;',
'  vec2 positionPx = mix(segmentStartPx, segmentEndPx, startEndRatio);',
'  float cosAngle = cos(angle);'
].join('\n'),'vertex startEndRatio');
}
if(mode==='fragment'||mode==='both'){
 once([
'  float segmentLength = v_segmentLength;',
'  vec2 segmentTangent = v_segmentTangent;',
'',
'  float currentLengthPx = max(0., min(dot(segmentTangent, currentPoint - v_segmentStart), segmentLength)) + v_distanceOffsetPx;'
].join('\n'),[
'  float segmentLength = length(v_segmentEnd-v_segmentStart);',
'  segmentLength = max(segmentLength, 1.17549429e-38);',
'  vec2 segmentTangent = (v_segmentEnd-v_segmentStart) / segmentLength;',
'  vec2 startToPointPx = currentPoint-v_segmentStart;',
'  float currentLengthPx = max(0., min(dot(segmentTangent, startToPointPx), segmentLength)) + v_distanceOffsetPx;'
].join('\n'),'fragment normalization');
}
await writeFile(file,s);
console.log('ROUND19_OL_SHADER_MATH_READY',mode);
