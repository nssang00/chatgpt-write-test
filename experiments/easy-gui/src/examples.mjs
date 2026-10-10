export const sampleData = {
  shipping:{name:'김민수',city:'서울',enabled:true},
  billing:{name:'이서연',city:'부산',enabled:false},
  users:[
    {id:1,name:'김민수',city:'서울',enabled:true},
    {id:2,name:'이서연',city:'부산',enabled:false},
    {id:3,name:'박서준',city:'대전',enabled:true},
    {id:4,name:'최유진',city:'광주',enabled:true},
    {id:5,name:'정지훈',city:'인천',enabled:true},
    {id:6,name:'한수연',city:'대구',enabled:false}
  ],
  contact:{name:'김하늘',email:'hello@example.com',department:'개발팀',
    createdAt:'2026-10-10',note:'신규 고객의 요청 사항을 기록합니다.',enabled:true}
};
export const initialDefinitions = {
  AddressEditor:{root:{type:'Panel',props:{title:'주소 편집'},children:[
    {type:'TextField',id:'name',props:{label:'이름'},bind:{value:'name'}},
    {type:'TextField',id:'city',props:{label:'도시'},bind:{value:'city'}},
    {type:'Switch',id:'enabled',props:{label:'활성화'},bind:{checked:'enabled'}},
    {type:'Button',id:'save',props:{label:'저장'},on:{click:'save'}}
  ]}}
};
export const initialBlueprint = {schemaVersion:1,name:'Demo',root:{
  type:'Column',id:'root',props:{gap:16},children:[
    {type:'Text',id:'title',props:{text:'하나의 컴포넌트, 서로 다른 데이터'}},
    {type:'Row',id:'forms',props:{gap:16},children:[
      {type:'AddressEditor',id:'shipping',scope:'shipping',props:{title:'배송지'}},
      {type:'AddressEditor',id:'billing',scope:'billing',props:{title:'청구지'}}
    ]},
    {type:'Table',id:'users',props:{title:'사용자 목록'},bind:{data:'users'}}
  ]
}};
