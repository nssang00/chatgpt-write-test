import {BUILTINS, validName, validateBlueprint} from './blueprint.mjs';

export const COMPONENT_FORMAT='easygui.component/v1';
const validVersion=v=>typeof v==='string'&&/^\d+\.\d+\.\d+$/.test(v);
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const propTypes=new Set(['string','number','boolean','enum']);
const forbidden=new Set(['__proto__','prototype','constructor']);

/** Metadata is opt-in for normal JSX but required for visual/JSON integration. */
export function validateManifest(manifest){
  const errors=[];
  if(!record(manifest))return ['Manifest must be an object'];
  for(const [key,spec] of Object.entries(manifest.props??{})){
    if(!validName(key)||!record(spec)||!propTypes.has(spec.type))errors.push('Invalid prop descriptor: '+key);
    if(spec?.type==='enum'&&(!Array.isArray(spec.options)||spec.options.some(x=>typeof x!=='string')))errors.push('Invalid enum options: '+key);
  }
  for(const [port,config] of Object.entries(manifest.bindings??{})){
    if(!validName(port)||!record(config)||!validName(config.prop)||config.change!==undefined&&!validName(config.change))
      errors.push('Invalid binding descriptor: '+port);
  }
  for(const [evt,callback] of Object.entries(manifest.events??{}))
    if(!validName(evt)||!validName(callback))errors.push('Invalid event descriptor: '+evt);
  return errors;
}
export function defineReactComponent(name, component, manifest={props:{}}){
  if(!validName(name)||BUILTINS.includes(name))throw new Error('Invalid React component name');
  if(typeof component!=='function'&&typeof component!=='object')throw new Error('React component must be a component value');
  const errors=validateManifest(manifest);
  if(errors.length)throw new Error(errors.join('; '));
  return {name,definition:{kind:'react',manifest},component};
}

/** Export transitive Blueprint definitions; React source code stays in npm/local imports. */
export function createComponentBundle(name, root, definitions={},version='1.0.0'){
  if(!validName(name)||BUILTINS.includes(name)||!validVersion(version))throw new Error('Invalid component name or version');
  if(Object.hasOwn(definitions,name))throw new Error('Component already exists: '+name);
  const used=Object.create(null);
  const required=new Set();
  const visiting=new Set();
  const visit=node=>{
    if(!record(node))return;
    const type=node.type;
    if(!BUILTINS.includes(type)){
      if(!Object.hasOwn(definitions,type))throw new Error('Missing component dependency: '+type);
      if(visiting.has(type))throw new Error('Recursive component dependency: '+type);
      if(!Object.hasOwn(used,type)){
        const def=definitions[type];
        used[type]=structuredClone(def);
        if(def?.kind==='react')required.add(type);
        else{
          visiting.add(type);
          visit(def.root);
          visiting.delete(type);
        }
      }
    }
    if(Array.isArray(node.children))node.children.forEach(visit);
  };
  visit(root);
  const bundle={format:COMPONENT_FORMAT,name,version,root:structuredClone(root),
    definitions:used,requires:{react:[...required].sort()}};
  validateComponentBundle(bundle);
  return bundle;
}
export function validateComponentBundle(bundle){
  if(!record(bundle)||bundle.format!==COMPONENT_FORMAT)throw new Error('Unsupported component package format');
  if(!validName(bundle.name)||BUILTINS.includes(bundle.name)||!validVersion(bundle.version))
    throw new Error('Invalid component package identity');
  if(!record(bundle.root)||!record(bundle.definitions)||Object.hasOwn(bundle.definitions,bundle.name))
    throw new Error('Invalid component package contents');
  const definitions={...bundle.definitions,[bundle.name]:{root:bundle.root}};
  for(const [type,def] of Object.entries(bundle.definitions)){
    if(!validName(type)||BUILTINS.includes(type))throw new Error('Invalid component dependency: '+type);
    if(!record(def))throw new Error('Invalid component definition: '+type);
    if(def.kind==='react'){
      const errors=validateManifest(def.manifest);
      if(errors.length)throw new Error(errors.join('; '));
    }
  }
  const check=validateBlueprint({root:{type:bundle.name}},definitions);
  if(!check.valid)throw new Error(check.errors.join('; '));
  const code=Object.entries(bundle.definitions).filter(([,def])=>def.kind==='react').map(([type])=>type).sort();
  if(!record(bundle.requires)||!Array.isArray(bundle.requires.react)||
    JSON.stringify(bundle.requires.react)!==JSON.stringify(code))
    throw new Error('React dependency manifest mismatch');
  // Reject crafted JSON own-property pollution even in unused metadata.
  const safe=(item,depth=0)=>{
    if(depth>40)throw new Error('Package nesting exceeds limit');
    if(record(item)||Array.isArray(item))for(const [k,v] of Object.entries(item)){
      if(forbidden.has(k))throw new Error('Unsafe package key: '+k);
      safe(v,depth+1);
    }
    else if(typeof item==='function')throw new Error('Executable contents are not allowed');
  };
  safe(bundle);
  if(JSON.stringify(bundle).length>256_000)throw new Error('Component package too large');
  return true;
}
/** Atomic merge: no overwrite of another component with same name. */
export function installComponentBundle(existing,bundle){
  validateComponentBundle(bundle);
  if(!record(existing))throw new Error('Invalid component registry');
  const incoming={...bundle.definitions,[bundle.name]:{root:bundle.root}};
  for(const [type,def] of Object.entries(incoming)){
    if(Object.hasOwn(existing,type)&&JSON.stringify(existing[type])!==JSON.stringify(def))
      throw new Error('Component version/name conflict: '+type);
  }
  return {...existing,...incoming};
}
