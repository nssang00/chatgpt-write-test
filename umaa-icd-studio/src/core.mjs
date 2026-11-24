import {demoLibrary} from './demo.mjs';
export const schemaVersion=1;
export const primitive = new Set(['boolean','octet','char','wchar','short','unsigned short','long','unsigned long','long long','unsigned long long','float','double','long double','string','wstring','int8','uint8','int16','uint16','int32','uint32','int64','uint64']);
const nonempty=x=>typeof x==='string'&&x.trim().length>0;
const unique=(a)=>new Set(a).size===a.length;
const str=(x)=>typeof x==='string';
const optionalStrings=(o,keys)=>keys.every(k=>o[k]===undefined||str(o[k]));
export function checkLibrary(l){
  if(!l||!nonempty(l.name)||!nonempty(l.version)||!nonempty(l.source)||!Array.isArray(l.services)||!Array.isArray(l.types)) throw Error('라이브러리 name, version, source, services[], types[]가 필요합니다.');
  for(const s of l.services){if(!s||![s.id,s.area,s.name,s.pattern].every(nonempty)||!Array.isArray(s.topics)||!optionalStrings(s,['description']))throw Error('서비스 필수 속성이 누락되었습니다.');
    for(const t of s.topics)if(!t||![t.id,t.name,t.type,t.role].every(nonempty)||!optionalStrings(t,['description']))throw Error('Topic 필수 속성이 누락되었습니다.');}
  for(const t of l.types){if(!t||!nonempty(t.name)||!Array.isArray(t.fields))throw Error('타입 name 및 fields[]가 필요합니다.');
    for(const f of t.fields)if(!f||!nonempty(f.name)||!nonempty(f.type)|| (f.key!==undefined&&typeof f.key!=='boolean')||!optionalStrings(f,['unit','description']))throw Error('필드 name/type 또는 key 형식 오류');
    if(!unique(t.fields.map(f=>f.name)))throw Error('중복 필드: '+t.name);}
  if(!unique(l.services.map(s=>s.id))||!unique(l.services.flatMap(s=>s.topics.map(t=>t.id)))||!unique(l.types.map(t=>t.name)))throw Error('서비스 ID, Topic ID 또는 타입명 중복');
  return l;
}
export const allTopics=l=>l.services.flatMap(s=>s.topics.map(t=>({...t,serviceId:s.id,serviceName:s.name,area:s.area,pattern:s.pattern})));
export const newBinding=t=>({topicId:t.id,publisher:'',subscriber:'',reliability:'',durability:'',rate:'',notes:''});
export const freshProject=(library=demoLibrary,seed=false)=>({schemaVersion,library,meta:{title:'Interface Control Document',project:'Demo Integration',number:'ICD-001',revision:'0.1',author:'',status:'Draft',scope:'시스템 간 인터페이스 및 데이터 정의',domainId:0},components:['Sensor Adapter','Monitoring UI'],bindings:seed?[{...newBinding(allTopics(library)[0]),publisher:'Sensor Adapter',subscriber:'Monitoring UI',reliability:'RELIABLE',durability:'VOLATILE',rate:'1'}]:[]});
export function checkProject(p){
  if(!p||p.schemaVersion!==schemaVersion||!p.meta||!Array.isArray(p.components)||!Array.isArray(p.bindings))throw Error('지원하지 않는 프로젝트 형식입니다.');
  checkLibrary(p.library);
  if(!['title','project','number','revision','author','status','scope'].every(k=>str(p.meta[k]))||!(p.meta.domainId===null||Number.isInteger(p.meta.domainId)))throw Error('문서 속성 형식 오류');
  if(!p.components.every(nonempty)||!unique(p.components)||!unique(p.bindings.map(b=>b?.topicId)))throw Error('구성요소 또는 Topic ID 중복/오류');
  for(const b of p.bindings)if(!b||!['topicId','publisher','subscriber','reliability','durability','rate','notes'].every(k=>str(b[k])))throw Error('인터페이스 속성 형식 오류');
  return p;
}
export function typeRefs(type){
  // Normalized model: primitive, qualified named type, sequence<T[,N]>, T[N], bounded string<N>.
  let s=type.trim().replace(/\s*\[\s*\d+\s*\]\s*$/,'');
  if(/^(w?string)\s*<\s*\d+\s*>$/.test(s))return [];
  const seq=s.match(/^sequence\s*<(.+)>$/);if(seq)return typeRefs(seq[1].replace(/,\s*\d+\s*$/,''));
  return primitive.has(s)?[]:[s];
}
export function resolveTypes(l, roots){const lookup=new Map(l.types.map(t=>[t.name,t])),seen=new Set(),found=[],missing=new Set();
  const visit=n=>{if(seen.has(n))return;seen.add(n);const t=lookup.get(n);if(!t){missing.add(n);return;}found.push(t);t.fields.forEach(f=>typeRefs(f.type).forEach(visit));};
  roots.forEach(visit);return {found,missing:[...missing]};
}
export function validate(p){const topics=new Map(allTopics(p.library).map(t=>[t.id,t])),issues=[];const add=(severity,where,message)=>issues.push({severity,where,message});
  for(const k of ['title','project','number','revision'])if(!nonempty(p.meta[k]))add('error','문서',`${k} 필수 입력`);
  if(!Number.isInteger(p.meta.domainId)||p.meta.domainId<0||p.meta.domainId>232)add('error','문서','DDS Domain ID는 MVP 정책상 0~232 정수');
  if(!p.bindings.length)add('error','문서','인터페이스를 1개 이상 선택하세요.');
  for(const b of p.bindings){const t=topics.get(b.topicId),where=t?.name??b.topicId;if(!t){add('error',where,'라이브러리에 없는 Topic');continue;}
    for(const k of ['publisher','subscriber'])if(!p.components.includes(b[k]))add('error',where,`${k} 구성요소 미지정 또는 미등록`);
    if(b.publisher&&b.publisher===b.subscriber)add('warning',where,'Publisher와 Subscriber가 동일합니다. 의도를 확인하세요.');
    if(!['RELIABLE','BEST_EFFORT'].includes(b.reliability))add('warning',where,'Reliability 미확정/미지원');
    if(!['VOLATILE','TRANSIENT_LOCAL','TRANSIENT','PERSISTENT'].includes(b.durability))add('warning',where,'Durability 미확정/미지원');
    if(b.rate!==''&&(!Number.isFinite(Number(b.rate))||Number(b.rate)<=0))add('error',where,'주기는 양수 Hz 또는 공란이어야 합니다.');
    for(const n of resolveTypes(p.library,[t.type]).missing)add('error',where,`타입 미해결: ${n}`);
  }return issues;
}
export const selectedTopics=p=>p.bindings.map(b=>({...b,topic:allTopics(p.library).find(t=>t.id===b.topicId)}));
const cell=x=>String(x??'').replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
const row=a=>'| '+a.map(cell).join(' | ')+' |';
export function markdown(p){const m=p.meta,selected=selectedTopics(p),issues=validate(p),types=resolveTypes(p.library,selected.filter(x=>x.topic).map(x=>x.topic.type)).found;
  const lines=[`# ${m.title}`,'','> Project ICD draft. Not an official UMAA specification or compliance certification.','',`- Project: ${m.project}`,`- Document: ${m.number} / Rev ${m.revision}`,`- Status: ${m.status}`,`- Author: ${m.author}`,`- Library: ${p.library.name} @ ${p.library.version}`,`- Source: ${p.library.source}`,`- DDS Domain ID: ${m.domainId??'TBD'}`,'','## 1. Scope',m.scope,'','## 2. Components',...p.components.map(x=>`- ${x}`),'','## 3. Interface matrix',row(['Service','Topic','Role','Data type','Publisher','Subscriber','Reliability','Durability','Rate (Hz)','Notes']),row(Array(10).fill('---')),...selected.map(b=>row([b.topic?.serviceName,b.topic?.name??b.topicId,b.topic?.role,b.topic?.type,b.publisher,b.subscriber,b.reliability||'TBD',b.durability||'TBD',b.rate||'TBD',b.notes])),'','## 4. Data dictionary'];
  for(const t of types)lines.push('',`### ${t.name}`,row(['Field','Type','Key','Unit','Description']),row(Array(5).fill('---')),...t.fields.map(f=>row([f.name,f.type,f.key?'Yes':'No',f.unit,f.description])));
  lines.push('','## 5. Validation (local checks only)',...(issues.length?issues.map(i=>`- [${i.severity.toUpperCase()}] ${i.where}: ${i.message}`):['- No local issues detected.']), '', 'Protocol behavior, QoS compatibility, official UMAA compliance and IDL compiler checks are outside this MVP.');return lines.join('\n');
}
export function csv(p){const q=v=>'"'+String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';return '\uFEFF'+[['Service','Topic','Role','Data type','Publisher','Subscriber','Reliability','Durability','Rate (Hz)','Notes'],...selectedTopics(p).map(b=>[b.topic?.serviceName,b.topic?.name??b.topicId,b.topic?.role,b.topic?.type,b.publisher,b.subscriber,b.reliability,b.durability,b.rate,b.notes])].map(a=>a.map(q).join(',')).join('\r\n');}
