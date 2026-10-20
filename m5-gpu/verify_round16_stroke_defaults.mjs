import assert from 'node:assert/strict';
import {toNeutralStyles,toRendererStyle} from '../our-renderer/adapters/openlayers/OlStyleAdapter.js';
const get=s=>toNeutralStyles(s)[0].stroke;
let x=get({'stroke-color':'#123456','stroke-width':3});
assert.equal(x.lineCap,'round');assert.equal(x.lineJoin,'round');assert.equal(x.capCode,0);assert.equal(x.joinCode,0);
assert.equal(toRendererStyle({stroke:x},'line').strokeCap,0);
x=get({'stroke-color':'#123456','stroke-line-cap':'butt','stroke-line-join':'miter'});
assert.equal(x.capCode,4);assert.equal(x.joinCode,7);
console.log('ROUND16_STROKE_DEFAULTS_PASS');