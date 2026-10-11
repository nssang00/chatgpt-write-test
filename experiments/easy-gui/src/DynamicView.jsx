import React,{useRef,useState} from 'react';
import {Alert} from 'antd';
import {renderAntdControl} from './adapters/antd.jsx';
import {expandBlueprint,readPath,scopedPath,writePath} from './blueprint.mjs';
import {getGridSpan,suggestDropSide} from './layout.mjs';
import {isContainer} from './catalog.mjs';

const bounded=(node,port)=>Boolean(node.bind?.[port]);

/** Real Ant Design controls; the Blueprint is declarative data, not executable JSX. */
export function DynamicView({
  blueprint, definitions={}, reactComponents={}, data, onDataChange,
  actions={}, onNodeSelect, selectedNode, renderBuiltin=renderAntdControl,
  viewport='desktop', pendingType, onPlacement, onResizeSpan
}) {
  const [dropHint,setDropHint]=useState(null);
  const resizeStart=useRef(null);
  let tree;
  try{tree=expandBlueprint(blueprint,definitions);}
  catch(error){return <Alert showIcon type="error" message="Blueprint error" description={error.message}/>;}

  const render=(node,parent=null,index=0)=>{
    const p=node.props??{};
    const editableId=node.editableId??node.id;
    const key=node.instancePath??node.id??node.type+'-'+node.scope;
    const children=node.children?.map((child,i)=>render(child,node,i));
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
    const direction=parent?.type==='Row'?'horizontal':'vertical';
    const sideAt=event=>!parent?'inside':suggestDropSide(event.currentTarget.getBoundingClientRect(),
      event.clientX,event.clientY,{container:isContainer(node.type)&&
        !node.instanceType,direction});
    const layoutParent=parent?.type==='Grid';
    const columns=Math.max(1,Math.min(12,Number(parent?.props?.columns)||2));
    const span=getGridSpan(node,viewport,columns);
    const sizing=node.sizing?.mode;
    const isRow=parent?.type==='Row';
    const layoutStyle={
      ...(layoutParent?{gridColumn:'span '+span}:{}),
      ...(sizing==='hug'?{width:'fit-content',...(isRow?{flex:'0 0 auto'}:{})}:{}),
      ...(sizing==='fill'?{width:'100%',...(isRow?{flex:'1 1 0%'}:{})}:{}),
      ...(sizing==='fixed'?{width:node.sizing.px+'px',maxWidth:'100%',
        ...(isRow?{flex:'0 0 '+node.sizing.px+'px'}:{})}:{})
    };
    const hover=dropHint?.id===editableId?dropHint.side:null;
    const canEdit=Boolean(onNodeSelect);
    const handlePlacement=event=>{
      event.stopPropagation();
      if(pendingType&&onPlacement){
        onPlacement({type:pendingType,targetId:editableId,side:sideAt(event)});
        setDropHint(null);
      }else onNodeSelect?.(editableId);
    };
    const handleDrop=event=>{
      if(!onPlacement)return;
      event.preventDefault();event.stopPropagation();
      const plain=event.dataTransfer.getData('application/x-easygui-node');
      const toolbox=event.dataTransfer.getData('application/x-easygui-control');
      if(plain||toolbox){
        onPlacement({sourceId:plain||undefined,type:toolbox||undefined,
          targetId:editableId,side:sideAt(event)});
      }
      setDropHint(null);
    };
    const resizeAvailable=layoutParent&&canEdit&&node.id===editableId&&
      !node.instanceType&&viewport!=='mobile';
    return <div key={key} data-node-id={editableId||''} data-instance-path={node.instancePath}
      data-grid-span={layoutParent?String(span):undefined}
      onClick={canEdit?handlePlacement:undefined}
      onDragOver={onPlacement?event=>{
        if(event.dataTransfer.types.includes('application/x-easygui-control')||
           event.dataTransfer.types.includes('application/x-easygui-node')){
          event.preventDefault();event.stopPropagation();
          const side=sideAt(event);
          setDropHint(previous=>previous?.id===editableId&&previous.side===side?
            previous:{id:editableId,side});
        }
      }:undefined}
      onDragLeave={onPlacement?event=>{
        if(!event.currentTarget.contains(event.relatedTarget))setDropHint(null);
      }:undefined}
      onDrop={onPlacement?handleDrop:undefined}
      className={'design-node'+(node.id&&editableId===selectedNode?' is-selected':'')+
        (hover?' drop-'+hover:'')+(pendingType?' placement-cursor':'')}
      style={layoutStyle}>
      {element}
      {resizeAvailable&&editableId===selectedNode&&<button type="button"
        className="grid-resize-handle" aria-label="Grid 열 너비 조절"
        title="드래그 또는 좌우 화살표로 Grid 너비 변경"
        onClick={e=>e.stopPropagation()}
        onPointerDown={e=>{
          e.stopPropagation();e.preventDefault();
          const grid=e.currentTarget.closest('.easy-grid');
          resizeStart.current={x:e.clientX,span,width:grid?.getBoundingClientRect().width??600,columns};
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={e=>{
          e.stopPropagation();
          const start=resizeStart.current;
          if(start){
            const delta=Math.round((e.clientX-start.x)/(start.width/start.columns));
            onResizeSpan?.(editableId,Math.max(1,Math.min(start.columns,start.span+delta)));
            resizeStart.current=null;
          }
        }}
        onKeyDown={e=>{
          if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
            e.stopPropagation();e.preventDefault();
            onResizeSpan?.(editableId,Math.max(1,Math.min(columns,span+(e.key==='ArrowRight'?1:-1))));
          }
        }}>⋮</button>}
    </div>;
  };
  return <div className="render-root">{render(tree)}</div>;
}
