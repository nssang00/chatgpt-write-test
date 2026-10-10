import test from 'node:test';
import assert from 'node:assert/strict';
import {expandBlueprint,readPath,writePath,parseBlueprint,validateBlueprint} from '../src/blueprint.mjs';
import {initialBlueprint,initialDefinitions,sampleData} from '../src/examples.mjs';
test('regression: composite instance data stays isolated',()=>{
  const tree=expandBlueprint(initialBlueprint,initialDefinitions);
  const a=tree.children[1].children[0],b=tree.children[1].children[1];
  assert.equal(a.instanceType,'AddressEditor');
  assert.equal(b.instanceType,'AddressEditor');
  assert.notEqual(a.scope,b.scope);
  let data=structuredClone(sampleData);
  data=writePath(data,a.scope+'.name','A');
  data=writePath(data,b.scope+'.name','B');
  assert.equal(readPath(data,'shipping.name'),'A');
  assert.equal(readPath(data,'billing.name'),'B');
});
test('regression: JSON round trip preserves UI tree and bindings',()=>{
  const doc=parseBlueprint(JSON.stringify(initialBlueprint),initialDefinitions);
  assert.deepEqual(expandBlueprint(doc,initialDefinitions),expandBlueprint(initialBlueprint,initialDefinitions));
});
test('regression: unsafe actions and missing components fail closed',()=>{
  assert.equal(validateBlueprint({type:'Button',on:{click:'constructor'}}).valid,false);
  assert.equal(validateBlueprint({type:'Missing'}).valid,false);
});
