import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILTINS,validateBlueprint} from '../src/blueprint.mjs';
import {CONTROL_CATALOG,CONTROL_GROUPS,defaultNode,isContainer} from '../src/catalog.mjs';
import {SCREEN_TEMPLATES,getTemplate,initialDefinitions,sampleData} from '../src/templates.mjs';

test('basic GUI catalog has controls for layout, inputs, display and data',()=>{
  assert.ok(BUILTINS.length>=20);
  assert.deepEqual(BUILTINS,Object.keys(CONTROL_CATALOG));
  for(const group of CONTROL_GROUPS)
    assert.ok(Object.values(CONTROL_CATALOG).some(spec=>spec.group===group));
  for(const name of ['TextField','PasswordField','TextArea','NumberField','SelectField','DateField',
    'CheckBox','RadioGroup','Switch','Table','Button','Grid','Tabs','Panel','Statistic','Alert'])
    assert.ok(BUILTINS.includes(name),name);
});

test('every toolbox item has usable default properties and valid blueprint contract',()=>{
  const nodes=BUILTINS.map((name,index)=>defaultNode(name,'n'+index));
  assert.deepEqual(nodes.map(n=>n.type),BUILTINS);
  assert.equal(validateBlueprint({type:'Column',children:nodes},initialDefinitions).valid,true);
  assert.ok(isContainer('Grid')&&isContainer('Panel'));
  assert.ok(!isContainer('TextField'));
  assert.throws(()=>defaultNode('MadeUpControl','other'),/Unknown basic control/);
});

test('complete example templates are valid and independent',()=>{
  const names=Object.keys(SCREEN_TEMPLATES);
  for(const name of ['workspace','form','dashboard','blank'])assert.ok(names.includes(name));
  for(const name of names){
    const copy=getTemplate(name);
    const check=validateBlueprint(copy,initialDefinitions);
    assert.equal(check.valid,true,name+': '+check.errors.join('; '));
    assert.ok(copy.root.children.length>=2);
  }
  const a=getTemplate('workspace'),b=getTemplate('workspace');
  a.root.children[0].props.text='changed';
  assert.notEqual(a.root.children[0].props.text,b.root.children[0].props.text);
});

test('real sample records support both managed users and contact form',()=>{
  assert.ok(sampleData.users.length>=5);
  assert.equal(typeof sampleData.shipping.name,'string');
  assert.equal(typeof sampleData.billing.name,'string');
  assert.equal(typeof sampleData.contact.createdAt,'string');
  assert.equal(typeof sampleData.contact.enabled,'boolean');
});
