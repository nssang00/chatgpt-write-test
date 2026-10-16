import test from 'node:test';
import assert from 'node:assert/strict';
import {createManifestRegistry,getComponentManifest} from '../src/manifest.mjs';
import {CONTROL_CATALOG} from '../src/catalog.mjs';
import {defineReactComponent,createComponentBundle,installComponentBundle} from '../src/component-kit.mjs';
import {expandBlueprint,validateBlueprint} from '../src/blueprint.mjs';
import {initialBlueprint,initialDefinitions} from '../src/examples.mjs';
import {findNode,updateNode,appendNode,duplicateNode,removeNode,moveNode,extractComponent} from '../src/commands.mjs';

const sample={schemaVersion:1,root:{type:'Column',id:'root',children:[
 {type:'Panel',id:'editor',props:{title:'고객 정보'},children:[
   {type:'TextField',id:'field',props:{label:'이름'},bind:{value:'name'}},
   {type:'Button',id:'saveBtn',props:{label:'저장'},on:{click:'save'}}
 ]},
 {type:'Column',id:'target',children:[]}
]}};
test('unit: all built-in controls share a unified editor contract',()=>{
 const manifest=createManifestRegistry({});
 assert.equal(Object.keys(manifest).length,Object.keys(CONTROL_CATALOG).length);
 for(const name of Object.keys(CONTROL_CATALOG)){
   const m=getComponentManifest(name);
   assert.deepEqual(m.props,CONTROL_CATALOG[name].props);
   assert.ok(m.designer.label&&m.designer.category);
   assert.equal(Boolean(m.slots.children),Boolean(CONTROL_CATALOG[name].container));
 }
 assert.deepEqual(Object.keys(manifest.TextField.bindings),['value']);
 assert.deepEqual(Object.keys(manifest.Switch.bindings),['checked']);
 assert.deepEqual(Object.keys(manifest.Table.bindings),['data']);
 assert.deepEqual(Object.keys(manifest.Button.events),['click']);
});
test('unit: existing React components remain optional editor integrations',()=>{
 const c=defineReactComponent('Badge',()=>null,{props:{label:{type:'string'}},
   bindings:{active:{prop:'active'}}});
 assert.equal(getComponentManifest('Badge',{Badge:c.definition}).kind,'react');
 assert.deepEqual(Object.keys(getComponentManifest('Badge',{Badge:c.definition}).bindings),['active']);
 assert.equal(getComponentManifest('NotRegistered',{}),null);
});
test('regression: expanded composite child selection points to instance, not definition IDs',()=>{
 const tree=expandBlueprint(initialBlueprint,initialDefinitions);
 const first=tree.children[1].children[0],second=tree.children[1].children[1];
 assert.notEqual(first.instancePath,second.instancePath);
 assert.equal(first.editableId,first.id);
 assert.equal(second.editableId,second.id);
 assert.equal(first.children[0].editableId,first.id);
 assert.equal(second.children[0].editableId,second.id);
 assert.notEqual(first.children[0].instancePath,second.children[0].instancePath);
 assert.equal(first.scope,'shipping');
 assert.equal(second.scope,'billing');
});
test('unit: commands are immutable and reject illegal relocation',()=>{
 const add={type:'Text',id:'newText',props:{text:'new'}};
 const appended=appendNode(sample,'target',add);
 assert.equal(sample.root.children[1].children.length,0);
 assert.equal(findNode(appended,'newText').props.text,'new');
 assert.throws(()=>appendNode(sample,'field',add),/does not accept/);
 assert.throws(()=>appendNode(appended,'target',add),/Duplicate/);
 const changed=updateNode(sample,'field',node=>{node.props.label='새 이름';});
 assert.equal(findNode(sample,'field').props.label,'이름');
 assert.equal(findNode(changed,'field').props.label,'새 이름');
 const copy=duplicateNode(sample,'editor',(()=>{let i=0;return()=> 'dup'+(++i);})());
 assert.ok(findNode(copy.doc,copy.id));
 assert.notEqual(copy.doc.root.children[0].id,copy.doc.root.children[1].id);
 assert.throws(()=>moveNode(sample,'editor','field'),/does not accept/);
 assert.throws(()=>moveNode(sample,'editor','saveBtn'),/does not accept/);
 assert.throws(()=>moveNode(sample,'editor','editor'),/Cannot move/);
 assert.throws(()=>moveNode(sample,'root','target'),/Cannot move/);
 const moved=moveNode(sample,'field','target');
 assert.equal(findNode(moved,'target').children[0].id,'field');
 assert.equal(findNode(sample,'target').children.length,0);
 const removed=removeNode(sample,'saveBtn');
 assert.equal(findNode(removed,'saveBtn'),null);
 assert.throws(()=>removeNode(sample,'root'),/Cannot remove/);
});
test('regression: extracting subtree preserves bindings, actions and exposes ports',()=>{
 const result=extractComponent(sample,'editor','CustomerEditor',{});
 assert.equal(findNode(sample,'editor').type,'Panel');
 assert.equal(findNode(result.doc,'editor').type,'CustomerEditor');
 assert.equal(result.component.manifest.props.title.target,'editor');
 assert.deepEqual(result.component.manifest.bindings.field_value,{target:'field',port:'value'});
 assert.deepEqual(result.component.manifest.events.saveBtn_click,{target:'saveBtn',event:'click'});
 assert.equal(result.instance.bind.field_value,'name');
 assert.equal(result.instance.on.saveBtn_click,'save');
 assert.equal(validateBlueprint(result.doc,result.definitions).valid,true);
 const expanded=expandBlueprint(result.doc,result.definitions).children[0];
 assert.equal(expanded.type,'Panel');
 assert.equal(expanded.children[0].bind.value,'name');
 assert.equal(expanded.children[1].on.click,'save');
 const pkg=createComponentBundle('Portable',{type:'CustomerEditor'},result.definitions);
 assert.ok(pkg.definitions.CustomerEditor.manifest);
 const installed=installComponentBundle({},pkg);
 assert.equal(expandBlueprint({type:'Portable'},installed).type,'Panel');
});
test('regression: two extracted component instances have independent scope and stable owner',()=>{
 const extracted=extractComponent(sample,'editor','CustomerEditor',{});
 const doc={root:{type:'Row',id:'root',children:[
  {type:'CustomerEditor',id:'left',scope:'shipping',bind:{field_value:'name'},on:{saveBtn_click:'save'}},
  {type:'CustomerEditor',id:'right',scope:'billing',bind:{field_value:'name'},on:{saveBtn_click:'save'}}
 ]}};
 const result=expandBlueprint(doc,extracted.definitions);
 const [a,b]=result.children;
 assert.equal(a.children[0].scope,'shipping');
 assert.equal(b.children[0].scope,'billing');
 assert.equal(a.children[0].editableId,'left');
 assert.equal(b.children[0].editableId,'right');
 assert.equal(a.children[0].bind.value,'name');
 assert.notEqual(a.children[0].instancePath,b.children[0].instancePath);
});
test('security regression: undeclared external composite ports are rejected',()=>{
 const {definitions}=extractComponent(sample,'editor','CustomerEditor',{});
 const check=validateBlueprint({type:'CustomerEditor',props:{dangerouslySetInnerHTML:'x'}},definitions);
 assert.equal(check.valid,false);
 assert.match(check.errors.join(' '),/Unknown composite props port/);
 assert.throws(()=>extractComponent(sample,'root','Bad',{}),/non-root/);
 assert.throws(()=>extractComponent(sample,'editor','Column',{}),/Invalid or existing/);
});

