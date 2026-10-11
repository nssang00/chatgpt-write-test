/** Dependency-free, data-only UI composition engine. React is an adapter. */
import { BUILTIN_NAMES } from './catalog.mjs';
export const BUILTINS = BUILTIN_NAMES;
const FORBIDDEN = new Set(['__proto__','prototype','constructor']);
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
export function pathSegments(path) {
  if (path === '') return [];
  if (typeof path !== 'string' || path.length > 256) throw new Error('Invalid binding path');
  const parts = path.split('.');
  if (parts.some(p => !IDENTIFIER.test(p) || FORBIDDEN.has(p))) throw new Error('Unsafe binding path: '+path);
  return parts;
}
export function scopedPath(scope = '', local = '') {
  return [...pathSegments(scope), ...pathSegments(local)].join('.');
}
export function readPath(model,path='') {
  return pathSegments(path).reduce((item,key)=> item==null ? undefined :
    Object.prototype.hasOwnProperty.call(Object(item),key) ? item[key] : undefined,model);
}
export function writePath(model,path,value) {
  const segments=pathSegments(path);
  if (!segments.length) return value;
  const copy=Array.isArray(model) ? [...model] : {...(model??{})};
  let source=model,target=copy;
  for(let i=0;i<segments.length-1;i++) {
    const key=segments[i]; source=source?.[key];
    const next=Array.isArray(source) ? [...source] : {...(source??{})};
    target[key]=next;target=next;
  }
  target[segments.at(-1)]=value;
  return copy;
}
export function validName(name) {return typeof name==='string'&&NAME.test(name)&&!FORBIDDEN.has(name);}
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validateBlueprint(input,definitions={}, {maxNodes=300,maxDepth=32}={}) {
  const errors=[];let count=0;
  const root=input?.root??input;
  const visit=(node,depth,ancestry)=>{
    count++;
    if(count>maxNodes){errors.push('Node limit exceeded');return;}
    if(depth>maxDepth){errors.push('Depth limit exceeded');return;}
    if(!isRecord(node)||!validName(node.type)){errors.push('Invalid component type');return;}
    if(node.id!==undefined&&!validName(node.id))errors.push('Invalid node id for '+node.type);
    if(node.scope!==undefined){try{pathSegments(node.scope);}catch(e){errors.push(e.message);}}
    if(node.bind!==undefined){
      if(!isRecord(node.bind))errors.push('Invalid binding for '+node.type);
      else Object.entries(node.bind).forEach(([port,path])=>{
        if(!validName(port))errors.push('Invalid binding port: '+port);
        try{pathSegments(path);}catch(e){errors.push(e.message);}
      });
    }
    if(node.on!==undefined) {
      if(!isRecord(node.on))errors.push('Invalid events on '+node.type);
      else Object.entries(node.on).forEach(([evt,action])=>{
        if(!validName(evt)||!validName(action))errors.push('Invalid action mapping on '+node.type);
      });
    }
    if(node.props!==undefined&&(!isRecord(node.props)||Object.keys(node.props).some(k=>FORBIDDEN.has(k))))
      errors.push('Invalid props on '+node.type);
    if(node.children!==undefined&&!Array.isArray(node.children))errors.push('Invalid children on '+node.type);
    if(!BUILTINS.includes(node.type)) {
      const def=definitions[node.type];
      if(!def){errors.push('Unknown component: '+node.type);return;}
      if(ancestry.includes(node.type)){errors.push('Recursive component: '+[...ancestry,node.type].join(' > '));return;}
      if(!isRecord(def)){errors.push('Invalid component definition: '+node.type);return;}
      if(def.kind==='react'){
        if(!isRecord(def.manifest))errors.push('Missing React component manifest: '+node.type);
        else{
          for(const p of Object.keys(node.props??{}))
            if(!Object.hasOwn(def.manifest.props??{},p))errors.push('Unknown React prop: '+node.type+'.'+p);
          for(const p of Object.keys(node.bind??{}))
            if(!Object.hasOwn(def.manifest.bindings??{},p))errors.push('Unknown React binding: '+node.type+'.'+p);
          for(const e of Object.keys(node.on??{}))
            if(!Object.hasOwn(def.manifest.events??{},e))errors.push('Unknown React event: '+node.type+'.'+e);
        }
      }else{
        if(!isRecord(def.root)){errors.push('Invalid component definition: '+node.type);return;}
        if(def.manifest){
          for(const section of ['props','bindings','events']){
            const exposed=def.manifest[section]??{};
            if(!isRecord(exposed)){errors.push('Invalid exposed '+section+' on '+node.type);continue;}
            const values=section==='bindings'?node.bind:section==='events'?node.on:node.props;
            for(const port of Object.keys(values??{}))
              if(!Object.hasOwn(exposed,port))errors.push('Unknown composite '+section+' port: '+node.type+'.'+port);
          }
        }
        visit(def.root,depth+1,[...ancestry,node.type]);
      }
    }
    if(Array.isArray(node.children))for(const child of node.children)visit(child,depth+1,ancestry);
  };
  if(!isRecord(definitions))errors.push('Invalid definitions');else visit(root,0,[]);
  return {valid:errors.length===0,errors,nodeCount:count};
}
/** Resolve reusable compositions into a stable, instance-scoped runtime tree.
 * editableId always points to a node actually owned by the authoring screen.
 */
