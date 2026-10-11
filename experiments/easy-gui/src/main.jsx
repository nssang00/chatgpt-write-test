import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Alert,Button,Card,Input,Select,Space,Tag,Typography,message} from 'antd';
import {DynamicView} from './DynamicView.jsx';
import {parseBlueprint,publishComponent,validateBlueprint} from './blueprint.mjs';
import {initialDefinitions,sampleData} from './examples.mjs';
import {CONTROL_CATALOG,CONTROL_GROUPS,defaultNode,isContainer} from './catalog.mjs';
import {getComponentManifest} from './manifest.mjs';
import {findNode,updateNode,removeNode,duplicateNode,moveNode,visitNodes,
  extractComponent} from './commands.mjs';
import {placeNode,setGridSpan,setNodeSizing} from './layout.mjs';
import {SCREEN_TEMPLATES,getTemplate} from './templates.mjs';
import {createComponentBundle,installComponentBundle,COMPONENT_FORMAT} from './component-kit.mjs';
import {codeDefinitions,codeRenderers} from './code-components.jsx';
import installedComponents from './installed-components.json';
import './styles.css';

const clone=value=>structuredClone(value);
const builtins=Object.keys(CONTROL_CATALOG);
const containers=new Set(builtins.filter(isContainer));
const findParent=(doc,id)=>{
  let result=null;
  visitNodes(doc.root,parent=>{
    if(parent.children?.some(child=>child.id===id))result=parent;
  });
  return result;
};
const glyphs={
  column:'☷',row:'↔',grid:'▦',panel:'▣',split:'↔',divider:'—',tabs:'▤',
  heading:'H',text:'T',tag:'◆',alert:'!',statistic:'◷',progress:'◕',steps:'➊',
  input:'⌨',select:'⌄',radio:'◉',calendar:'▦',check:'☑',switch:'◐',slider:'◉',
  button:'●',table:'▥',tree:'♧',list:'☰'
};
const pathOptions=(obj,prefix='',depth=0)=>{
  if(depth>4||!obj||typeof obj!=='object')return [];
  return Object.entries(obj).flatMap(([key,value])=>{
    const name=prefix?prefix+'.'+key:key;
    if(Array.isArray(value)||value===null||typeof value!=='object')return [name];
    return pathOptions(value,name,depth+1);
  });
};
function NodeTree({node,selected,onSelect,onMove,depth=0}){
  return <React.Fragment>
    <button className={'tree-node '+(node.id===selected?'active':'')}
      style={{paddingLeft:12+depth*12}}
      draggable={depth>0}
      title={isContainer(node.type)?'여기로 블록을 드롭하여 이동':'선택하여 편집'}
      onDragStart={event=>{
        event.dataTransfer.effectAllowed='move';
        event.dataTransfer.setData('text/plain',node.id);
      }}
      onDragOver={event=>{
        if(isContainer(node.type)){event.preventDefault();event.dataTransfer.dropEffect='move';}
      }}
      onDrop={event=>{
        if(!isContainer(node.type))return;
        event.preventDefault();
        event.stopPropagation();
        const source=event.dataTransfer.getData('text/plain');
        if(source)onMove(source,node.id);
      }}
      onClick={()=>onSelect(node.id)}>{node.type} <small>{node.props?.label||''}</small></button>
    {node.children?.map((child,i)=><NodeTree key={child.id||i} node={child}
      selected={selected} onSelect={onSelect} onMove={onMove} depth={depth+1}/>)}
  </React.Fragment>;
}
function Studio(){
  const [doc,setDoc]=useState(()=>getTemplate('workspace'));
  const [template,setTemplate]=useState('workspace');
  const [search,setSearch]=useState('');
  const [viewport,setViewport]=useState('desktop');
  const [inspectorTab,setInspectorTab]=useState('props');
  const [history,setHistory]=useState({past:[],future:[]});
  const [registry,setRegistry]=useState(()=>clone({...initialDefinitions,...installedComponents,...codeDefinitions}));
  const [data,setData]=useState(()=>clone(sampleData));
  const [selected,setSelected]=useState('root');
  const [pendingType,setPendingType]=useState(null);
  const [json,setJson]=useState(()=>JSON.stringify(getTemplate('workspace'),null,2));
  const [mode,setMode]=useState('designer');
  const [error,setError]=useState('');
  const [saved,setSaved]=useState('');
  const [notice,holder]=message.useMessage();
  const item=findNode(doc,selected);
  const currentManifest=item?getComponentManifest(item.type,registry):null;
  const selectedParent=findParent(doc,selected);
  const checked=validateBlueprint(doc,registry);
  const setDocument=next=>{
    setHistory(prev=>({past:[...prev.past.slice(-19),doc],future:[]}));
    setDoc(next);setJson(JSON.stringify(next,null,2));setError('');
  };
  const undo=()=>{
    if(!history.past.length)return;
    const last=history.past.at(-1);
    setHistory(prev=>({past:prev.past.slice(0,-1),future:[doc,...prev.future]}));
    setDoc(last);setJson(JSON.stringify(last,null,2));setSelected(last.root?.id||'root');
  };
  const redo=()=>{
    if(!history.future.length)return;
    const next=history.future[0];
    setHistory(prev=>({past:[...prev.past,doc],future:prev.future.slice(1)}));
    setDoc(next);setJson(JSON.stringify(next,null,2));setSelected(next.root?.id||'root');
  };
  const chooseTemplate=name=>{
    setTemplate(name);const next=getTemplate(name);setDocument(next);
    setSelected(next.root?.id||'root');setData(clone(sampleData));setPendingType(null);
  };
  const createNode=type=>{
    const manifest=getComponentManifest(type,registry);
    if(!manifest)throw new Error('등록되지 않은 컴포넌트: '+type);
    const props=Object.fromEntries(Object.entries(manifest.props??{})
      .filter(([,spec])=>spec.default!==undefined).map(([name,spec])=>[name,spec.default]));
    const node=builtins.includes(type)?defaultNode(type,'n'+Math.random().toString(36).slice(2,10)):
      {id:'n'+Math.random().toString(36).slice(2,10),type,props:clone(props)};
    if(!builtins.includes(type)&&manifest.kind==='react')node.scope='shipping';
    if(manifest.bindings?.active)node.bind={active:'enabled'};
    if(type==='TextField')node.bind={value:'shipping.name'};
    if(type==='Switch'||type==='CheckBox')node.bind={checked:'shipping.enabled'};
    if(type==='Table')node.bind={data:'users'};
    if(type==='Slider')node.bind={value:'contact.score'};
    if(type==='Button')node.on={click:'save'};
    return node;
  };
  const add=type=>{
    setPendingType(type);
    setMode('designer');
    notice.info('캔버스에서 배치할 위치를 클릭하거나 컨트롤을 끌어다 놓으세요');
  };
  const place=({sourceId,type,targetId,side})=>{
    try{
      const kind=type??(!sourceId?pendingType:undefined);
      const node=kind?createNode(kind):undefined;
      const next=placeNode(doc,{sourceId,node,targetId,side,definitions:registry});
      setDocument(next);
      setSelected(sourceId??node.id);
      setInspectorTab('props');
      setPendingType(null);
    }catch(e){setError(e.message);}
  };
  const changeSize=(mode,px)=>{
    try{setDocument(setNodeSizing(doc,selected,mode,px));}
    catch(e){setError(e.message);}
  };
  const changeSpan=span=>{
    try{setDocument(setGridSpan(doc,selected,viewport,span));}
    catch(e){setError(e.message);}
  };
  const duplicate=()=>{
    if(selected==='root')return;
    try{
      const copied=duplicateNode(doc,selected);
      setDocument(copied.doc);setSelected(copied.id);
    }catch(err){setError(err.message);}
  };
  const move=(source,target)=>{
    try{
      setDocument(moveNode(doc,source,target,registry));setSelected(source);
    }catch(err){setError(err.message);}
  };
  const extract=()=>{
    if(selected==='root'){notice.warning('추출할 컨트롤을 먼저 선택하세요');return;}
    const name=window.prompt('새 컴포넌트 이름 (영문)','ReusableBlock');
    if(!name)return;
    try{
      const result=extractComponent(doc,selected,name,registry);
      setRegistry(result.definitions);
      setDocument(result.doc);
      notice.success(name+' 컴포넌트로 추출했습니다');
    }catch(err){setError(err.message);}
  };
  const edit=(kind,key,value)=>setDocument(updateNode(doc,selected,n=>{n[kind]??={};n[kind][key]=value;}));
  const editScope=value=>setDocument(updateNode(doc,selected,n=>{n.scope=value;}));
  const remove=()=>{
    if(selected==='root')return;
    try{
      setDocument(removeNode(doc,selected));setSelected('root');
    }catch(err){setError(err.message);}
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
    <header><div className="app-brand"><span className="brand-symbol">◈</span><span><strong>Easy GUI Studio</strong><small>Visual UI Builder · React ecosystem</small></span></div>
      <Space wrap><Button size="small" onClick={undo} disabled={!history.past.length}>↶ Undo</Button>
        <Button size="small" onClick={redo} disabled={!history.future.length}>↷ Redo</Button>
        <Button size="small" onClick={()=>{
        chooseTemplate('workspace');setRegistry(clone({...initialDefinitions,...installedComponents,...codeDefinitions}));
        setData(clone(sampleData));setSelected('root');}}>초기화</Button>
        <label className="file-button">JSON 가져오기<input hidden type="file" accept=".json,application/json" onChange={importJson}/></label>
        <Button size="small" onClick={download}>JSON 다운로드</Button>
        <Button size="small" onClick={downloadPackage}>컴포넌트 패키지</Button>
        <Button size="small" onClick={extract}>선택 영역 추출</Button>
        <Button size="small" type="primary" onClick={publish}>컴포넌트로 등록</Button></Space>
    </header>
    <div className="workbench">
      <aside className="toolbox"><h3>컴포넌트 <span className="eyebrow">TOOLBOX</span></h3>
        <Input allowClear placeholder="컨트롤 검색..." aria-label="컨트롤 검색"
          value={search} onChange={e=>setSearch(e.target.value)}/>
        <div className="toolbox-list">{CONTROL_GROUPS.map(group=>{
          const choices=builtins.filter(type=>CONTROL_CATALOG[type].group===group &&
            (type+' '+CONTROL_CATALOG[type].label).toLowerCase().includes(search.toLowerCase()));
          return choices.length?<div className="group-block" key={group}>
            <div className="group-title">{group}<span>{choices.length}</span></div>
            <div className="controls">{choices.map(type=><Button key={type} size="small" block draggable
              onDragStart={event=>{
                event.dataTransfer.setData('application/x-easygui-control',type);
                event.dataTransfer.effectAllowed='copy';
              }} onClick={()=>add(type)}><span className="control-icon">{glyphs[CONTROL_CATALOG[type].icon]||'◇'}</span>
              {CONTROL_CATALOG[type].label} <small>+ {type}</small></Button>)}</div>
          </div>:null;
        })}</div>
        <hr/><small>조립한 컴포넌트</small>
        <div className="controls custom-controls">{Object.keys(registry)
          .filter(n=>n.toLowerCase().includes(search.toLowerCase()))
          .map(n=><Button key={n} size="small" block draggable
            onDragStart={event=>{
              event.dataTransfer.setData('application/x-easygui-control',n);
              event.dataTransfer.effectAllowed='copy';
            }} onClick={()=>add(n)}>+ {n}</Button>)}</div>
        <hr/><h4>Component Tree</h4><NodeTree node={doc.root} selected={selected} onSelect={setSelected} onMove={move}/>
      </aside>
      <main><div className="preview-head">
          <div className="template-picker"><span>화면 템플릿</span>
            <Select aria-label="화면 템플릿" value={template} style={{minWidth:180}}
              onChange={chooseTemplate}
              options={Object.entries(SCREEN_TEMPLATES).map(([value,x])=>({value,label:x.label}))}/>
          </div><div className="preview-options"><Tag color="blue">● Live Preview</Tag>
            <Button size="small" onClick={()=>setViewport(v=>v==='desktop'?'mobile':'desktop')}>
              {viewport==='desktop'?'모바일 보기':'데스크톱 보기'}</Button>
            <Button size="small" onClick={()=>setData(clone(sampleData))}>데이터 초기화</Button>
          </div></div>
        {pendingType&&<div className="placement-banner" role="status">
          <span>배치 모드: <strong>{getComponentManifest(pendingType,registry)?.designer?.label??pendingType}</strong> — 캔버스의 위치를 클릭하세요</span>
          <Button size="small" onClick={()=>setPendingType(null)}>취소 (Esc)</Button>
        </div>}
        {!checked.valid&&<Alert type="error" message={checked.errors.join('; ')} showIcon/>}
        <div className={'preview '+(viewport==='mobile'?'preview-mobile':'')}><DynamicView blueprint={doc} definitions={registry} reactComponents={codeRenderers}
          selectedNode={selected} onNodeSelect={setSelected} data={data}
          onDataChange={setData} actions={actions}
          viewport={viewport} pendingType={pendingType} onPlacement={place}
          onResizeSpan={(id,span)=>{
            try{setDocument(setGridSpan(doc,id,viewport,span));}
            catch(e){setError(e.message);}
          }}/></div>
        {saved&&<Alert type="success" showIcon message={'Save: '+saved}/>}
      </main>
      <aside className="inspector"><h3>속성 편집 <span className="eyebrow">INSPECTOR</span></h3>
        {item?<><Tag>{CONTROL_CATALOG[item.type]?.label||item.type}</Tag>
          <div className="inspector-tabs">
            {['props','bind','events'].map(tab=><button key={tab} type="button"
              className={inspectorTab===tab?'active':''} onClick={()=>setInspectorTab(tab)}>
              {({props:'속성',bind:'바인딩',events:'이벤트'})[tab]}
            </button>)}
          </div>
          {inspectorTab==='props'&&<>
            {selected!=='root'&&<div className="layout-controls">
              <strong>배치 및 크기</strong>
              <label>너비 방식
                <Select aria-label="너비 방식" size="small"
                  value={item.sizing?.mode??'fill'}
                  options={[{value:'hug',label:'Hug · 콘텐츠'},{value:'fill',label:'Fill · 공간 채우기'},
                    {value:'fixed',label:'Fixed · 고정 너비'}]}
                  onChange={mode=>changeSize(mode,item.sizing?.px??320)}/>
              </label>
              {item.sizing?.mode==='fixed'&&<label>고정 너비(px)
                <Input aria-label="고정 너비(px)" type="number" min={40} max={2400} size="small"
                  value={item.sizing.px} onChange={e=>changeSize('fixed',Number(e.target.value))}/>
              </label>}
              {selectedParent?.type==='Grid'&&<label>Grid 너비 ({viewport==='mobile'?'모바일':'데스크톱'})
                <Select aria-label="Grid 너비" size="small"
                  value={Math.min(viewport==='mobile'?1:Number(selectedParent.props?.columns)||2,
                    item.placement?.[viewport]?.span??1)}
                  options={Array.from({length:Math.min(12,viewport==='mobile'?1:Number(selectedParent.props?.columns)||2)},(_,i)=>({
                    value:i+1,label:(i+1)+'칸'
                  }))} onChange={changeSpan}/>
              </label>}
            </div>}
            <label>ID<Input disabled size="small" value={item.id}/></label>
            <label>데이터 범위<Input size="small" value={item.scope||''}
              placeholder="예: shipping" onChange={e=>editScope(e.target.value)}/></label>
            {Object.entries({...Object.fromEntries(
              Object.entries(currentManifest?.props??{})
                .map(([k,info])=>[k,info.default??''])
            ),...item.props}).map(([key,value])=>{
              const field=currentManifest?.props?.[key];
              const nice={label:'라벨',title:'제목',text:'텍스트',gap:'간격',columns:'열 개수',
                placeholder:'힌트 문구',primary:'기본 버튼',disabled:'비활성화',rows:'행 수',
                options:'선택 항목',items:'표시 항목',min:'최솟값',max:'최댓값',
                pageSize:'페이지 크기',percent:'진행률',value:'기본값',
                level:'제목 크기',direction:'분할 방향',color:'색상',type:'종류'};
              return <label key={key}>{field?.label||nice[key]||key}
                {field?.type==='enum'?<Select size="small" value={value}
                  options={field.options.map(v=>({value:v,label:v}))}
                  onChange={v=>edit('props',key,v)}/>:
                field?.type==='boolean'?<Select size="small" value={Boolean(value)}
                  options={[{value:true,label:'사용'},{value:false,label:'미사용'}]}
                  onChange={v=>edit('props',key,v)}/>:
                <Input size="small" value={String(value??'')}
                  onChange={e=>edit('props',key,field?.type==='number'||key==='gap'
                    ?Number(e.target.value):e.target.value)}/>}
              </label>;
            })}
          </>}
          {inspectorTab==='bind'&&<>
            <p className="inspector-hint">화면 요소에 데이터 필드를 연결합니다. 데이터는 미리보기에서 바로 바뀝니다.</p>
            {Object.entries({...Object.fromEntries(
              Object.keys(currentManifest?.bindings??{}).map(k=>[k,''])
            ),...item.bind}).map(([key,value])=><label key={key}>Binding: {key}
              <Select showSearch allowClear size="small" style={{width:'100%'}}
                placeholder="필드 선택" value={value||undefined}
                onChange={v=>edit('bind',key,v||'')}
                options={[...new Set([...pathOptions(data),'name','city','enabled'])].map(v=>({value:v,label:v}))}/>
            </label>)}
          </>}
          {inspectorTab==='events'&&<>
            <p className="inspector-hint">이벤트가 발생하면 등록된 동작을 실행합니다.</p>
            {Object.entries({...Object.fromEntries(
              Object.keys(currentManifest?.events??{}).map(k=>[k,''])
            ),...item.on}).map(([event])=><label key={event}>이벤트: {event}
              <Select size="small" value={item.on?.[event]||undefined}
                onChange={action=>edit('on',event,action)}
                options={[{label:'저장 (save)',value:'save'}]}/>
            </label>)}
          </>}
          <div className="inspector-commands">
            <Button size="small" disabled={selected==='root'} onClick={duplicate}>블록 복제</Button>
            <Button size="small" disabled={selected==='root'} onClick={extract}>컴포넌트로 추출</Button>
            <Button danger size="small" disabled={selected==='root'} onClick={remove}>선택 블록 삭제</Button>
          </div>
        </>:<span>블록을 선택하세요.</span>}
      </aside>
    </div>
    <div className="bottom"><Space style={{marginBottom:8}}>
      {['designer','json','code','data'].map(n=><Button key={n} size="small" type={mode===n?'primary':'default'} onClick={()=>setMode(n)}>{n}</Button>)}
    </Space>
    {mode==='designer'&&<Typography.Paragraph>① 도구상자에서 클릭 후 캔버스에 놓기 또는 직접 드래그 → ② 원하는 위치에 앞·뒤·내부 배치 → ③ Grid 너비·Hug·Fill·Fixed 조절 → ④ JSON·컴포넌트로 재사용. 
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
