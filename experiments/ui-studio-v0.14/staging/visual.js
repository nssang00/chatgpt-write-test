/** v0.14 visual authoring primitives. No UI library or JSX dependency.
 * Registry metadata -> JSON Schema/field editors; selections -> canonical v6 IR.
 */
import {binding, literal, safePath, validateDocument} from '../schema/index.js';
import {patchEditorNode} from './editor.js';
import {readProperty} from './binding.js';

const PROP_TYPES={string:'string',number:'number',boolean:'boolean',enum:'string',color:'string',object:'object',array:'array'};
const forbidden=new Set(['__proto__','prototype','constructor']);
export function inspectorSchema(registry,typeId){
  const control=registry.get(typeId);
  if(!control)throw Error('등록되지 않은 컨트롤');
  const properties={};const required=[];
  for(const [key,spec] of Object.entries(control.properties||{})){
    const item={type:PROP_TYPES[spec.type],title:spec.title||key};
    if(spec.defaultValue!==undefined)item.default=structuredClone(spec.defaultValue);
    if(spec.type==='enum')item.enum=[...spec.options];
    if(spec.type==='color')item.format='color';
    if(spec.description)item.description=spec.description;
    if(spec.required)required.push(key);
    properties[key]=item;
  }
  return {schema:{type:'object',title:control.displayName,properties,...(required.length?{required}:{})},ui:Object.fromEntries(Object.entries(control.properties||{}).map(([name,spec])=>[name,{widget:spec.editor||(spec.type==='boolean'?'switch':spec.type==='enum'?'select':spec.type==='array'?'array':spec.type==='object'?'object':'text'),bindable:!!spec.bindable,twoWay:!!spec.twoWay}]))};
}

function inferType(value){return value===null?'null':Array.isArray(value)?'array':typeof value;}
function collect(out,source,value,path=[],depth=0){
  if(depth>6||out.length>150)return;
  if(path.length)out.push({source,path:[...path],type:inferType(value),label:`${source}.${path.join('.')}`});
  if(Array.isArray(value)&&value[0]&&typeof value[0]==='object'&&!Array.isArray(value[0])&&source!=='context')collect(out,'context',value[0],['item'],0);
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    for(const [key,child] of Object.entries(value))if(!forbidden.has(key))collect(out,source,child,[...path,key],depth+1);
  }
}
export function visualDataChoices(doc,definitionId=null){
  const choices=[];
  collect(choices,'state',doc.data.state);
  collect(choices,'sources',doc.data.sources);
  if(definitionId&&doc.definitions[definitionId]){
    const api=doc.definitions[definitionId].publicProps;
    for(const [name,meta] of Object.entries(api)){
      if(forbidden.has(name))continue;
      choices.push({source:'props',path:[name],type:meta.type,label:`props.${name}`});
      if(meta.type==='array' && Array.isArray(meta.defaultValue)&&meta.defaultValue[0]&&typeof meta.defaultValue[0]==='object'){
        collect(choices,'context',meta.defaultValue[0],['item']);
      }
    }
  }
  return choices;
}
export function compatibleChoices(choices,expected){
  if(!expected||expected==='any')return choices;
  return choices.filter(c=>c.type===expected || (expected==='color'&&c.type==='string') || (expected==='enum'&&c.type==='string'));
}
export function providerForChoice(choice,{twoWay=false}={}){
  if(!choice||!['state','sources','props','context','local'].includes(choice.source)||!safePath(choice.path))throw Error('잘못된 데이터 연결');
  if(twoWay&&!['state','props','local'].includes(choice.source))throw Error('읽기 전용 데이터에 TwoWay 연결 불가');
  return binding(choice.source,choice.path,twoWay?'TwoWay':'OneWay');
}
export function configureVisibility(doc,nodeId,choice,registry,scope='main'){
  return patchEditorNode(doc,nodeId,node=>({...node,when:choice?providerForChoice(choice):undefined}),registry,scope);
}
export function configureRepeat(doc,nodeId,choice,keyPath,registry,scope='main'){
  if(choice && choice.type!=='array')throw Error('목록 반복에는 배열 데이터가 필요합니다');
  if(keyPath && !safePath(keyPath))throw Error('반복 항목의 고유 키 경로 오류');
  return patchEditorNode(doc,nodeId,node=>({...node,repeat:choice?{items:providerForChoice(choice),...(keyPath?.length?{keyPath}:{})}:undefined}),registry,scope);
}
export function setControlAction(doc,nodeId,event,action,registry,scope='main'){
  return patchEditorNode(doc,nodeId,node=>{
    if(node.kind!=='component'||!registry.get(node.typeId)?.events?.[event])throw Error('지원하지 않는 컨트롤 이벤트');
    const events={...node.events};if(action)events[event]=structuredClone(action);else delete events[event];
    return {...node,events};
  },registry,scope);
}
/** Static and SDUI consumption read the same canonical Document. No code eval. */
export function configureStateField(doc,name,initialValue,registry){
  if(!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name)||forbidden.has(name))throw Error('잘못된 데이터 필드 이름');
  if(Object.hasOwn(doc.data.state,name))throw Error('이미 있는 데이터 필드');
  if(!['string','number','boolean'].includes(typeof initialValue)&&!Array.isArray(initialValue))throw Error('지원하지 않는 데이터 타입');
  const next=structuredClone(doc);next.data.state[name]=structuredClone(initialValue);
  return validateDocument(next,registry);
}
export function stateAction(target,value){
  if(!target||!['state','local'].includes(target.source)||!safePath(target.path))throw Error('동작 대상은 State 또는 컴포넌트 내부 상태만 가능합니다');
  if(!value||!['literal','binding'].includes(value.kind))throw Error('동작 값은 고정값 또는 데이터 연결만 가능합니다');
  if(value.kind==='binding'&&value.mode!=='OneWay')throw Error('동작의 입력 값은 읽기 전용으로 연결하세요');
  return {kind:'set',target:{source:target.source,path:[...target.path]},value:structuredClone(value)};
}
export function runControlAction(action,scope,resources={}){
  if(!action||action.kind!=='set')return false;
  const checked=stateAction(action.target,action.value);
  const store=scope.resolve(checked.target.source);
  if(!store)throw Error('상태 저장소가 없습니다');
  store.set(checked.target.path,readProperty(checked.value,scope,resources));
  return true;
}
