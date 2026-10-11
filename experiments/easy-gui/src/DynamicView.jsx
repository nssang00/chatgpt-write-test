import React from 'react';
import {Alert} from 'antd';
import {renderAntdControl} from './adapters/antd.jsx';
import {expandBlueprint,readPath,scopedPath,writePath} from './blueprint.mjs';

const bounded=(node,port)=>Boolean(node.bind?.[port]);

/** Real Ant Design controls; the Blueprint is declarative data, not executable JSX. */
export function DynamicView({
  blueprint, definitions={}, reactComponents={}, data, onDataChange,
  actions={}, onNodeSelect, selectedNode, renderBuiltin=renderAntdControl
}) {
  let tree;
  try{tree=expandBlueprint(blueprint,definitions);}
  catch(error){return <Alert showIcon type="error" message="Blueprint error" description={error.message}/>;}

  const render=node=>{
    const p=node.props??{};
    const key=node.instancePath??node.id??node.type+'-'+node.scope;
    const children=node.children?.map(render);
    const fieldPath=port=>scopedPath(node.scope,node.bind?.[port]??'');
    const value=port=>readPath(data,fieldPath(port));
    const change=(port,newValue)=>{
      if(!bounded(node,port)||!onDataChange)return;
      onDataChange(prev=>writePath(prev,fieldPath(port),newValue));
    };
    const act=(name,args=[])=>{
      const action=node.on?.[name];
      if(action&&typeof actions[action]==='function')
        actions[action]({data,scope:node.scope,args});
    };
    let element=renderBuiltin(node,{children,render,value,change,act,bounded});
    if(element===null){
      const External=reactComponents[node.type];
      if(!External)element=<Alert type="error" message={'React component not installed: '+node.type}/>;
      else{
        const manifest=definitions[node.type]?.manifest??{};
        const extProps={...p};
        for(const [port,path] of Object.entries(node.bind??{})){
          const spec=manifest.bindings?.[port];
          if(spec){
            extProps[spec.prop]=readPath(data,scopedPath(node.scope,path));
            if(spec.change)extProps[spec.change]=val=>change(port,val);
          }
        }
        for(const [event,actionName] of Object.entries(node.on??{})){
          const callback=manifest.events?.[event];
          if(callback&&typeof actions[actionName]==='function')
            extProps[callback]=(...args)=>actions[actionName]({data,scope:node.scope,args});
        }
        element=<External {...extProps}>{children?.length?children:undefined}</External>;
      }
    }
    if(!onNodeSelect)return <React.Fragment key={key}>{element}</React.Fragment>;
    return <div key={key} data-node-id={node.id||''} onClick={e=>{
      e.stopPropagation();onNodeSelect(node.editableId??node.id);
    }} className={'design-node'+(node.id&&(node.editableId??node.id)===selectedNode?' is-selected':'')}>
      {element}
    </div>;
  };
  return <div className="render-root">{render(tree)}</div>;
}
