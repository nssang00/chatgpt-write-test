// Canonical built-in component catalog. Every entry maps to an existing React/AntD control.
const prop=(type,defaultValue,options)=>({type,default:defaultValue,...(options?{options}:{} )});
export const CONTROL_CATALOG={
  Column:{group:'레이아웃',label:'세로 배치',icon:'column',container:true,props:{gap:prop('number',16)}},
  Row:{group:'레이아웃',label:'가로 배치',icon:'row',container:true,props:{gap:prop('number',16)}},
  Grid:{group:'레이아웃',label:'그리드',icon:'grid',container:true,props:{columns:prop('number',2),gap:prop('number',16)}},
  Panel:{group:'레이아웃',label:'패널 / 카드',icon:'panel',container:true,props:{title:prop('string','새 패널')}},
  SplitPanel:{group:'레이아웃',label:'분할 패널',icon:'split',container:true,props:{direction:prop('enum','horizontal',['horizontal','vertical'])}},
  Divider:{group:'레이아웃',label:'구분선',icon:'divider',props:{title:prop('string','')}},
  Tabs:{group:'레이아웃',label:'탭',icon:'tabs',container:true,props:{size:prop('enum','middle',['small','middle','large'])}},
  Heading:{group:'텍스트·표시',label:'제목',icon:'heading',props:{text:prop('string','새 섹션'),level:prop('number',3)}},
  Text:{group:'텍스트·표시',label:'텍스트',icon:'text',props:{text:prop('string','설명을 입력하세요'),strong:prop('boolean',false)}},
  Tag:{group:'텍스트·표시',label:'태그',icon:'tag',props:{text:prop('string','진행 중'),color:prop('enum','blue',['blue','green','red','orange','purple','default'])}},
  Alert:{group:'텍스트·표시',label:'안내 메시지',icon:'alert',props:{message:prop('string','안내 메시지'),description:prop('string',''),type:prop('enum','info',['info','success','warning','error'])}},
  Statistic:{group:'텍스트·표시',label:'지표 카드',icon:'statistic',props:{title:prop('string','전체 사용자'),value:prop('number',128),suffix:prop('string','명')}},
  Progress:{group:'텍스트·표시',label:'진행률',icon:'progress',props:{percent:prop('number',65),status:prop('enum','normal',['normal','success','exception','active'])}},
  Steps:{group:'텍스트·표시',label:'단계 표시',icon:'steps',props:{current:prop('number',1),items:prop('string','시작,검토,완료')}},
  TextField:{group:'입력',label:'텍스트 입력',icon:'input',props:{label:prop('string','이름'),placeholder:prop('string','값 입력'),disabled:prop('boolean',false)},bindings:{value:'shipping.name'}},
  PasswordField:{group:'입력',label:'비밀번호',icon:'input',props:{label:prop('string','비밀번호'),placeholder:prop('string','비밀번호 입력')}},
  TextArea:{group:'입력',label:'여러 줄 입력',icon:'input',props:{label:prop('string','설명'),placeholder:prop('string','내용 입력'),rows:prop('number',3)}},
  NumberField:{group:'입력',label:'숫자 입력',icon:'input',props:{label:prop('string','수량'),min:prop('number',0)}},
  Slider:{group:'입력',label:'슬라이더',icon:'slider',props:{label:prop('string','진행도'),min:prop('number',0),max:prop('number',100),defaultValue:prop('number',45)}},
  SelectField:{group:'입력',label:'선택 목록',icon:'select',props:{label:prop('string','부서'),placeholder:prop('string','항목 선택'),options:prop('string','개발팀,기획팀,운영팀')}},
  RadioGroup:{group:'입력',label:'라디오 그룹',icon:'radio',props:{label:prop('string','구분'),options:prop('string','개발팀,기획팀,운영팀')}},
  DateField:{group:'입력',label:'날짜 선택',icon:'calendar',props:{label:prop('string','시작일'),placeholder:prop('string','날짜 선택')}},
  CheckBox:{group:'입력',label:'체크박스',icon:'check',props:{label:prop('string','동의합니다')}},
  Switch:{group:'입력',label:'스위치',icon:'switch',props:{label:prop('string','사용 여부')}},
  Button:{group:'동작·데이터',label:'버튼',icon:'button',props:{label:prop('string','확인'),primary:prop('boolean',true)},events:{click:'save'}},
  Table:{group:'동작·데이터',label:'데이터 테이블',icon:'table',props:{title:prop('string','사용자 목록'),columns:prop('string','name,city'),pageSize:prop('number',5)},bindings:{data:'users'}},
  TreeView:{group:'동작·데이터',label:'트리 뷰',icon:'tree',props:{title:prop('string','탐색'),items:prop('string','프로젝트,화면,컴포넌트')}},
  ListView:{group:'동작·데이터',label:'목록 뷰',icon:'list',props:{title:prop('string','목록'),items:prop('string','첫 번째 항목,두 번째 항목,세 번째 항목')}},
};
export const CONTROL_GROUPS=['레이아웃','입력','텍스트·표시','동작·데이터'];
export const BUILTIN_NAMES=Object.freeze(Object.keys(CONTROL_CATALOG));
export const isContainer=type=>Boolean(CONTROL_CATALOG[type]?.container);
export const defaultNode=(type,id)=>{
  const meta=CONTROL_CATALOG[type];
  if(!meta)throw new Error('Unknown basic control: '+type);
  const props=Object.fromEntries(Object.entries(meta.props??{}).map(([name,spec])=>[name,spec.default]));
  const node={type,id,props};
  if(meta.bindings)node.bind={...meta.bindings};
  if(meta.events)node.on={...meta.events};
  if(meta.container)node.children=[];
  return node;
};
