import {appendSourceText} from './source-links.js';
import {sourceReadingBlocks,sourceNumberedReferences,sourceDefinedReferences,groupedSourceSearch,extendSourceRange,sourceHeadingLocations,sourceHeadingLabel} from './source.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
export function renderSourceReader(host,{source,facts=[],selections=null,preview=false,pending=false}){
  const blocks=sourceReadingBlocks(source,facts),references=[...sourceNumberedReferences(source),...sourceDefinedReferences(source)].sort((a,b)=>a.start-b.start);
  let referenceHistory=[];
  host.replaceChildren();
  host.classList.add('complete-source-reader');
  let questionTarget=null;
  const attachment=el('aside','source-question-attachment');attachment.hidden=true;
  attachment.append(el('strong','','Add a source condition to this question'));
  const attachmentText=el('p','');const attachmentCancel=el('button','ghost-button','Cancel adding condition');attachmentCancel.type='button';
  attachment.append(attachmentText,attachmentCancel);
  attachmentCancel.addEventListener('click',()=>host.dispatchEvent(new CustomEvent('source-question-attachment-cancel',{bubbles:true})));
  const controls=el('div','source-view-controls');
  const all=el('button','source-view-button','All pasted terms');
  all.type='button';all.setAttribute('aria-pressed','true');
  controls.append(all);
  let selected=null;
  if(selections){
    selected=el('button','source-view-button','AI selections only');
    selected.type='button';selected.setAttribute('aria-pressed','false');controls.append(selected);
  }
  const back=el('button','source-back','Back to selected passage');
  back.type='button';back.hidden=true;controls.append(back);
  const askCondition=el('button','source-condition-question','Ask about this condition');
  askCondition.type='button';askCondition.hidden=true;controls.append(askCondition);
  const referenceBack=el('button','source-back source-reference-back','Back to reference');referenceBack.type='button';referenceBack.hidden=true;controls.append(referenceBack);
  referenceBack.addEventListener('click',()=>{const prior=referenceHistory.pop();if(prior)showAll({focus:true,range:prior,referenceNavigation:true});referenceBack.hidden=!referenceHistory.length});
  const contextControls=el('div','source-context-controls');contextControls.hidden=true;
  const addPrevious=el('button','source-context-previous','Add previous sentence');
  const addNext=el('button','source-context-next','Add next sentence');
  const resetContext=el('button','source-context-reset','Reset');
  resetContext.setAttribute('aria-label','Reset quoted context to the original selection');
  for(const button of [addPrevious,addNext,resetContext])button.type='button';
  contextControls.append(addPrevious,addNext,resetContext);controls.append(contextControls);
  const note=el('p','source-reader-key',pending?'Highlighting…':preview
    ?''
    :'');
  const documentText=el('div','source-document');
  documentText.tabIndex=-1;documentText.setAttribute('aria-label','All pasted merchant terms');
  let labelRanges=[];
  function renderDocument(range=null,ranges=null){
    if(ranges!==null)labelRanges=ranges.filter(r=>Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end<=source.length&&r.end>r.start);
    const labelFacts=labelRanges.map(r=>({quote:source.slice(r.start,r.end),sourceRange:r}));
    const painted=sourceReadingBlocks(source,[...facts,...labelFacts],{keepRanges:range&&range.end-range.start<=1800?[range]:[]});
    documentText.replaceChildren();
    for(const block of painted){
      const paragraph=el('p','complete-passage');paragraph.dataset.sourceStart=String(block.start);
      for(const part of block.parts){
        const labelled=part.factIndexes.some(i=>i>=facts.length);
        const selectedPart=part.factIndexes.some(i=>i<facts.length);
        const stops=[...new Set([part.start,part.end,...(range?[range.start,range.end]:[])
          .filter(n=>n>part.start&&n<part.end)])].sort((a,b)=>a-b);
        for(let i=0;i<stops.length-1;i++){
          const start=stops[i],end=stops[i+1];
          const active=!!range&&start>=range.start&&end<=range.end;
          const classes=[selectedPart?'selected-source':'',labelled?'label-source':'',active?'source-target':''].filter(Boolean).join(' ');
          const piece=el(active||selectedPart||labelled?'mark':'span',classes);appendReferencedText(piece,start,end);
          piece.dataset.sourceStart=String(start);piece.dataset.sourceEnd=String(end);
          if(active||selectedPart||labelled)piece.tabIndex=-1;
          paragraph.append(piece);
        }
      }
      documentText.append(paragraph);
    }
  }
  function appendReferencedText(node,start,end){
    let offset=start;
    for(const ref of references.filter(r=>r.start>=start&&r.end<=end)){
      appendSourceText(node,source.slice(offset,ref.start));
      const button=el('button','source-clause-reference',ref.label);button.type='button';button.setAttribute('aria-label','Read original '+ref.label);if(ref.number)button.dataset.referenceNumber=ref.number;if(ref.term)button.dataset.referenceTerm=ref.term;
      button.addEventListener('click',()=>{
        referenceHistory.push(activeCondition?{...activeCondition}:ref.origin||{start:ref.start,end:ref.end});
        showAll({focus:true,range:ref.target,referenceNavigation:true});referenceBack.hidden=false;
      });
      node.append(button);offset=ref.end;
    }
    appendSourceText(node,source.slice(offset,end));
  }
  renderDocument();

  const find=el('details','source-find');
  find.append(el('summary','','Find a condition or ask about it'));
  const label=el('label','source-find-label','Find a word or phrase in these terms');
  const query=el('input');query.type='search';query.className='source-find-query';query.placeholder='For example: refund or cryptocurrency';
  query.maxLength=200;label.append(query);find.append(label);
  const found=el('p','source-find-status');found.setAttribute('role','status');
  const context=el('blockquote','source-find-context');context.hidden=true;
  const actions=el('div','source-find-actions');
  const previous=el('button','ghost-button','Previous'),next=el('button','ghost-button','Next');
  const original=el('button','ghost-button','Read in full context'),ask=el('button','ghost-button','Ask about this passage');
  for(const button of [previous,next,original,ask])button.type='button';
  actions.append(previous,next,original,ask);find.append(found,context,actions);
  let matches=[],matchIndex=0;
  function updateSearch(){
    matches=groupedSourceSearch(source,query.value);matchIndex=0;showMatch();
  }
  function showMatch(){
    const match=matches[matchIndex];
    found.textContent=query.value.trim().length<2?'':match
      ?'Matching section '+(matchIndex+1)+' of '+matches.length+' · '+match.matchRanges.length+' '+(match.matchRanges.length===1?'match':'matches')
      :'No matching wording. Try another word or read all terms below.';
    context.hidden=!match;context.replaceChildren();
    if(match){
      let offset=0;
      for(const range of match.matchRanges){
        const begin=range.start-match.start,end=range.end-match.start;
        context.append(document.createTextNode(match.text.slice(offset,begin)),el('mark','source-find-hit',match.text.slice(begin,end)));
        offset=end;
      }
      context.append(document.createTextNode(match.text.slice(offset)));
      const hit=context.querySelector('.source-find-hit');
      requestAnimationFrame(()=>{
        if(!hit.isConnected||context.hidden)return;
        context.scrollTop+=hit.getBoundingClientRect().top-context.getBoundingClientRect().top-60;
      });
    }
    actions.hidden=query.value.trim().length<2;previous.hidden=next.hidden=original.hidden=!match;ask.textContent=match?(questionTarget!==null?'Add passage to this question':'Ask about this passage'):'Ask about “'+query.value.trim()+'”';ask.disabled=questionTarget!==null&&!match;previous.disabled=matches.length<2;next.disabled=matches.length<2;
  }
  query.addEventListener('input',updateSearch);
  query.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(matches.length){matchIndex=(matchIndex+1)%matches.length;showMatch()}}});
  previous.addEventListener('click',()=>{matchIndex=(matchIndex+matches.length-1)%matches.length;showMatch()});
  next.addEventListener('click',()=>{matchIndex=(matchIndex+1)%matches.length;showMatch()});
  original.addEventListener('click',()=>{const match=matches[matchIndex];if(match)showAll({focus:true,range:{start:match.matchStart,end:match.matchEnd},from:original})});
  ask.addEventListener('click',()=>{
    const match=matches[matchIndex];if(!match){host.dispatchEvent(new CustomEvent('source-question',{bubbles:true,detail:{source,topic:query.value.trim(),button:ask}}));return;}
    host.dispatchEvent(new CustomEvent('source-question',{bubbles:true,detail:{source,...match,button:ask}}));
  });
  updateSearch();
  const outline=el('details','source-outline');
  outline.append(el('summary','','Jump to a source heading'));
  const headingLabel=el('label','source-heading-label','Original heading');
  const headingSelect=el('select','source-heading-select');
  headingSelect.append(el('option','','Choose a heading'));
  const headings=sourceHeadingLocations(source);
  for(const h of headings){
    const option=el('option','',sourceHeadingLabel(source,h.start));
    option.value=String(h.start);headingSelect.append(option);
  }
  headingLabel.append(headingSelect);outline.append(headingLabel);
  headingSelect.addEventListener('change',()=>{
    const h=headings.find(h=>String(h.start)===headingSelect.value);
    if(h)showAll({focus:true,range:{start:h.start,end:h.end},from:headingSelect,navigationOnly:true});
  });
  let returnTarget=null,returnFindOpen=false,returnOutlineOpen=false,activeCondition=null,initialCondition=null;
  function clearCondition(){
    activeCondition=null;initialCondition=null;referenceHistory=[];referenceBack.hidden=true;askCondition.hidden=true;contextControls.hidden=true;controls.classList.remove('source-condition-controls');
  }
  function updateContextControls(){
    contextControls.hidden=!activeCondition;
    addPrevious.disabled=!extendSourceRange(source,activeCondition,'previous');
    addNext.disabled=!extendSourceRange(source,activeCondition,'next');
    resetContext.disabled=!activeCondition||!initialCondition||(activeCondition.start===initialCondition.start&&activeCondition.end===initialCondition.end);
  }
  function changeContext(range){
    if(!range)return;
    activeCondition={start:range.start,end:range.end};
    renderDocument(activeCondition,[activeCondition]);updateContextControls();
    const target=documentText.querySelector('.source-target');
    target?.scrollIntoView({behavior:'instant',block:'center'});
  }
  addPrevious.addEventListener('click',()=>changeContext(extendSourceRange(source,activeCondition,'previous')));
  addNext.addEventListener('click',()=>changeContext(extendSourceRange(source,activeCondition,'next')));
  resetContext.addEventListener('click',()=>changeContext(initialCondition));
  askCondition.addEventListener('click',()=>{
    if(!activeCondition)return;
    const {start,end}=activeCondition;
    host.dispatchEvent(new CustomEvent('source-question',{bubbles:true,detail:{source,start,end,text:source.slice(start,end),button:askCondition}}));
  });
  function showAll({focus=false,range=null,ranges=null,from=null,navigationOnly=false,referenceNavigation=false}={}){
    if(!referenceNavigation){referenceHistory=[];referenceBack.hidden=true}
    const validRange=range&&Number.isInteger(range.start)&&Number.isInteger(range.end)
      &&range.start>=0&&range.end<=source.length&&range.end>range.start?range:null;
    renderDocument(validRange,ranges);
    documentText.hidden=false;note.hidden=false;
    if(selections)selections.hidden=true;
    all.setAttribute('aria-pressed','true');selected?.setAttribute('aria-pressed','false');
    returnTarget=from;back.hidden=!from;
    // A search reveal highlights only its literal hit; asking must retain the
    // complete search context. A Terms Facts link already selects its full rule.
    const context=from?.closest('.source-find')?matches[matchIndex]:validRange;
    activeCondition=!navigationOnly&&context&&Number.isInteger(context.start)&&Number.isInteger(context.end)
      &&context.start>=0&&context.end<=source.length&&context.end-context.start>=8
      ?{start:context.start,end:context.end}:null;
    initialCondition=activeCondition?{...activeCondition}:null;updateContextControls();
    askCondition.hidden=!activeCondition;controls.classList.toggle('source-condition-controls',!!activeCondition);
    controls.hidden=!selections&&!from&&!activeCondition;
    returnFindOpen=!!from?.closest('.source-find')&&find.open;
    returnOutlineOpen=!!from?.closest('.source-outline')&&outline.open;
    if(from){find.open=false;outline.open=false;}
    back.textContent=from?.closest('.decision-questions')?'Back to decision'
      :from?.closest('.source-outline')?'Back to source headings'
      :from?.closest('.source-find')?'Back to search'
      :selections?.contains(from)?'Back to selected passage':'Back to terms label';
    if(focus||validRange){
      const target=documentText.querySelector('.source-target')||documentText;
      target.focus({preventScroll:true});
      target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
    }
    return !range||!!validRange;
  }
  function showSelections(){
    if(!selections)return;
    clearCondition();documentText.hidden=true;note.hidden=true;selections.hidden=false;back.hidden=true;
    all.setAttribute('aria-pressed','false');selected.setAttribute('aria-pressed','true');
  }
  all.addEventListener('click',()=>showAll({ranges:[]}));
  selected?.addEventListener('click',showSelections);
  function returnToLink(){
    const target=returnTarget;
    if(selections?.contains(target))showSelections();
    if(returnFindOpen)find.open=true;
    if(returnOutlineOpen)outline.open=true;returnOutlineOpen=false;
    returnFindOpen=false;returnTarget=null;back.hidden=true;controls.hidden=!selections;clearCondition();
    if(target?.isConnected){
      if(target.closest('.decision-questions'))document.dispatchEvent(new CustomEvent('purchase-screen',{detail:'approve'}));
      target.focus({preventScroll:true});
      target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
    }
  }
  back.addEventListener('click',returnToLink);
  documentText.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&returnTarget){event.preventDefault();returnToLink();}
  });
  controls.hidden=!selections;host.classList.toggle('single-source',!selections);
  host.append(attachment,controls,note,find);if(headings.length>1)host.append(outline);host.append(documentText);
  if(selections){selections.classList.add('source-selected-view');selections.hidden=true;host.append(selections);}
  function capturePosition(){
    if(documentText.hidden)return null;
    const p=[...documentText.children].find(n=>{const r=n.getBoundingClientRect();return r.bottom>24&&r.top<window.innerHeight});
    return p?{start:Number(p.dataset.sourceStart),top:p.getBoundingClientRect().top,query:query.value,findOpen:find.open,matchStart:matches[matchIndex]?.start}:null;
  }
  function restorePosition(position){
    if(position.query){query.value=position.query;updateSearch();matchIndex=Math.max(0,matches.findIndex(m=>m.start===position.matchStart));showMatch();find.open=!!position.findOpen;}
    const p=[...documentText.children].find(n=>Number(n.dataset.sourceStart)===position.start);
    if(p)window.scrollBy({top:p.getBoundingClientRect().top-position.top,behavior:'instant'});
  }
  function analysisFailed(){note.textContent='Highlights unavailable. Try again.';}
  function setQuestionTarget(text){
    questionTarget=text;attachment.hidden=text===null;attachmentText.textContent=text||'';
    askCondition.textContent=text===null?'Ask about this condition':'Add condition to this question';showMatch();
  }
  return {showAll,showSelections,blocks,capturePosition,restorePosition,analysisFailed,setQuestionTarget};
}
