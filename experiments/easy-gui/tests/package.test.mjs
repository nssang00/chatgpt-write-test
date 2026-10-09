import test from 'node:test';
import assert from 'node:assert/strict';
import {defineReactComponent,validateManifest,createComponentBundle,
  validateComponentBundle,installComponentBundle,COMPONENT_FORMAT} from '../src/component-kit.mjs';
import {validateBlueprint,expandBlueprint} from '../src/blueprint.mjs';
import {initialDefinitions} from '../src/examples.mjs';

const meta={props:{label:{type:'string',default:'상태'},
  tone:{type:'enum',options:['blue','red'],default:'blue'}},bindings:{active:{prop:'active'}}};

test('unit: ordinary React component opts into designer via manifest',()=>{
  const entry=defineReactComponent('StatusBadge',()=>null,meta);
  assert.equal(entry.definition.kind,'react');
  assert.equal(validateBlueprint({type:'StatusBadge'},{StatusBadge:entry.definition}).valid,true);
  assert.equal(expandBlueprint({type:'StatusBadge',bind:{active:'shipping.enabled'}},
    {StatusBadge:entry.definition}).type,'StatusBadge');
});
test('unit: invalid component metadata fails early',()=>{
  assert.deepEqual(validateManifest({props:{color:{type:'invalid'}}}),['Invalid prop descriptor: color']);
  assert.throws(()=>defineReactComponent('Column',()=>null,meta),/Invalid React component name/);
  assert.throws(()=>defineReactComponent('Badge',()=>null,
    {bindings:{active:{prop:'__proto__'}}}),/Invalid binding descriptor/);
});
test('unit: exported package includes transitively required blocks',()=>{
  const b=createComponentBundle('UserPanel',{type:'AddressEditor',scope:'shipping'},initialDefinitions);
  assert.equal(b.format,COMPONENT_FORMAT);
  assert.deepEqual(b.requires.react,[]);
  assert.ok(b.definitions.AddressEditor);
  assert.equal(validateComponentBundle(JSON.parse(JSON.stringify(b))),true);
});
test('unit: reinstallation idempotent and conflicting names rejected',()=>{
  const b=createComponentBundle('UserPanel',{type:'AddressEditor'},initialDefinitions);
  const installed=installComponentBundle({},b);
  assert.ok(installed.UserPanel&&installed.AddressEditor);
  assert.equal(installComponentBundle(installed,b).UserPanel.root.type,'AddressEditor');
  assert.throws(()=>installComponentBundle({UserPanel:{root:{type:'Text'}}},b),/conflict/);
  assert.equal(expandBlueprint({type:'UserPanel',scope:'billing'},installed).type,'Panel');
});
test('unit: package declares trusted React code dependency without executing code',()=>{
  const definitions={Badge:defineReactComponent('Badge',()=>null,meta).definition};
  const b=createComponentBundle('BadgePanel',{type:'Badge',bind:{active:'enabled'}},definitions);
  assert.deepEqual(b.requires.react,['Badge']);
  assert.equal(typeof b.definitions.Badge,'object');
  assert.equal(validateComponentBundle(JSON.parse(JSON.stringify(b))),true);
});
test('security regression: malformed packages and recursive references fail closed',()=>{
  const b=createComponentBundle('PanelX',{type:'Text'},initialDefinitions);
  assert.throws(()=>validateComponentBundle({...b,format:'arbitrary-js'}),/Unsupported/);
  assert.throws(()=>validateComponentBundle({...b,requires:{react:['Fake']}}),/mismatch/);
  assert.throws(()=>validateComponentBundle({...b,root:{type:'Missing'}}),/Unknown component/);
  assert.throws(()=>validateComponentBundle({...b,root:{type:'PanelX'}}),/Recursive/);
  assert.throws(()=>validateComponentBundle({...b,root:JSON.parse('{"type":"Text","props":{"__proto__":"x"}}')}),/Unsafe/);
  assert.throws(()=>createComponentBundle('X',{type:'Missing'},{}),/Missing component/);
});
test('regression: nested composites keep independent data scopes',()=>{
  const b=createComponentBundle('ShippingPanel',{type:'Column',children:[
    {type:'AddressEditor',scope:'shipping'}
  ]},initialDefinitions);
  const installed=installComponentBundle({},b);
  const tree=expandBlueprint({type:'Column',children:[
    {type:'ShippingPanel',scope:'customerA'},
    {type:'ShippingPanel',scope:'customerB'}
  ]},installed);
  assert.equal(tree.children[0].children[0].scope,'customerA.shipping');
  assert.equal(tree.children[1].children[0].scope,'customerB.shipping');
});
