import {StatusBadge} from './custom/StatusBadge.jsx';
import {defineReactComponent} from './component-kit.mjs';

/** Component code is imported by the app; it is never loaded from JSON. */
const registered=[
  defineReactComponent('StatusBadge', StatusBadge, {
    props:{
      label:{type:'string',label:'표시 이름',default:'상태'},
      tone:{type:'enum',label:'활성 색상',options:['green','blue','red'],default:'green'}
    },
    bindings:{active:{prop:'active'}}
  })
];
export const codeDefinitions=Object.fromEntries(registered.map(x=>[x.name,x.definition]));
export const codeRenderers=Object.fromEntries(registered.map(x=>[x.name,x.component]));
