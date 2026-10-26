import {CONTROL_CATALOG} from './catalog.mjs';

/** Unified editor contract. Ordinary React JSX never needs this metadata. */
export function getComponentManifest(type,definitions={}){
  const builtin=CONTROL_CATALOG[type];
  if(builtin){
    return {
      name:type,kind:'builtin',props:builtin.props??{},
      bindings:builtin.bindingPorts??{},
      events:builtin.eventPorts??{},
      slots:builtin.container?{children:{accepts:['*']}}:{},
      designer:{label:builtin.label,category:builtin.group,icon:builtin.icon,
        container:Boolean(builtin.container)}
    };
  }
  const definition=definitions[type];
  if(!definition)return null;
  const metadata=definition.manifest??{};
  return {
    name:type,kind:definition.kind==='react'?'react':'composite',
    props:metadata.props??{},bindings:metadata.bindings??{},
    events:metadata.events??{},slots:metadata.slots??{},
    designer:{label:metadata.designer?.label??type,
      category:metadata.designer?.category??'내 컴포넌트',
      icon:metadata.designer?.icon??'block',
      container:Boolean(metadata.designer?.container)}
  };
}
export function createManifestRegistry(definitions={}){
  return Object.fromEntries([...Object.keys(CONTROL_CATALOG),...Object.keys(definitions)]
    .map(name=>[name,getComponentManifest(name,definitions)]));
}
