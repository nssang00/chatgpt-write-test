import {initialBlueprint,initialDefinitions,sampleData} from './examples.mjs';
export {initialDefinitions,sampleData};

const copy=x=>structuredClone(x);
const field=(type,id,label,binding,other={})=>({
  type,id,props:{label,...(other.props||{})},
  ...(binding?{bind:{[type==='CheckBox'||type==='Switch'?'checked':'value']:binding}}:{}),
  ...('on' in other?{on:other.on}: {})
});
const btn=(id,label='저장')=>({type:'Button',id,props:{label,primary:true},on:{click:'save'}});
const stat=(id,title,value,suffix='명')=>({type:'Statistic',id,props:{title,value,suffix}});
const heading=(id,text,level=2)=>({type:'Heading',id,props:{text,level}});
const col=(id,children,gap=16)=>({type:'Column',id,props:{gap},children});
const row=(id,children,gap=16)=>({type:'Row',id,props:{gap},children});
const panel=(id,title,children)=>({type:'Panel',id,props:{title},children});

const workspace=copy(initialBlueprint);
workspace.name='사용자 관리';
workspace.root.children=[
  heading('pageHeading','사용자 관리',2),
  {type:'Text',id:'description',props:{text:'고객 정보와 계정 상태를 한곳에서 관리합니다.'}},
  {type:'Grid',id:'metrics',props:{columns:3,gap:14},children:[
    stat('metricOne','전체 사용자',128),
    stat('metricTwo','활성 계정',109),
    stat('metricThree','이번 달 신규',24)
  ]},
  {type:'Table',id:'users',props:{title:'사용자 목록',columns:'name,city,enabled',pageSize:5},bind:{data:'users'}},
  heading('addressHeading','재사용 가능한 주소 편집기',4),
  {type:'Text',id:'addressExplain',props:{text:'같은 AddressEditor 블록을 두 번 사용하며 각자 별도의 데이터에 연결됩니다.'}},
  row('forms',[
    {type:'AddressEditor',id:'shipping',scope:'shipping',props:{title:'배송지'}},
    {type:'AddressEditor',id:'billing',scope:'billing',props:{title:'청구지'}}
  ],14)
];

const form={
  schemaVersion:1,name:'고객 등록 폼',
  root:col('root',[
    heading('formHeading','신규 고객 등록',2),
    {type:'Text',id:'formSub',props:{text:'기본 입력 컴포넌트를 선택하고 데이터와 연결하는 예제입니다.'}},
    panel('clientPanel','고객 정보',[
      row('contactRow',[
        field('TextField','clientName','이름','contact.name',{props:{placeholder:'이름 입력'}}),
        field('TextField','clientEmail','이메일','contact.email',{props:{placeholder:'example@company.com'}})
      ]),
      row('orgRow',[
        field('SelectField','clientTeam','담당 부서','contact.department',{props:{options:'개발팀,기획팀,운영팀'}}),
        field('DateField','clientDate','등록일','contact.createdAt')
      ]),
      field('TextArea','clientNote','메모','contact.note',{props:{rows:4,placeholder:'메모 입력'}}),
      {type:'CheckBox',id:'clientActive',props:{label:'활성 고객'},bind:{checked:'contact.enabled'}},
      btn('saveClient','고객 저장')
    ])
  ])
};

const dashboard={
  schemaVersion:1,name:'데이터 대시보드',
  root:col('root',[
    heading('dashHeading','운영 대시보드',2),
    {type:'Text',id:'dashSub',props:{text:'통계·상태·테이블 컴포넌트를 조립한 예제입니다.'}},
    {type:'Grid',id:'dashCards',props:{columns:3,gap:16},children:[
      stat('statA','누적 방문자',12480,'명'),stat('statB','진행 중 작업',37,'건'),stat('statC','완료율',84,'%')
    ]},
    row('dashBody',[
      panel('salesPanel','이번 달 목표',[
        {type:'Progress',id:'goal',props:{percent:78,status:'active'}},
        {type:'Text',id:'goalMsg',props:{text:'목표 달성까지 22% 남았습니다.'}}
      ]),
      panel('noticePanel','시스템 알림',[
        {type:'Alert',id:'notice',props:{type:'success',message:'시스템 정상 운영 중',description:'마지막 동기화가 완료되었습니다.'}},
        {type:'Tag',id:'noticeTag',props:{text:'정상',color:'green'}}
      ])
    ]),
    {type:'Table',id:'activity',props:{title:'최근 사용자',columns:'name,city,enabled',pageSize:5},bind:{data:'users'}}
  ])
};

const blank={schemaVersion:1,name:'빈 화면',root:col('root',[
  heading('startHeading','새 화면',2),
  {type:'Text',id:'startText',props:{text:'왼쪽 도구상자에서 컴포넌트를 추가해 보세요.'}}
])};

export const SCREEN_TEMPLATES={
  workspace:{label:'사용자 관리',description:'테이블 · 카드 · 재사용 폼',blueprint:workspace},
  form:{label:'고객 등록 폼',description:'필드 · 데이터 바인딩 · 저장',blueprint:form},
  dashboard:{label:'운영 대시보드',description:'지표 · 진행률 · 알림',blueprint:dashboard},
  blank:{label:'빈 화면',description:'원하는 구성으로 시작',blueprint:blank}
};
export const templateNames=()=>Object.keys(SCREEN_TEMPLATES);
export const getTemplate=(name)=>copy(SCREEN_TEMPLATES[name]?.blueprint??workspace);
