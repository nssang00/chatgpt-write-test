import test from 'node:test';
import assert from 'node:assert/strict';
import {pathSegments,scopedPath,readPath,writePath,validateBlueprint,publishComponent,expandBlueprint,parseBlueprint} from '../src/blueprint.mjs';
import {initialBlueprint,initialDefinitions,sampleData} from '../src/examples.mjs';
test('path updates do not mutate source',()=>{
  const next=writePath(sampleData,'shipping.city','대전');
  assert.equal(readPath(next,'shipping.city'),'대전');
  assert.equal(readPath(sampleData,'shipping.city'),'서울');
  assert.strictEqual(next.billing,sampleData.billing);
});
test('scoped composite instances use separate state',()=>{
  const tree=expandBlueprint(initialBlueprint,initialDefinitions);
  const [a,b]=tree.children[1].children;
  assert.equal(scopedPath(a.scope,a.children[0].bind.value),'shipping.name');
  assert.equal(scopedPath(b.scope,b.children[0].bind.value),'billing.name');
  const next=writePath(sampleData,'shipping.name','테스트');
  assert.equal(readPath(next,'billing.name'),'이서연');
});
test('publishing registers a reusable blueprint without mutating original',()=>{
  const r=publishComponent('Greeting',{type:'Text',props:{text:'Hi'}},initialDefinitions);
  assert.ok(r.Greeting);
  assert.ok(!initialDefinitions.Greeting);
  assert.equal(expandBlueprint({type:'Greeting'},r).type,'Text');
});
test('unsafe paths are rejected',()=>{
  for(const s of ['__proto__.polluted','constructor.prototype','a..b','a[0]','x;evil'])assert.throws(()=>pathSegments(s));
  assert.deepEqual(pathSegments('a.b'),['a','b']);
});
test('unknown components and bad JSON produce clear errors',()=>{
  assert.deepEqual(validateBlueprint({type:'DoesNotExist'}).errors,['Unknown component: DoesNotExist']);
  assert.match(validateBlueprint({type:'TextField',bind:{value:'__proto__.x'}}).errors.join(','),/Unsafe/);
  assert.throws(()=>parseBlueprint('{broken'),/Invalid JSON/);
});
test('recursive components and excessive node count are rejected',()=>{
  assert.match(validateBlueprint({type:'Loop'},{Loop:{root:{type:'Loop'}}}).errors.join(','),/Recursive/);
  const root={type:'Column',children:Array.from({length:10},()=>({type:'Text'}))};
  assert.match(validateBlueprint(root,{}, {maxNodes:5}).errors.join(','),/limit/i);
});
