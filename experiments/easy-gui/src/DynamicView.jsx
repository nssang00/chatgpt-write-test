import React from 'react';
import {
  Alert, Button, Card, Checkbox, DatePicker, Divider, Empty, Input, InputNumber,
  Progress, Radio, Select, Statistic, Switch, Table, Tabs, Tag, Typography
} from 'antd';
import dayjs from 'dayjs';
import {expandBlueprint,readPath,scopedPath,writePath} from './blueprint.mjs';

const options=value=>String(value??'').split(',').map(s=>s.trim()).filter(Boolean)
  .map(value=>({value,label:value}));
const rowKey=(record,index)=>record?.id??index;
const toDate=value=>value&&dayjs(value).isValid()?dayjs(value):null;
const bounded=(node,port)=>Boolean(node.bind?.[port]);

/** Real Ant Design controls; the Blueprint is declarative data, not executable JSX. */
export function DynamicView({
  blueprint, definitions={}, reactComponents={}, data, onDataChange,
  actions={}, onNodeSelect, selectedNode
}) {
  let tree;
  try{tree=expandBlueprint(blueprint,definitions);}
  catch(error){return <Alert showIcon type="error" message="Blueprint error" description={error.message}/>;}

  const render=node=>{
    const p=node.props??{};
    const key=node.id??node.type+'-'+node.scope;
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
    const label=content=><label className="easy-field"><span className="easy-field-label">{p.label||'입력'}</span>{content}</label>;
    const pick=(name,placeholder)=>(
      <Input value={bounded(node,'value')?String(value('value')??''):undefined}
        placeholder={placeholder??p.placeholder} disabled={!!p.disabled}
        onChange={e=>change('value',e.target.value)}/>
    );
    let element;
    switch(node.type){
      case 'Column':element=<div className="easy-column" style={{gap:p.gap??16}}>{children}</div>;break;
      case 'Row':element=<div className="easy-row" style={{gap:p.gap??16}}>{children}</div>;break;
      case 'Grid':element=<div className="easy-grid" style={{gap:p.gap??16,
        gridTemplateColumns:`repeat(${Math.max(1,Math.min(6,Number(p.columns)||2))},minmax(0,1fr))`}}>{children}</div>;break;
      case 'Panel':element=<Card title={p.title} className="easy-panel">{children}</Card>;break;
      case 'Tabs':element=<Tabs size={p.size||'middle'}
        items={(node.children??[]).map((child,i)=>({
          key:child.id??String(i),label:child.props?.title??'탭 '+(i+1),
          children:render(child)
        }))}/>;break;
      case 'Divider':element=<Divider orientation="left">{p.title||undefined}</Divider>;break;
      case 'Heading':element=<Typography.Title level={Math.max(1,Math.min(5,Number(p.level)||3))}
        style={{margin:0}}>{p.text||'새 섹션'}</Typography.Title>;break;
      case 'Text':element=<Typography.Text strong={!!p.strong}>{p.text||''}</Typography.Text>;break;
      case 'Tag':element=<Tag color={p.color||'blue'}>{p.text||'태그'}</Tag>;break;
      case 'Alert':element=<Alert showIcon type={p.type||'info'} message={p.message}
        description={p.description||undefined}/>;break;
      case 'Statistic':element=<Card className="easy-stat" size="small"><Statistic
        title={p.title} value={Number(p.value)||0} suffix={p.suffix}/></Card>;break;
      case 'Progress':element=<Progress percent={Math.max(0,Math.min(100,Number(p.percent)||0))}
        status={p.status||'normal'}/>;break;
      case 'TextField':element=label(pick('value'));break;
      case 'PasswordField':element=label(<Input.Password
        value={bounded(node,'value')?String(value('value')??''):undefined}
        placeholder={p.placeholder} onChange={e=>change('value',e.target.value)}/>);break;
      case 'TextArea':element=label(<Input.TextArea rows={Math.max(1,Math.min(12,Number(p.rows)||3))}
        value={bounded(node,'value')?String(value('value')??''):undefined}
        placeholder={p.placeholder} onChange={e=>change('value',e.target.value)}/>);break;
      case 'NumberField':element=label(<InputNumber style={{width:'100%'}}
        min={p.min} value={bounded(node,'value')?value('value'):undefined}
        onChange={v=>change('value',v)}/>);break;
      case 'SelectField':element=label(<Select style={{width:'100%'}} options={options(p.options)}
        value={bounded(node,'value')?(value('value')||undefined):undefined}
        placeholder={p.placeholder} onChange={v=>change('value',v)}/>);break;
      case 'RadioGroup':element=label(<Radio.Group options={options(p.options)}
        value={bounded(node,'value')?value('value'):undefined} onChange={e=>change('value',e.target.value)}/>);break;
      case 'DateField':element=label(<DatePicker style={{width:'100%'}} format="YYYY-MM-DD"
        placeholder={p.placeholder} value={bounded(node,'value')?toDate(value('value')):undefined}
        onChange={(_,date)=>change('value',date||null)}/>);break;
      case 'CheckBox':element=<Checkbox
        checked={bounded(node,'checked')?!!value('checked'):undefined}
        onChange={e=>change('checked',e.target.checked)}>{p.label||'체크'}</Checkbox>;break;
      case 'Switch':element=<div className="easy-switch"><span>{p.label||'사용'}</span>
        <Switch checked={bounded(node,'checked')?!!value('checked'):undefined}
          onChange={v=>change('checked',v)}/></div>;break;
      case 'Button':element=<Button type={p.primary?'primary':'default'} onClick={()=>act('click')}>
        {p.label||'확인'}</Button>;break;
      case 'Table':{
        const rows=value('data');
        const list=Array.isArray(rows)?rows:[];
        const keys=options(p.columns).map(o=>o.value);
        const columns=(keys.length?keys:Object.keys(list[0]??{}).filter(k=>k!=='id')).map(k=>({
          key:k,title:({name:'이름',city:'지역',enabled:'상태',email:'이메일',department:'부서'})[k]||k,dataIndex:k,
          render:v=>v===true?<Tag color="green">활성</Tag>:v===false?<Tag>비활성</Tag>:(v??'—')
        }));
        element=<Card title={p.title||'데이터 목록'} className="easy-table-card" size="small">
          <Table size="middle" rowKey={rowKey} columns={columns} dataSource={list}
            pagination={list.length>(Number(p.pageSize)||5)?{pageSize:Number(p.pageSize)||5}:false}
            scroll={{x:'max-content'}}/></Card>;break;
      }
      default:{
        const External=reactComponents[node.type];
        if(!External){element=<Alert type="error" message={'React component not installed: '+node.type}/>;break;}
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
      e.stopPropagation();onNodeSelect(node.id);
    }} className={'design-node'+(node.id&&node.id===selectedNode?' is-selected':'')}>
      {element}
    </div>;
  };
  return <div className="render-root">{render(tree)}</div>;
}