export function expandBlueprint(input,definitions={},parentScope=''){
  const check=validateBlueprint(input,definitions);
  if(!check.valid)throw new Error(check.errors.join('; '));
  const build=(node,scope,parentPath='',owner=null)=>{
    const ownScope=scopedPath(scope,node.scope??'');
    const path=parentPath+'/'+(node.id??node.type);
    const component=definitions[node.type];
    if(component&&component.kind!=='react'){
      const root=structuredClone(component.root);
      const manifest=component.manifest;
      if(manifest){
        const byId=new Map();
        const index=n=>{if(n.id)byId.set(n.id,n);(n.children??[]).forEach(index);};
        index(root);
        const apply=(kind,values)=>{
          for(const [port,value] of Object.entries(values??{})){
            const spec=manifest[kind]?.[port];
            if(!spec)throw new Error('Unexposed composite '+kind+' port: '+port);
            const target=byId.get(spec.target);
            if(!target)throw new Error('Missing composite target: '+spec.target);
            const key=kind==='props'?'prop':kind==='bindings'?'port':'event';
            if(!validName(spec[key]))throw new Error('Invalid composite port: '+port);
            const targetSection=kind==='bindings'?'bind':kind==='events'?'on':'props';
            target[targetSection]??={};
            target[targetSection][spec[key]]=value;
          }
        };
        apply('props',node.props);
        apply('bindings',node.bind);
        apply('events',node.on);
      }
      const expanded=build(root,ownScope,path,owner??node.id??null);
      return {...expanded,id:node.id??expanded.id,instanceType:node.type,
        instancePath:path,editableId:owner??node.id??expanded.editableId,
        scope:expanded.scope,
        // Legacy definitions had no explicit external contract.
        props:manifest?expanded.props:{...expanded.props,...node.props}};
    }
    return {
      id:node.id,type:node.type,props:node.props??{},bind:node.bind??{},
      on:node.on??{},scope:ownScope,instancePath:path,editableId:owner??node.id,
      children:(node.children??[]).map(child=>build(child,ownScope,path,owner))
    };
  };
  return build(input?.root??input,parentScope);
}
export function publishComponent(name,root,definitions={}){
  if(!validName(name)||BUILTINS.includes(name))throw new Error('Invalid or reserved component name');
  if(Object.hasOwn(definitions,name))throw new Error('Component already exists');
  const next={...definitions,[name]:{root}};
  const check=validateBlueprint({root:{type:name}},next);
  if(!check.valid)throw new Error(check.errors.join('; '));
  return next;
}
export function parseBlueprint(json,definitions={}){
  let doc;try{doc=JSON.parse(json);}catch{throw new Error('Invalid JSON');}
  const check=validateBlueprint(doc,definitions);
  if(!check.valid)throw new Error(check.errors.join('; '));
  return doc;
}
