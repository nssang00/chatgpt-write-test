import React from 'react';
import { Alert, Button, Card, Input, Switch, Table, Typography } from 'antd';
import { expandBlueprint,readPath,scopedPath,writePath } from './blueprint.mjs';

/** JSON is declarative data. All executable behavior comes from trusted React controls/actions. */
export function DynamicView({blueprint,definitions={},reactComponents={},data,onDataChange,actions={}}) {
  let tree;
  try { tree=expandBlueprint(blueprint,definitions); }
  catch(e){return <Alert showIcon type="error" message="Blueprint error" description={e.message}/>;}
  const render = node => {
    const p=node.props||{},key=node.id||node.type+'-'+node.scope;
    const children=node.children?.map(render);
    const fieldPath=port=>scopedPath(node.scope,node.bind?.[port]??'');
    const change=(port,value)=>{
      if(!node.bind?.[port]||!onDataChange)return;
      onDataChange(previous=>writePath(previous,fieldPath(port),value));
    };
    switch(node.type){
      case 'Column':return <div key={key} className="easy-column" style={{gap:p.gap??12}}>{children}</div>;
      case 'Row':return <div key={key} className="easy-row" style={{gap:p.gap??12}}>{children}</div>;
      case 'Panel':return <Card key={key} title={p.title} size="small">{children}</Card>;
      case 'Text':return <Typography.Text key={key} strong={p.strong}>{p.text||''}</Typography.Text>;
      case 'TextField':return <label key={key} className="easy-field">
        <span>{p.label||'입력'}</span>
        <Input value={String(readPath(data,fieldPath('value'))??'')} placeholder={p.placeholder||''}
          disabled={!!p.disabled} onChange={e=>change('value',e.target.value)}/>
      </label>;
      case 'Switch':return <div key={key} className="easy-switch">
        <span>{p.label||'사용'}</span>
        <Switch checked={!!readPath(data,fieldPath('checked'))} onChange={v=>change('checked',v)}/>
      </div>;
      case 'Button':return <Button key={key} type={p.primary?'primary':'default'} onClick={()=>{
        const name=node.on?.click;
        if(name&&Object.hasOwn(actions,name)&&typeof actions[name]==='function')
          actions[name]({data,scope:node.scope});
      }}>{p.label||'확인'}</Button>;
      case 'Table':{
        const rows=readPath(data,fieldPath('data'));
        const list=Array.isArray(rows)?rows:[];
        const columns=Object.keys(list[0]||{}).filter(k=>k!=='id').map(k=>({key:k,title:k,dataIndex:k}));
        return <Card key={key} title={p.title||'목록'} size="small">
          <Table size="small" rowKey={(r,i)=>r.id??i} dataSource={list} columns={columns} pagination={false}/>
        </Card>;
      }
      default:{
        const External=reactComponents[node.type];
        if(!External)return <Alert key={key} type="error" message={'React component not installed: '+node.type}/>;
        const manifest=definitions[node.type]?.manifest??{};
        const extProps={...p};
        for(const [port,path] of Object.entries(node.bind||{})){
          const spec=manifest.bindings?.[port];
          if(spec){
            extProps[spec.prop]=readPath(data,scopedPath(node.scope,path));
            if(spec.change)extProps[spec.change]=value=>change(port,value);
          }
        }
        for(const [evt,name] of Object.entries(node.on||{})){
          const callback=manifest.events?.[evt];
          if(callback&&typeof actions[name]==='function')
            extProps[callback]=(...args)=>actions[name]({data,scope:node.scope,args});
        }
        return <External key={key} {...extProps}>{children?.length?children:undefined}</External>;
      }
    }
  };
  return <div className="render-root">{render(tree)}</div>;
}
