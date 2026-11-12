import {searchSourcePassages} from './source.js';
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n};
export function queryRanges(text,query,offset=0){
 const needle=query.trim();if(needle.length<2)return [];
 const pattern=new RegExp(needle.replace(/[.*+?^$()|[\]\\{}]/g,'\\$&'),'giu');
 return [...text.matchAll(pattern)].map(match=>({start:offset+match.index,end:offset+match.index+match[0].length}));
}
function markedRanges(target,text,ranges){
 target.replaceChildren();let offset=0;
 for(const range of ranges){target.append(document.createTextNode(text.slice(offset,range.start)),el('mark',text.slice(range.start,range.end)));offset=range.end}
 target.append(document.createTextNode(text.slice(offset)));
}
export function revealComparisonMatch(panel,{side,start,end,from,ranges}){
 const targets=ranges||((end>start)?[{start,end}]:[]);
 panel.querySelector(".comparison-source-return")?.remove();
 for(const row of panel.querySelectorAll('.comparison-source-row'))row.hidden=false;
 for(const [index,button] of [...panel.querySelectorAll('.comparison-filters button')].entries())button.setAttribute('aria-pressed',String(index===0));
 let offset=0,first=null;
 for(const paragraph of panel.querySelectorAll('.comparison-source-cell[data-side~="'+side+'"] .comparison-source')){
  const text=paragraph.textContent,next=offset+text.length;
  paragraph.textContent=text;
  if(!targets.length&&first===null)first=paragraph;
  const local=targets.filter(r=>r.start<next&&r.end>offset).map(r=>({start:Math.max(0,r.start-offset),end:Math.min(text.length,r.end-offset)}));
  if(local.length){markedRanges(paragraph,text,local);first??=paragraph}
  offset=next;
 }
 if(first){
  if(from){const back=el('button','Back to comparison','ghost-button comparison-source-return');back.type='button';const restore=()=>{back.remove();from.focus({preventScroll:true});from.scrollIntoView({block:'center',behavior:'instant'})};back.onclick=restore;back.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();restore()}});first.before(back);back.focus({preventScroll:true});(first.querySelector('mark')||back).scrollIntoView({block:'center',behavior:'instant'})}
  else{first.tabIndex=-1;first.focus({preventScroll:true});first.scrollIntoView({block:'center',behavior:'smooth'})}
 }
}
export function createComparisonFind({kept,current,onReveal}){
 if(!document.querySelector('link[data-comparison-find]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/comparison-find.css';css.dataset.comparisonFind='';document.head.append(css)}
 const details=el('details',undefined,'comparison-find source-find');details.id='comparison-find';
 details.append(el('summary','Find wording in both offers'));
 const form=el('form',undefined,'comparison-find-form'),label=el('label','Words in the original terms','source-find-label');
 const input=el('input');input.type='search';input.minLength=2;input.maxLength=160;input.required=true;input.placeholder='Refund, return postage…';input.id='comparison-find-query';label.htmlFor=input.id;
 const submit=el('button','Find','ghost-button');submit.type='submit';form.append(label,input,submit);details.append(form);
 const results=el('div',undefined,'comparison-find-results');results.setAttribute('aria-live','polite');details.append(results);
 form.addEventListener('submit',event=>{
  event.preventDefault();const query=input.value.trim();if(query.length<2)return;results.replaceChildren();
  for(const [side,offer] of [['kept',kept],['current',current]]){
   const hits=searchSourcePassages(offer.terms,query);let index=0;
   const column=el('section',undefined,'comparison-find-side');column.dataset.findSide=side;
   column.append(el('h3',offer.itemName),el('p',offer.merchant,'comparison-find-merchant'));
   const position=el('p',undefined,'comparison-find-count'),context=el('blockquote',undefined,'comparison-find-context');
   const actions=el('div',undefined,'comparison-find-actions');
   const previous=el('button','Previous','ghost-button'),next=el('button','Next','ghost-button'),read=el('button','Read in full terms','ghost-button');
   for(const button of [previous,next,read])button.type='button';
   function show(){
    const hit=hits[index],ranges=hit?queryRanges(hit.text,query):[];position.textContent=hits.length?(index+1)+' of '+hits.length+' matching passages · '+ranges.length+' '+(ranges.length===1?'match':'matches'):'No matching wording';
    context.hidden=!hit;actions.hidden=!hit;previous.disabled=index===0;next.disabled=index===hits.length-1;
    if(hit){
     markedRanges(context,hit.text,ranges);
     requestAnimationFrame(()=>{const mark=context.querySelector('mark');if(mark)context.scrollTop+=mark.getBoundingClientRect().top-context.getBoundingClientRect().top-context.clientHeight/3});
    }
   }
   previous.onclick=()=>{if(index>0){index--;show()}};
   next.onclick=()=>{if(index<hits.length-1){index++;show()}};
   read.onclick=()=>{const hit=hits[index];if(hit)onReveal({side,ranges:queryRanges(hit.text,query,hit.start),from:read})};
   actions.append(previous,next,read);column.append(position,context,actions);results.append(column);show();
  }
 });return details;
}
