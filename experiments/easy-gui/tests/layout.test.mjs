import test from 'node:test';
import assert from 'node:assert/strict';
import {placeNode,setGridSpan,getGridSpan,setNodeSizing,setFreePlacement,suggestDropSide} from '../src/layout.mjs';
import {validateBlueprint,expandBlueprint} from '../src/blueprint.mjs';
import {createComponentBundle,installComponentBundle} from '../src/component-kit.mjs';

const screen=()=>({schemaVersion:1,root:{type:'Column',id:'root',children:[
  {type:'Heading',id:'heading',props:{text:'Heading'}},
  {type:'Grid',id:'grid',props:{columns:3,gap:12},children:[
    {type:'Text',id:'first',props:{text:'first'}},
    {type:'Text',id:'second',props:{text:'second'}},
    {type:'Panel',id:'panel',props:{title:'Panel'},children:[]}
  ]},
  {type:'Button',id:'bottom',props:{label:'Save'}}
]}});
test('unit: insert before/after exact target without mutating source',()=>{
  const src=screen();
  const n={type:'Text',id:'new',props:{text:'added'}};
  const before=placeNode(src,{node:n,targetId:'bottom',side:'before'});
  const after=placeNode(src,{node:n,targetId:'bottom',side:'after'});
  assert.deepEqual(before.root.children.map(n=>n.id),['heading','grid','new','bottom']);
  assert.deepEqual(after.root.children.map(n=>n.id),['heading','grid','bottom','new']);
  assert.equal(src.root.children.length,3);
});
test('unit: add into a nested container and reject leaf drops',()=>{
  const added=placeNode(screen(),{node:{type:'Tag',id:'tag'},targetId:'panel',side:'inside'});
  assert.equal(added.root.children[1].children[2].children[0].id,'tag');
  assert.throws(()=>placeNode(screen(),{node:{type:'Tag',id:'tag'},targetId:'heading',side:'inside'}),/does not accept/);
});
test('regression: reorder within a parent and across parents preserves keys',()=>{
  const reordered=placeNode(screen(),{sourceId:'first',targetId:'second',side:'after'});
  assert.deepEqual(reordered.root.children[1].children.map(n=>n.id),['second','first','panel']);
  const moved=placeNode(reordered,{sourceId:'bottom',targetId:'panel',side:'inside'});
  assert.equal(moved.root.children[1].children[2].children[0].id,'bottom');
  assert.equal(moved.root.children.length,2);
});
test('security: root move, cycles, missing ID and invalid placement rejected',()=>{
  assert.throws(()=>placeNode(screen(),{sourceId:'root',targetId:'grid',side:'inside'}),/Cannot move root/);
  assert.throws(()=>placeNode(screen(),{sourceId:'grid',targetId:'panel',side:'inside'}),/descendant/);
  assert.throws(()=>placeNode(screen(),{sourceId:'first',targetId:'first',side:'before'}),/onto itself/);
  assert.throws(()=>placeNode(screen(),{sourceId:'unknown',targetId:'grid'}),/Unknown source/);
  assert.throws(()=>placeNode(screen(),{node:{type:'Text',id:'first'},targetId:'grid'}),/Duplicate/);
  assert.throws(()=>placeNode(screen(),{node:{type:'Text',id:'new'},targetId:'grid',side:'middle'}),/Unknown drop/);
});
test('unit: Grid span and responsive width metadata are immutable',()=>{
  const doc=setGridSpan(screen(),'first','desktop',2);
  assert.equal(getGridSpan(doc.root.children[1].children[0],'desktop',3),2);
  assert.equal(getGridSpan(doc.root.children[1].children[0],'mobile',3),1);
  assert.equal(getGridSpan(doc.root.children[1].children[0],'desktop',1),1);
  assert.equal(getGridSpan(screen().root.children[1].children[0],'desktop',3),1);
  const fixed=setNodeSizing(doc,'first','fixed',325);
  assert.deepEqual(fixed.root.children[1].children[0].sizing,{mode:'fixed',px:325});
  assert.equal(fixed.root.children[1].children[0].placement.desktop.span,2);
  assert.equal(validateBlueprint(fixed).valid,true);
});
test('security: invalid sizing and span fail Blueprint validation',()=>{
  const d=screen();
  d.root.children[0].sizing={mode:'fixed',px:-5};
  assert.match(validateBlueprint(d).errors.join(' '),/Invalid node sizing/);
  d.root.children[0].sizing={mode:'hug'};
  d.root.children[0].placement={desktop:{span:13}};
  assert.match(validateBlueprint(d).errors.join(' '),/Invalid grid span/);
  assert.throws(()=>setGridSpan(screen(),'heading','tablet',2),/Invalid grid span/);
  assert.throws(()=>setNodeSizing(screen(),'heading','absolute',200),/Unknown sizing/);
});
test('unit: drag pointer chooses appropriate zone deterministically',()=>{
  const rect={x:100,y:100,width:200,height:120};
  assert.equal(suggestDropSide(rect,200,115,{container:true}),'before');
  assert.equal(suggestDropSide(rect,200,205,{container:true}),'after');
  assert.equal(suggestDropSide(rect,200,150,{container:true}),'inside');
  assert.equal(suggestDropSide(rect,120,150,{direction:'horizontal'}),'before');
  assert.equal(suggestDropSide(rect,280,150,{direction:'horizontal'}),'after');
});
test('regression: bundle exports layout metadata and preserves on reinstall',()=>{
  const d=setGridSpan(screen(),'first','desktop',3);
  const fixed=setNodeSizing(d,'first','fixed',320);
  const pack=createComponentBundle('NewLayout',fixed.root,{});
  const installed=installComponentBundle({},JSON.parse(JSON.stringify(pack)));
  const result=expandBlueprint({type:'NewLayout',id:'instance'},installed);
  assert.equal(result.children[1].children[0].placement.desktop.span,3);
  assert.equal(result.children[1].children[0].sizing.px,320);
});

test('unit: FreeCanvas absolute coordinates are bounded and validated',()=>{
  const base=screen();
  base.root.children.push({type:'FreeCanvas',id:'free',props:{height:500},children:[
    {type:'Text',id:'floating',props:{text:'Floating'}}
  ]});
  const next=setFreePlacement(base,'floating',{x:120,y:74,width:230,height:80});
  assert.deepEqual(next.root.children[3].children[0].placement.free,{x:120,y:74,width:230,height:80});
  assert.equal(validateBlueprint(next).valid,true);
  assert.equal(base.root.children[3].children[0].placement,undefined);
  const clamped=setFreePlacement(next,'floating',{x:-100,y:3000,width:2,height:8});
  assert.deepEqual(clamped.root.children[3].children[0].placement.free,{x:0,y:2400,width:40,height:24});
  assert.equal(validateBlueprint(clamped).valid,true);
});
test('regression: FreeCanvas placements survive composite packaging and validation',()=>{
  const d={root:{type:'FreeCanvas',id:'free',props:{height:320},children:[
    {type:'Button',id:'button',props:{label:'Click'},placement:{free:{x:28,y:42,width:130,height:48}}}
  ]}};
  const pack=createComponentBundle('FloatingForm',d.root,{});
  const defs=installComponentBundle({},JSON.parse(JSON.stringify(pack)));
  const rt=expandBlueprint({type:'FloatingForm',id:'instance'},defs);
  assert.deepEqual(rt.children[0].placement.free,{x:28,y:42,width:130,height:48});
  d.root.children[0].placement.free.x=-1;
  assert.match(validateBlueprint(d).errors.join(' '),/Invalid free placement/);
});
