import {savedSourceSection} from './saved-review.js';
import {createComparisonTopics} from './comparison-topics.js';
import {readComparisonDraft,writeComparisonDraft,clearComparisonDraft,comparisonDraftStore} from './comparison-draft.js';
import {createComparisonFind,revealComparisonMatch} from './comparison-find.js';
export function comparisonSnapshot(review,questions=review.buyerQuestions||[],sourceSection=review.sourceSection){
 const {merchant,itemName,amountCents,terms}=review.offer;
 const section=savedSourceSection(terms,sourceSection);
 return structuredClone({offer:{merchant,itemName,amountCents,terms},analysis:review.analysis,buyerQuestions:questions,...(section?{sourceSection:section}:{})});
}
export function priceDifference(saved,current){const prices=[saved.offer.amountCents,current.offer.amountCents];return prices.every(value=>Number.isSafeInteger(value)&&value>0&&value<=1000000)?prices[1]-prices[0]:null}
// Align exact original sentences. Matching ignores surrounding whitespace only;
// every original character remains in its side of the returned rows.
export function compareOriginalTerms(kept,current){
 const split=text=>[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(text)].map(x=>x.segment);
 const a=split(kept),b=split(current),n=a.length,m=b.length;
 // Bound sentence alignment work without discarding any original text.
 if(n*m>1_000_000)return [{kept,current,changed:kept!==current,coarse:true}];
 const lengths=Array.from({length:n+1},()=>new Uint16Array(m+1));
 for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)lengths[i][j]=a[i].trim()===b[j].trim()?lengths[i+1][j+1]+1:Math.max(lengths[i+1][j],lengths[i][j+1]);
 const rows=[];let i=0,j=0,left='',right='';
 const flush=()=>{if(left||right){rows.push({kept:left,current:right,changed:true});left='';right=''}};
 while(i<n||j<m){
  if(i<n&&j<m&&a[i].trim()===b[j].trim()){flush();rows.push({kept:a[i++],current:b[j++],changed:false})}
  else if(i<n&&(j===m||lengths[i+1][j]>=lengths[i][j+1]))left+=a[i++];
  else right+=b[j++];
 }
 flush();return rows;
}
const money=cents=>Number.isFinite(cents)&&cents>0?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100):'Price not entered';
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
export function createOfferComparison({reviewElement,before,onEdit=()=>{},onRead=()=>{},onCompare=()=>{},onChoose=()=>{},readQuestions=()=>null,readSourceSection=()=>undefined,resumeAfter=null}){
 let saved=null,current=null,onlyChanges=false,choiceObserver=null,choiceResize=null;
 const storage=comparisonDraftStore();let draft=readComparisonDraft(storage);
 const resume=document.createElement('details');resume.id='resume-comparison';resume.className='recent-reviews';resume.hidden=!draft;
 const summary=node('summary','Resume comparison');resume.append(summary);
 const identity=node('p',draft?draft.saved.offer.merchant+' · '+draft.saved.offer.itemName+' / '+draft.current.offer.merchant+' · '+draft.current.offer.itemName:'','recent-review-help');identity.style.overflowWrap='anywhere';resume.append(identity);
 const restore=node('button','Open these two offers','ghost-button');restore.type='button';restore.id='restore-comparison';
 const forget=node('button','Forget comparison','ghost-button');forget.type='button';forget.id='forget-comparison';
 const resumeActions=node('div',undefined,'recent-review-actions');resumeActions.append(restore,forget);resume.append(resumeActions);
 const resumeStatus=node('p','','recent-review-status');resumeStatus.setAttribute('role','status');resume.append(resumeStatus);
 resumeAfter?.after(resume);
 restore.onclick=()=>{if(!draft)return;saved=comparisonSnapshot(draft.saved);const chosen=draft.current;resume.hidden=true;onChoose(chosen.offer,chosen.buyerQuestions,chosen.sourceSection||null);open()};
 forget.onclick=()=>{if(clearComparisonDraft(storage)){draft=null;resume.hidden=true}else resumeStatus.textContent='This browser could not remove the saved comparison. Try again before leaving.'};
 const toolbar=node('div',undefined,'comparison-entry');
 const keep=node('button','Compare another offer','ghost-button');keep.id='keep-offer';keep.type='button';
 const jump=node('button','Compare offers','ghost-button hidden');jump.id='compare-kept-offer';jump.type='button';toolbar.append(keep,jump);reviewElement.append(toolbar);
 const draftStatus=node('p','','recent-review-status');draftStatus.setAttribute('role','status');draftStatus.id='comparison-draft-status';resumeAfter?resumeAfter.after(draftStatus):toolbar.append(draftStatus);
 function remember(){
  if(!saved||!current)return;
  const ok=writeComparisonDraft(storage,saved,current);
  if(ok){draft=readComparisonDraft(storage);identity.textContent=saved.offer.merchant+' · '+saved.offer.itemName+' / '+current.offer.merchant+' · '+current.offer.itemName;resume.hidden=true;}
  draftStatus.textContent=ok?'':'This browser could not keep this comparison after you leave. Save each offer and its questions before leaving.';
 }
 const panel=node('section',undefined,'offer-comparison panel hidden');panel.id='offer-comparison';panel.tabIndex=-1;panel.setAttribute('aria-labelledby','comparison-title');before.before(panel);
 function captureCurrent(){
  if(!current)return null;
  const section=readSourceSection(current);
  return comparisonSnapshot(current,readQuestions(current)??current.buyerQuestions,section===undefined?current.sourceSection:section);
 }
 function rememberQuestionEdit(event){
  if(!saved||!current||!event.target.closest?.('#clarification-panel'))return;
  current=captureCurrent();remember();
 }
 document.addEventListener('input',rememberQuestionEdit);
 document.addEventListener('change',rememberQuestionEdit);
 function chooseRecord(record,question=null,button=null){
  const chosen=comparisonSnapshot(record);if(record===saved)saved=comparisonSnapshot(current);onlyChanges=false;
  onChoose(chosen.offer,chosen.buyerQuestions,chosen.sourceSection||null);current=captureCurrent();remember();
  if(question)document.dispatchEvent(new CustomEvent('source-question',{detail:{source:chosen.offer.terms,...question,button}}));
 }
 function open(){current=captureCurrent();remember();render();onCompare();panel.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'})}
 function render(){
  choiceObserver?.disconnect();choiceResize?.disconnect();panel.style.removeProperty('--comparison-choice-height');
  panel.replaceChildren();panel.classList.toggle('hidden',!saved);jump.classList.toggle('hidden',!saved||!current);keep.disabled=!current;
  keep.textContent=saved?'Keep current instead':'Compare another offer';
  if(!saved)return;
  const header=node('div',undefined,'comparison-title-row');const title=node('h2','Compare the terms');title.id='comparison-title';
  const back=node('button','Back to current terms','ghost-button');back.type='button';back.id='comparison-back';back.onclick=onRead;header.append(title,back);panel.append(header);
  const pair=current&&JSON.stringify(current.offer)!==JSON.stringify(saved.offer);
  const heads=node('div',undefined,'comparison-head');
  for(const [record,label] of [[saved,'KEPT OFFER'],...(pair?[[current,'CURRENT OFFER']]:[])]){
   const card=node('div',undefined,'comparison-offer');card.append(node('p',label,'section-eyebrow'),node('h3',record.offer.itemName),node('p',record.offer.merchant,'comparison-merchant'),node('strong',money(record.offer.amountCents),'comparison-price'));if(pair){const choose=node('button','Choose this offer','ghost-button comparison-choose');choose.type='button';choose.dataset.choose=label==='KEPT OFFER'?'kept':'current';choose.onclick=()=>chooseRecord(record);card.append(choose)}if(record.sourceSection)card.append(node('p','Selected source section: '+record.sourceSection.heading,'comparison-section-scope'));heads.append(card);
  }panel.append(heads);
  if(!pair){panel.append(node('p','Enter another purchase to compare its original terms.'));const edit=node('button','Edit current purchase','primary-button');edit.type='button';edit.onclick=onEdit;panel.append(edit);return}
  if(saved.buyerQuestions?.length||current.buyerQuestions?.length){
  const questions=node('section',undefined,'comparison-questions');questions.append(node('h3','Questions to resolve'));
  const questionPair=node('div',undefined,'comparison-head');
  for(const [record,label] of [[saved,'Kept offer'],[current,'Current offer']]){
   const cell=node('div');cell.dataset.questionSide=label==='Kept offer'?'kept':'current';
   cell.append(node('strong',label+' · '+record.offer.merchant));
   const list=node('ul');
   for(const question of record.buyerQuestions||[]){const item=node('li',question.text);if(question.reason){const details=node('details',undefined,'question-context');details.append(node('summary','Selected context'),node('p',question.reason));item.append(details)}if(question.reply){const reply=node('details',undefined,'question-context recorded-reply');reply.append(node('summary','Reply you recorded'),node('p',question.reply));item.append(reply)}list.append(item)}
   if(!list.children.length)list.append(node('li','No questions drafted.'));
   cell.append(list);questionPair.append(cell);
  }
  questions.append(questionPair);panel.append(questions);
  }
  const delta=priceDifference(saved,current);if(delta!==null)panel.append(node('p',delta===0?'Same entered price':money(Math.abs(delta))+(delta>0?' more for the current offer':' less for the current offer'),'comparison-difference'));
  panel.append(createComparisonTopics({kept:{...saved.offer,sourceSection:saved.sourceSection},current:{...current.offer,sourceSection:current.sourceSection},onReveal:hit=>{onlyChanges=false;revealComparisonMatch(panel,hit)},onAsk:({side,passage,topic,button})=>{const record=side==='kept'?saved:current;const question=passage?{start:passage.start,end:passage.end,text:record.offer.terms.slice(passage.start,passage.end)}:{topic};chooseRecord(record,question,button)}}));
  const rows=compareOriginalTerms(saved.offer.terms,current.offer.terms),count=rows.filter(r=>r.changed).length;
  const filters=node('div',undefined,'comparison-filters');
  for(const [filter,label] of [[false,'Complete sources'],[true,'Source changes ('+count+')']]){const button=node('button',label,'source-view-button');button.type='button';button.setAttribute('aria-pressed',String(onlyChanges===filter));button.onclick=()=>{onlyChanges=filter;render()};filters.append(button)}panel.append(filters);
  panel.append(createComparisonFind({kept:saved.offer,current:current.offer,onReveal:hit=>{onlyChanges=false;revealComparisonMatch(panel,hit)}}));
  const body=node('div',undefined,'comparison-text');
  for(const row of rows){const line=node('div',undefined,'comparison-source-row'+(row.changed?' is-different':''));line.hidden=onlyChanges&&!row.changed;
   if(row.kept===row.current){
    line.classList.add('is-shared');const cell=node('div',undefined,'comparison-source-cell');cell.dataset.side='kept current';
    cell.append(node('span','Both offers · same wording','comparison-source-shared-label'),node('p',row.kept,'comparison-source'));line.append(cell);
   }else for(const [side,label] of [['kept','Kept'],['current','Current']]){const cell=node('div',undefined,'comparison-source-cell');cell.dataset.side=side;cell.append(node('span',label,'comparison-mobile-label'));const source=node('p',row[side],'comparison-source');cell.append(source);if(!row[side])cell.append(node('span','—','comparison-empty'));line.append(cell)}body.append(line);
  }panel.append(body);
  if(onlyChanges&&!count)panel.append(node('p','The wording is the same.','comparison-identical'));
  const footer=node('div',undefined,'comparison-footer');const remove=node('button','Remove kept offer','ghost-button');remove.id='remove-kept-offer';remove.type='button';remove.onclick=()=>{saved=null;onlyChanges=false;const cleared=clearComparisonDraft(storage);resume.hidden=cleared;draftStatus.textContent=cleared?'':'The comparison was removed here, but this browser could not remove its saved copy.';render();onRead()};footer.append(remove);panel.append(footer);
  const choices=node('nav',undefined,'comparison-choice');choices.setAttribute('aria-label','Choose an offer after reading');choices.hidden=true;
  for(const [record,side] of [[saved,'kept'],[current,'current']]){
   const choose=node('button',undefined,'comparison-choice-button');choose.type='button';choose.dataset.choice=side;
   choose.append(node('span','Choose '+record.offer.itemName),node('small',(side==='kept'?'Kept':'Current')+' · '+record.offer.merchant),node('strong',money(record.offer.amountCents)));
   choose.onclick=()=>chooseRecord(record);choices.append(choose);
  }
  panel.append(choices);
  choiceObserver=new IntersectionObserver(entries=>{choices.hidden=entries[0].isIntersecting},{threshold:0});choiceObserver.observe(heads);
  choiceResize=new ResizeObserver(()=>{if(!choices.hidden)panel.style.setProperty('--comparison-choice-height',choices.getBoundingClientRect().height+'px')});choiceResize.observe(choices);
 }
 keep.onclick=()=>{if(current){saved=captureCurrent();current=comparisonSnapshot(saved);onlyChanges=false;remember();render();onEdit()}};
 jump.onclick=open;
 return {update(review){current=review?comparisonSnapshot(review):null;render()},mount(target){target.append(toolbar)}};
}
