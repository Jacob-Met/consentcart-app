import {sourceHeadingLabel} from './source.js';
import {termsFactRows,termsFactRowsForSection} from './terms-facts.js';
export function comparisonTopics(kept,current,keptSection=null,currentSection=null){
 const left=keptSection?termsFactRowsForSection(kept,keptSection.start):termsFactRows(kept),right=currentSection?termsFactRowsForSection(current,currentSection.start):termsFactRows(current);
 return [...new Set([...left,...right].map(row=>row.id))].map(id=>({id,label:[...left,...right].find(row=>row.id===id).label,kept:left.find(row=>row.id===id)||null,current:right.find(row=>row.id===id)||null}));
}
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
export function pairedConditionGroups(topic){
 const groups=row=>{
  const grouped=[...(row?.conditionClauses||[]),...(row?.additionalClauses||[])];
  if(grouped.length)return grouped;
  const byText=new Map();
  for(const passage of row?.passages||[]){const found=byText.get(passage.text);if(found)found.passages.push(passage);else byText.set(passage.text,{text:passage.text,passages:[passage]})}
  return [...byText.values()];
 };
 const kept=groups(topic.kept),current=groups(topic.current),shared=[];
 for(const left of kept){const right=current.find(entry=>entry.text===left.text);if(right)shared.push({text:left.text,kept:left.passages,current:right.passages})}
 const same=new Set(shared.map(entry=>entry.text));
 return {kept:kept.filter(entry=>!same.has(entry.text)),current:current.filter(entry=>!same.has(entry.text)),shared};
}
export function createComparisonTopics({kept,current,onReveal,onAsk}){
 if(!document.querySelector('link[data-comparison-topics]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/comparison-topics.css';css.dataset.comparisonTopics='';document.head.append(css)}
 const topics=comparisonTopics(kept.terms,current.terms,kept.sourceSection,current.sourceSection);
 const section=el('section',undefined,'comparison-topics');section.id='comparison-topics';section.setAttribute('aria-labelledby','comparison-topic-heading');
 const heading=el('div',undefined,'comparison-topic-heading'),title=el('h3','Compare a condition');title.id='comparison-topic-heading';
 const select=el('select');select.id='comparison-topic';select.setAttribute('aria-label','Condition to compare');for(const topic of topics){const option=el('option',topic.label);option.value=topic.id;select.append(option)}heading.append(title,select);section.append(heading);
 const readingNav=el('nav',undefined,'comparison-reading-nav');readingNav.setAttribute('aria-label','Read compared conditions');
 for(const [side,offer,label] of [['kept',kept,'Read kept offer'],['current',current,'Read current offer']]){
  const button=el('button',label);button.type='button';button.dataset.readConditionSide=side;
  button.setAttribute('aria-label','Read conditions for '+offer.itemName);
  button.onclick=()=>{
   const card=pair.querySelector('[data-topic-side='+side+']');
   if(!card)return;
   card.querySelector('h4')?.focus({preventScroll:true});
   card.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  };
  readingNav.append(button);
 }
 section.append(readingNav);
 const pair=el('div',undefined,'comparison-topic-pair');pair.setAttribute('aria-live','polite');section.append(pair);
 const shared=el('section',undefined,'comparison-topic-shared');section.append(shared);
 function actions(host,side,passages,shared=false){
  const offer=side==='kept'?kept:current,bar=el('div',undefined,'comparison-condition-actions');
  if(shared)bar.append(el('strong',offer.itemName));
  passages.forEach((passage,index)=>{
   const read=el('button',passages.length>1?'Read occurrence '+(index+1):'Read in full terms','ghost-button');read.type='button';read.onclick=()=>onReveal({side,start:passage.start,end:passage.end,from:read});bar.append(read);
  });
  if(onAsk){const ask=el('button','Ask about this condition','ghost-button comparison-topic-ask');ask.type='button';ask.onclick=()=>onAsk({side,passage:passages[0],button:ask});bar.append(ask)}
  host.append(bar);
 }
 function render(){
  pair.replaceChildren();shared.replaceChildren();const topic=topics.find(row=>row.id===select.value);if(!topic)return;
  const groups=pairedConditionGroups(topic);shared.hidden=!groups.shared.length;
  for(const [side,offer] of [['kept',kept],['current',current]]){
   const row=topic[side],card=el('section',undefined,'comparison-topic-card');card.dataset.topicSide=side;
   const offerHeading=el('h4',offer.itemName);offerHeading.tabIndex=-1;
   card.append(offerHeading,el('p',offer.merchant,'comparison-topic-merchant'));
   if(kept.sourceSection||current.sourceSection)card.append(el('p',offer.sourceSection?'Selected source section: '+sourceHeadingLabel(offer.terms,offer.sourceSection.start):'All pasted terms','comparison-section-scope'));
   if(row?.passages.length){
    card.append(el('strong',row.value,'comparison-topic-value'+(row.caution?' has-condition':'')));
    if(groups.shared.length)card.append(el('p',groups[side].length?'Different wording':'All indexed wording shared below','comparison-condition-label'));
    for(const entry of groups[side]){
     const block=el('div',undefined,'comparison-condition');block.append(el('blockquote',entry.text,'comparison-topic-quote'));actions(block,side,entry.passages);card.append(block);
    }
   }else{
    card.append(el('p','No indexed wording','comparison-topic-empty'));
    const read=el('button','Read full terms','ghost-button');read.type='button';read.onclick=()=>onReveal({side,start:0,end:0,from:read});card.append(read);
    if(onAsk){const ask=el('button','Ask about '+topic.label.toLowerCase(),'ghost-button comparison-topic-ask');ask.type='button';ask.onclick=()=>onAsk({side,topic:topic.label,button:ask});card.append(ask)}
   }
   pair.append(card);
  }
  if(groups.shared.length){
   shared.append(el('h4','Same wording in both offers'));
   for(const entry of groups.shared){
    const block=el('div',undefined,'comparison-condition');block.append(el('blockquote',entry.text,'comparison-topic-quote'));
    const tools=el('details',undefined,'comparison-shared-tools');tools.append(el('summary','Read or ask about this condition'));
    for(const side of ['kept','current'])actions(tools,side,entry[side],true);
    block.append(tools);shared.append(block);
   }
  }
 }
 select.addEventListener('change',render);render();return section;
}