test('regression: authoring node IDs must be unique, definition IDs may repeat per instance',()=>{
 const bad={root:{type:'Column',id:'root',children:[
   {type:'Text',id:'dup'},{type:'Button',id:'dup'}
 ]}};
 const result=validateBlueprint(bad,{});
 assert.equal(result.valid,false);
 assert.match(result.errors.join(' '),/Duplicate authoring node ID/);
 const okay=validateBlueprint(initialBlueprint,initialDefinitions);
 assert.equal(okay.valid,true);
});
test('regression: anonymous sibling nodes still receive distinct runtime paths',()=>{
 const result=expandBlueprint({type:'Row',id:'root',children:[
   {type:'Text',props:{text:'a'}},{type:'Text',props:{text:'b'}}
 ]},{});
 assert.notEqual(result.children[0].instancePath,result.children[1].instancePath);
});
test('regression: extracted public property overrides internal target without mutating definition',()=>{
 const extracted=extractComponent(sample,'editor','CustomerEditor',{});
 const edited=updateNode(extracted.doc,'editor',n=>{n.props={title:'변경된 제목'};});
 const panel=expandBlueprint(edited,extracted.definitions).children[0];
 assert.equal(panel.props.title,'변경된 제목');
 assert.equal(extracted.definitions.CustomerEditor.root.props.title,'고객 정보');
});
