import {validateBlueprint} from './blueprint.mjs';
import {findNode,visitNodes} from './commands.mjs';
import {isContainer} from './catalog.mjs';

const copy=value=>structuredClone(value);
export const SIZE_MODES=['hug','fill','fixed'];
export const DROP_SIDES=['before','after','inside'];
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Placement is editor metadata; ordinary React component props remain untouched. */
export function validateLayoutNode(node){
  const errors=[];
  if(node.placement!==undefined){
    if(!isRecord(node.placement))errors.push('Invalid placement');
    else for(const [breakpoint,place] of Object.entries(node.placement)){
      if(breakpoint==='free'){
        if(!isRecord(place)||['x','y','width','height'].some(k=>
          !Number.isFinite(place[k])||place[k]<0||place[k]>2400)||
          place.width<40||place.height<24)errors.push('Invalid free placement');
      }else if(!['desktop','mobile'].includes(breakpoint)||!isRecord(place)||
        !Number.isInteger(place.span)||place.span<1||place.span>12)
        errors.push('Invalid grid span for '+breakpoint);
    }
  }
  if(node.sizing!==undefined){
    if(!isRecord(node.sizing)||!SIZE_MODES.includes(node.sizing.mode)||
      (node.sizing.mode==='fixed'&&(!Number.isFinite(node.sizing.px)||
       node.sizing.px<40||node.sizing.px>2400)))
      errors.push('Invalid node sizing');
  }
  return errors;
}
export function setNodeSizing(doc,id,mode,px){
  if(!SIZE_MODES.includes(mode))throw new Error('Unknown sizing mode');
  const result=copy(doc);
  const target=findNode(result,id);
  if(!target)throw new Error('Unknown node: '+id);
  target.sizing=mode==='fixed'?{mode,px:Math.max(40,Math.min(2400,Math.round(Number(px)||320)))}:{mode};
  return result;
}
export function setGridSpan(doc,id,breakpoint,span){
  if(!['desktop','mobile'].includes(breakpoint)||!Number.isInteger(span)||span<1||span>12)
    throw new Error('Invalid grid span');
  const result=copy(doc),target=findNode(result,id);
  if(!target)throw new Error('Unknown node: '+id);
  target.placement??={};
  target.placement[breakpoint]={...(target.placement[breakpoint]??{}),span};
  return result;
}
export function setFreePlacement(doc,id,{x,y,width,height}){
  const next=copy(doc),target=findNode(next,id);
  if(!target)throw new Error('Unknown node: '+id);
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,Math.round(Number(n)||0)));
  target.placement??={};
  target.placement.free={
    x:clamp(x,0,2400),y:clamp(y,0,2400),
    width:clamp(width,40,2400),height:clamp(height,24,2400)
  };
  return next;
}
export function getGridSpan(node,viewport,columns){
  if(viewport==='mobile')return 1;
  return Math.max(1,Math.min(Math.max(1,columns),
    node.placement?.desktop?.span??1));
}
function locateParent(root,id){
  let location=null;
  visitNodes(root,parent=>{
    const index=parent.children?.findIndex(child=>child.id===id)??-1;
    if(index>=0)location={parent,index};
  });
  return location;
}
/** Exact placement command shared by clicking, drag/drop, and future keyboard operations. */
export function placeNode(doc,{sourceId,node,targetId,side='inside',definitions={}}){
  if(!DROP_SIDES.includes(side))throw new Error('Unknown drop position');
  if(Boolean(sourceId)===Boolean(node))throw new Error('Provide exactly one source');
  if(sourceId===doc.root.id)throw new Error('Cannot move root');
  const result=copy(doc);
  let target=findNode(result,targetId);
  if(!target)throw new Error('Unknown drop target: '+targetId);
  let placed;
  if(sourceId){
    const source=findNode(result,sourceId);
    if(!source)throw new Error('Unknown source: '+sourceId);
    if(sourceId===targetId)throw new Error('Cannot drop onto itself');
    let cycle=false;
    visitNodes(source,item=>{if(item.id===targetId)cycle=true;});
    if(cycle)throw new Error('Cannot drop into descendant');
    placed=copy(source);
    const old=locateParent(result.root,sourceId);
    if(!old)throw new Error('Missing source parent');
    old.parent.children.splice(old.index,1);
    target=findNode(result,targetId);
  }else{
    placed=copy(node);
    if(!placed?.id||findNode(result,placed.id))throw new Error('Duplicate or missing new node ID');
  }
  let parent,index;
  if(side==='inside'){
    parent=target;
    index=(parent.children??[]).length;
  }else{
    const slot=locateParent(result.root,targetId);
    if(!slot)throw new Error('Cannot insert before or after root');
    parent=slot.parent;
    index=slot.index+(side==='after'?1:0);
  }
  const accepts=isContainer(parent.type)||Boolean(definitions[parent.type]?.manifest?.slots?.children);
  if(!accepts)throw new Error('Target does not accept children: '+parent.type);
  parent.children??=[];
  parent.children.splice(index,0,placed);
  const check=validateBlueprint(result,definitions);
  if(!check.valid)throw new Error(check.errors.join('; '));
  return result;
}
/** Decide insertion from a pointer in a rendered item (not from a fixed column slot). */
export function suggestDropSide({x,y,width,height},px,py,{container=false,direction='vertical'}={}){
  const nearTop=(py-y)/Math.max(1,height);
  const nearLeft=(px-x)/Math.max(1,width);
  if(container&&nearTop>.23&&nearTop<.77&&nearLeft>.16&&nearLeft<.84)return 'inside';
  const progress=direction==='horizontal'?nearLeft:nearTop;
  return progress<.5?'before':'after';
}
