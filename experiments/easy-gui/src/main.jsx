import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Alert,Button,Card,Input,Select,Space,Tag,Typography,message} from 'antd';
import {DynamicView} from './DynamicView.jsx';
import {parseBlueprint,publishComponent,validateBlueprint} from './blueprint.mjs';
import {initialBlueprint,initialDefinitions,sampleData} from './examples.mjs';
import {createComponentBundle,installComponentBundle,COMPONENT_FORMAT} from './component-kit.mjs';
import {codeDefinitions,codeRenderers} from './code-components.jsx';
import installedComponents from './installed-components.json';
import './styles.css';

const clone=value=>structuredClone(value);
const builtins=['Column','Row','Panel','Text','TextField','Switch','Button','Table'];
const containers=new Set(['Column','Row','Panel']);
const defaults={
  Column:{gap:12},Row:{gap:12},Panel:{title:'패널'},Text:{text:'새 텍스트'},
  TextField:{label:'입력',placeholder:'값 입력'},Switch:{label:'사용'},
  Button:{label:'확인'},Table:{title:'데이터 목록'}
};
const visit=(node,fn)=>{fn(node);(node.children||[]).forEach(c=>visit(c,fn));};
const find=(doc,id)=>{let found;visit(doc.root,n=>{if(n.id===id)found=n;});return found;};
const update=(doc,id,fn)=>{const result=clone(doc);visit(result.root,n=>{if(n.id===id)fn(n);});return result;};
function NodeTree({node,selected,onSelect,depth=0}){
  return <React.Fragment>
    <button className={'tree-node '+(node.id===selected?'active':'')} style={{paddingLeft:12+depth*12}}
      onClick={()=>onSelect(node.id)}>{node.type} <small>{node.props?.label||''}</small></button>
    {node.children?.map((n,i)=><NodeTree key={n.id||i} node={n} selected={selected}
      onSelect={onSelect} depth={depth+1}/>)}
  </React.Fragment>;
}
function Studio(){
  const [doc,setDoc]=useState(()=>clone(initialBlueprint));
  const [registry,setRegistry]=useState(()=>clone({...initialDefinitions,...installedComponents,...codeDefinitions}));
  const [data,setData]=useState(()=>clone(sampleData));
  const [selected,setSelected]=useState('root');
  const [json,setJson]=useState(()=>JSON.stringify(initialBlueprint,null,2));
  const [mode,setMode]=useState('designer');
  const [error,setError]=useState('');
  const [saved,setSaved]=useState('');
  const [notice,holder]=message.useMessage();
  const item=find(doc,selected);
  const checked=validateBlueprint(doc,registry);
  const setDocument=next=>{setDoc(next);setJson(JSON.stringify(next,null,2));setError('');};
  const add=type=>{
    const manifest=registry[type]?.manifest;
    const props=manifest?Object.fromEntries(
      Object.entries(manifest.props??{}).filter(([,x])=>x.default!==undefined).map(([k,x])=>[k,x.default])
    ):defaults[type]||{title:type};
    const n={id:'n'+Math.random().toString(36).slice(2,10),type,props:clone(props)};
    if(!builtins.includes(type))n.scope='shipping';
    if(manifest?.bindings?.active)n.bind={active:'enabled'};
    if(type==='TextField')n.bind={value:'shipping.name'};
    if(type==='Switch')n.bind={checked:'shipping.enabled'};
    if(type==='Table')n.bind={data:'users'};
    if(type==='Button')n.on={click:'save'};
    const target=item&&containers.has(item.type)?selected:'root';
    setDocument(update(doc,target,node=>{node.children??=[];node.children.push(n);}));
    setSelected(n.id);
  };
  const edit=(kind,key,value)=>setDocument(update(doc,selected,n=>{n[kind]??={};n[kind][key]=value;}));
  const editScope=value=>setDocument(update(doc,selected,n=>{n.scope=value;}));
  const remove=()=>{
    if(selected==='root')return;
    const next=clone(doc);
    visit(next.root,n=>{if(n.children)n.children=n.children.filter(child=>child.id!==selected);});
    setDocument(next);setSelected('root');
  };
  const publish=()=>{
    const name=window.prompt('컴포넌트 이름 (영문/숫자/밑줄)', 'MyComponent');
    if(!name)return;
    try{setRegistry(old=>publishComponent(name,clone(doc.root),old));
      notice.success(name+' 컴포넌트가 Toolbox에 등록되었습니다');}
    catch(e){setError(e.message);}
  };
  const apply=()=>{
    try{
      const obj=JSON.parse(json);
      const bundle=obj?.blueprint&&obj?.definitions?obj:null;
      const defs=bundle?bundle.definitions:registry;
      const next=parseBlueprint(JSON.stringify(bundle?bundle.blueprint:obj),defs);
      if(bundle)setRegistry(defs);
      setDocument(next);setSelected(next.root?.id||'root');
      notice.success('JSON을 검증하고 적용했습니다');
    }catch(e){setError(e.message);}
  };
  const download=()=>{
    const text=JSON.stringify({blueprint:doc,definitions:registry},null,2);
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='easy-gui-blueprint.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const importJson=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const text=await file.text();
      const obj=JSON.parse(text);
      if(obj.format===COMPONENT_FORMAT){
        const updated=installComponentBundle(registry,obj);
        setRegistry(updated);
        const missing=obj.requires.react.filter(name=>!Object.hasOwn(codeRenderers,name));
        notice[missing.length?'warning':'success'](missing.length?
          '설치 완료. React 소스 등록이 필요합니다: '+missing.join(', '):
          obj.name+' 컴포넌트를 Toolbox에 설치했습니다');
      }else{
        setJson(text);setMode('json');
        notice.info('JSON을 읽었습니다. 적용 버튼을 눌러 검증하세요.');
      }
    }catch(err){setError(err.message);}
    e.target.value='';
  };
  const downloadPackage=()=>{
    const name=window.prompt('배포할 컴포넌트 이름','MySharedScreen');
    if(!name)return;
    try{
      const bundle=createComponentBundle(name,doc.root,registry);
      const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=name+'.easygui.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      notice.success('재사용 가능한 컴포넌트 패키지를 만들었습니다');
    }catch(err){setError(err.message);}
  };
  const actions={save:({data:state,scope})=>{
    const result=scope?scope.split('.').reduce((value,k)=>value?.[k],state):state;
    setSaved(scope+': '+JSON.stringify(result));notice.success('샘플 저장 완료');
  }};
  return <div className="studio">
    {holder}
    <header><div><strong>Easy GUI Studio</strong><small> React components, made easy</small></div>
      <Space wrap><Button size="small" onClick={()=>{
        setDocument(clone(initialBlueprint));setRegistry(clone({...initialDefinitions,...installedComponents,...codeDefinitions}));
        setData(clone(sampleData));setSelected('root');}}>초기화</Button>
        <label className="file-button">JSON 가져오기<input hidden type="file" accept=".json,application/json" onChange={importJson}/></label>
        <Button size="small" onClick={download}>JSON 다운로드</Button>
        <Button size="small" onClick={downloadPackage}>컴포넌트 패키지</Button>
        <Button size="small" type="primary" onClick={publish}>컴포넌트로 등록</Button></Space>
    </header>
    <div className="workbench">
      <aside className="toolbox"><h3>Toolbox</h3><small>기본 컨트롤</small>
        <div className="controls">{builtins.map(n=><Button key={n} size="small" block onClick={()=>add(n)}>+ {n}</Button>)}</div>
        <hr/><small>조립한 컴포넌트</small>
        <div className="controls">{Object.keys(registry).map(n=><Button key={n} size="small" block onClick={()=>add(n)}>+ {n}</Button>)}</div>
        <hr/><h4>Component Tree</h4><NodeTree node={doc.root} selected={selected} onSelect={setSelected}/>
      </aside>
      <main><div className="preview-head"><Tag color="blue">Live React + AntD</Tag>
        <Button size="small" onClick={()=>setData(clone(sampleData))}>데이터 초기화</Button></div>
        {!checked.valid&&<Alert type="error" message={checked.errors.join('; ')} showIcon/>}
        <div className="preview"><DynamicView blueprint={doc} definitions={registry} reactComponents={codeRenderers} data={data}
          onDataChange={setData} actions={actions}/></div>
        {saved&&<Alert type="success" showIcon message={'Save: '+saved}/>}
      </main>
      <aside className="inspector"><h3>Properties</h3>
        {item?<><Tag>{item.type}</Tag>
          <label>ID<Input disabled size="small" value={item.id}/></label>
          <label>Scope<Input size="small" value={item.scope||''} onChange={e=>editScope(e.target.value)}/></label>
          {Object.entries({...Object.fromEntries(
            Object.entries(registry[item.type]?.manifest?.props||{}).map(([k,info])=>[k,info.default??''])
          ),...item.props}).map(([key,value])=>{
            const field=registry[item.type]?.manifest?.props?.[key];
            return <label key={key}>{field?.label||key}
              {field?.type==='enum'?<Select size="small" value={value}
                options={field.options.map(v=>({value:v,label:v}))}
                onChange={v=>edit('props',key,v)}/>:
              field?.type==='boolean'?<Select size="small" value={Boolean(value)}
                options={[{value:true,label:'true'},{value:false,label:'false'}]}
                onChange={v=>edit('props',key,v)}/>:
              <Input size="small" value={String(value)}
                onChange={e=>edit('props',key,field?.type==='number'||key==='gap'?Number(e.target.value):e.target.value)}/>}
            </label>;
          })}
          {Object.entries({...Object.fromEntries(
            Object.keys(registry[item.type]?.manifest?.bindings||{}).map(k=>[k,''])
          ),...item.bind}).map(([key,value])=><label key={key}>Binding: {key}
            <Select showSearch size="small" style={{width:'100%'}} value={value}
              onChange={v=>edit('bind',key,v)}
              options={['shipping.name','shipping.city','shipping.enabled','billing.name','billing.city',
                'billing.enabled','users','name','city','enabled'].map(v=>({value:v,label:v}))}/>
          </label>)}
          <Button danger size="small" disabled={selected==='root'} onClick={remove}>선택 블록 삭제</Button>
        </>:<span>블록을 선택하세요.</span>}
      </aside>
    </div>
    <div className="bottom"><Space style={{marginBottom:8}}>
      {['designer','json','code','data'].map(n=><Button key={n} size="small" type={mode===n?'primary':'default'} onClick={()=>setMode(n)}>{n}</Button>)}
    </Space>
    {mode==='designer'&&<Typography.Paragraph>기본 블록을 추가하고 Properties에서 수정하세요.
      AddressEditor 한 종류가 배송지/청구지 각각 독립된 데이터에 바인딩됩니다.
      현재 화면 전체를 컴포넌트로 등록하면 Toolbox에서 다시 조립할 수 있습니다.</Typography.Paragraph>}
    {mode==='json'&&<><Input.TextArea rows={11} value={json} onChange={e=>setJson(e.target.value)}
      style={{fontFamily:'monospace'}}/><Button type="primary" onClick={apply}>JSON 적용 / 검증</Button></>}
    {mode==='code'&&<pre>{[
      "import { DynamicView } from './DynamicView.jsx';",
      "import blueprint from './blueprint.json';",
      "// Developer may also use React and AntD directly.",
      "<DynamicView blueprint={blueprint} data={data}",
      "  onDataChange={setData} definitions={registry} />"
    ].join('\n')}</pre>}
    {mode==='data'&&<pre>{JSON.stringify(data,null,2)}</pre>}
    {error&&<Alert type="error" showIcon message={error} closable onClose={()=>setError('')}/>}
    </div>
    <footer>기존 React 컴포넌트는 신뢰한 프로젝트에서 import하고, UI 패키지는 JSON으로 공유합니다.</footer>
  </div>;
}
createRoot(document.getElementById('root')).render(<Studio/>);
