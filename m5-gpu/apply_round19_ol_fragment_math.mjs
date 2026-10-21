import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd(),mode=process.argv[3]||'fragment';
if(!['fragment','fragment-vertex'].includes(mode))throw Error('Expected fragment / fragment-vertex');
const path=join(root,'our-renderer/shaders/lineShaders.js');
let src=await readFile(path,'utf8');
function change(from,to,label){if(src.split(from).length!==2)throw Error('OL Shader mismatch anchor '+label);src=src.replace(from,to);}
change(
'  float segmentLength = v_segmentLength;\n  vec2 segmentTangent = v_segmentTangent;\n\n  float currentLengthPx = max(0., min(dot(segmentTangent, currentPoint - v_segmentStart), segmentLength)) + v_distanceOffsetPx;',
'  float segmentLength = length(v_segmentEnd - v_segmentStart);\n  segmentLength = max(segmentLength, 1.17549429e-38);\n  vec2 segmentTangent = (v_segmentEnd - v_segmentStart) / segmentLength;\n  vec2 segmentNormal = vec2(-segmentTangent.y, segmentTangent.x);\n  vec2 startToPointPx = currentPoint - v_segmentStart;\n  float lengthToPointPx = max(0., min(dot(segmentTangent, startToPointPx), segmentLength));\n  float currentLengthPx = lengthToPointPx + v_distanceOffsetPx;',
'fragment OL tangent computation');
if(mode==='fragment-vertex'){
 change('  float cosAngle = a_quadCorner.x < 0.0 ? cosAngleStart : cosAngleEnd;',
 '  float cosAngle = cos(angle);','vertex cosine');
 change('  vec2  positionPx = a_quadCorner.x < 0.0 ? segmentStartPx : segmentEndPx;',
 '  float startEndRatio = a_quadCorner.x * 0.5 + 0.5;\n  vec2  positionPx = mix(segmentStartPx, segmentEndPx, startEndRatio);',
 'vertex OL mix');
 change('  float normalDir  = a_quadCorner.y < 0.0 ?  1.0 : -1.0;\n  float tangentDir = a_quadCorner.x < 0.0 ?  1.0 : -1.0;\n  float angle = a_quadCorner.x < 0.0 ? v_angleStart : v_angleEnd;',
 '  float normalDir  = -1.0 * a_quadCorner.y;\n  float tangentDir = -1.0 * a_quadCorner.x;\n  float angle = mix(v_angleStart, v_angleEnd, a_quadCorner.x * 0.5 + 0.5);',
 'vertex OL ratio');
}
await writeFile(path,src);
console.log('R19_OL_FRAGMENT_PRECISION',mode);
