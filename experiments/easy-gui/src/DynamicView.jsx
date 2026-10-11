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
  viewport='desktop', pendingType, onPlacement, onResizeSpan, onFreePosition
}) {
  const [dropHint,setDropHint]=useState(null);
  const resizeStart=useRef(null);
  const moveStart=useRef(null);
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
    const sideAt=event=>(!parent||node.type==='FreeCanvas'||parent?.type==='FreeCanvas')
      ?'inside':suggestDropSide(event.currentTarget.getBoundingClientRect(),
      event.clientX,event.clientY,{container:isContainer(node.type)&&
        !node.instanceType,direction});
    const layoutParent=parent?.type==='Grid';
    const freeParent=parent?.type==='FreeCanvas';
    const columns=Math.max(1,Math.min(12,Number(parent?.props?.columns)||2));
    const span=getGridSpan(node,viewport,columns);
    const sizing=node.sizing?.mode;
    const isRow=parent?.type==='Row';
    const free=node.placement?.free??{x:16,y:16,width:200,height:48};
    const layoutStyle={
      ...(layoutParent?{gridColumn:'span '+span}:{}),
      ...(freeParent?{position:'absolute',left:free.x,top:free.y,
        width:free.width,minHeight:free.height}:{}) ,
      ...(sizing==='hug'?{width:'fit-content',...(isRow?{flex:'0 0 auto'}:{})}:{}),
      ...(sizing==='fill'?{width:'100%',...(isRow?{flex:'1 1 0%'}:{})}:{}),
      ...(sizing==='fixed'?{width:node.sizing.px+'px',maxWidth:'100%',
        ...(isRow?{flex:'0 0 '+node.sizing.px+'px'}:{})}:{})
    };
    const hover=dropHint?.id===editableId?dropHint.side:null;
    const canEdit=Boolean(onNodeSelect);
    const dropLocation=event=>{
      const freeZone=event.currentTarget.closest('.easy-free-canvas')??
        event.currentTarget.querySelector('.easy-free-canvas');
      const target=freeZone?(parent?.type==='FreeCanvas'?parent.editableId??parent.id:editableId):
        editableId;
      const rect=freeZone?.getBoundingClientRect();
      return {targetId:target,side:rect?'inside':sideAt(event),
        ...(rect?{point:{x:Math.max(0,event.clientX-rect.left),
          y:Math.max(0,event.clientY-rect.top)}}:{})};
    };
    const handlePlacement=event=>{
      event.stopPropagation();
      if(pendingType&&onPlacement){
        onPlacement({type:pendingType,...dropLocation(event)});
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
          ...dropLocation(event)});
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
      {canEdit&&editableId===selectedNode&&parent&&!pendingType&&
        <button type="button" className={'canvas-move-handle'+(freeParent?' free-move':'')}
          draggable={!freeParent}
          title="다른 위치로 드래그하여 이동" aria-label="선택 요소 이동"
          onClick={event=>event.stopPropagation()}
          onPointerDown={event=>{
            if(!freeParent)return;
            event.stopPropagation();event.preventDefault();
            moveStart.current={id:editableId,x:event.clientX,y:event.clientY,free};
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={event=>{
            if(!freeParent||!moveStart.current)return;
            event.stopPropagation();
            const start=moveStart.current;
            onFreePosition?.(start.id,{...start.free,
              x:start.free.x+event.clientX-start.x,
              y:start.free.y+event.clientY-start.y});
            moveStart.current=null;
          }}
          onDragStart={event=>{
            event.stopPropagation();event.dataTransfer.effectAllowed='move';
            event.dataTransfer.setData('application/x-easygui-node',editableId);
          }}>✥</button>}
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
