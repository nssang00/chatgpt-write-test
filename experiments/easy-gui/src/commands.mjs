import {BUILTINS,validName,validateBlueprint} from './blueprint.mjs';
import {isContainer} from './catalog.mjs';

const clone=value=>structuredClone(value);
export function visitNodes(root,visit){
  visit(root);
  for(const child of root.children??[])visitNodes(child,visit);
}
export function findNode(doc,id){
  let found=null;
  visitNodes(doc.root,n=>{if(n.id===id)found=n;});
  return found;
}
export function updateNode(doc,id,edit){
  const next=clone(doc);
  const target=findNode(next,id);
  if(!target)throw new Error('Unknown node: '+id);
  edit(target);
  return next;
}
export function appendNode(doc,parentId,node,definitions={}){
  const next=clone(doc);
  const parent=findNode(next,parentId);
  if(!parent)throw new Error('Unknown parent node: '+parentId);
  if(!isContainer(parent.type)&&!(definitions[parent.type]?.manifest?.slots?.children))
    throw new Error('Target does not accept children: '+parent.type);
  if(!validName(node.id))throw new Error('Invalid node ID');
  if(findNode(next,node.id))throw new Error('Duplicate node ID: '+node.id);
  parent.children??=[];
  parent.children.push(clone(node));
  return next;
}
export function duplicateNode(doc,id,newId){
  const next=clone(doc);
  if(next.root.id===id)throw new Error('Cannot duplicate the root');
  const cloneId=typeof newId==='function'?newId:()=>('n'+Math.random().toString(36).slice(2,9));
  let created=null;
  const walk=parent=>{
    const i=parent.children?.findIndex(n=>n.id===id)??-1;
    if(i>=0){
      created=clone(parent.children[i]);
      visitNodes(created,n=>{n.id=cloneId();});
      parent.children.splice(i+1,0,created);
      return true;
    }
    return (parent.children??[]).some(walk);
  };
  if(!walk(next.root))throw new Error('Unknown node: '+id);
  return {doc:next,id:created.id};
}
export function removeNode(doc,id){
  const next=clone(doc);
  if(next.root.id===id)throw new Error('Cannot remove root');
  let removed=false;
  visitNodes(next.root,parent=>{
    const i=parent.children?.findIndex(n=>n.id===id)??-1;
    if(i>=0){parent.children.splice(i,1);removed=true;}
  });
  if(!removed)throw new Error('Unknown node: '+id);
  return next;
}
/** Atomic subtree relocation; prevents cycles and non-container drops. */
export function moveNode(doc,sourceId,targetId,definitions={}){
  if(sourceId===targetId||doc.root.id===sourceId)throw new Error('Cannot move node there');
  const next=clone(doc),source=findNode(next,sourceId),target=findNode(next,targetId);
  if(!source||!target)throw new Error('Unknown source or target');
  if(!isContainer(target.type)&&!definitions[target.type]?.manifest?.slots?.children)
    throw new Error('Target does not accept children');
  let inside=false;visitNodes(source,n=>{if(n.id===targetId)inside=true;});
  if(inside)throw new Error('Cannot move into a descendant');
  const moved=clone(source);
  const without=removeNode(next,sourceId);
  const inserted=appendNode(without,targetId,moved,definitions);
  const check=validateBlueprint(inserted,definitions);
  if(!check.valid)throw new Error(check.errors.join('; '));
  return inserted;
}
const typeOf=value=>typeof value==='boolean'?'boolean':
  typeof value==='number'?'number':'string';
/** Extract a selected subtree, infer simple external ports, replace it with a reusable instance. */
export function extractComponent(doc,selectedId,name,definitions={}){
  if(!validName(name)||BUILTINS.includes(name)||Object.hasOwn(definitions,name))
    throw new Error('Invalid or existing component name');
  const selected=findNode(doc,selectedId);
  if(!selected||selectedId===doc.root.id)throw new Error('Select a non-root component first');
  const source=clone(selected);
  delete source.scope;
  const props={}, bindings={},events={}, instance={type:name,id:selectedId};
  if(selected.scope)instance.scope=selected.scope;
  for(const [key,value] of Object.entries(source.props??{})){
    if(!validName(key))continue;
    props[key]={type:typeOf(value),default:value,target:source.id,prop:key};
  }
  visitNodes(source,n=>{
    for(const [port,path] of Object.entries(n.bind??{})){
      const publicName=n.id+'_'+port;
      if(validName(publicName)){
        bindings[publicName]={target:n.id,port};
        instance.bind??={};instance.bind[publicName]=path;
      }
    }
    for(const [event,action] of Object.entries(n.on??{})){
      const publicName=n.id+'_'+event;
      if(validName(publicName)){
        events[publicName]={target:n.id,event};
        instance.on??={};instance.on[publicName]=action;
      }
    }
  });
  // Prop values are already on the definition root; the instance keeps overrides empty.
  const manifest={props,bindings,events,slots:{},designer:{
    label:name,category:'내 컴포넌트',container:false
  }};
  const registered={...definitions,[name]:{root:source,manifest}};
  const next=updateNode(doc,selectedId,node=>{
    for(const key of Object.keys(node))delete node[key];
    Object.assign(node,instance);
  });
  const check=validateBlueprint(next,registered);
  if(!check.valid)throw new Error(check.errors.join('; '));
  return {doc:next,definitions:registered,component:registered[name],instance};
}
