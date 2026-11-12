import {attachOriginalPdfs} from './original-pdfs.js';
import {sourcePageAt} from './source-links.js';
import {setupDraftRecovery} from './draft-recovery.js';
import {setupSourceImport} from './source-import.js';
import {setupCopiedSourceLinks} from './copied-source-links.js';
import './decision-questions.js';
import {MAX_SOURCE_CHARACTERS,MAX_AI_SOURCE_CHARACTERS,SOURCE_LIMIT_MESSAGE} from './offer-limits.js';
import {renderTermsFacts} from './terms-facts.js';
import {createReviewContinuity} from './review-continuity.js';
import {showModelReadiness} from './model-readiness.js';
import {updateReviewNavigation,showReviewScreen} from './review-navigation.js';

import {setupOfferDraft} from './offer-draft.js';
import {createOfferComparison} from './offer-comparison.js';
import {setupSavedReview,savedSourceSection} from './saved-review.js';
import {renderClarification,addSourceQuestion,addComparedSourceQuestion,currentBuyerQuestions,cancelSourceQuestionAttachment} from './clarification.js';
import {findQuoteRange,factSourceRange,readingPassages,sourceSectionAt,sourceOccurrence,sourceHeadingLocations,sourceHeadingContext} from './source.js';
import {compareOffer} from './compare.js';
import {renderSourceReader} from './source-reader.js';
const $=id=>document.getElementById(id);
const offerForm=$('offer-form');
setupCopiedSourceLinks($('terms'));
const sourceImport=setupSourceImport($('terms'),{
 beforeAdd:()=>{
  const offer=draftOffer();
  const questions=sameQuestionOffer(offer,current?.offer)?currentBuyerQuestions():sameQuestionOffer(offer,carriedQuestions?.offer)?carriedQuestions.questions:[];
  return {offer,questions};
 },
 afterAdd:(retained,source)=>{
  const offer=draftOffer();
  if(retained?.questions.length&&offer.terms===source&&['merchant','itemName','amountCents'].every(key=>offer[key]===retained.offer[key]))
   carriedQuestions={offer,questions:retained.questions};
 }
});
offerForm.addEventListener('invalid',()=>showReviewScreen('read'),true);
let carriedQuestions=null,draftRecovery=null;
const sameQuestionOffer=(a,b)=>a&&b&&['merchant','itemName','amountCents','terms'].every(key=>a[key]===b[key]);
const comparison=createOfferComparison({reviewElement:$('review'),before:$('error'),onEdit:()=>showReviewScreen('read',{focus:true}),onRead:()=>previewSource({focus:true}),onCompare:()=>showReviewScreen('compare'),onChoose:chooseComparedOffer,resumeAfter:$('edit-purchase'),readSourceSection:review=>sameQuestionOffer(review.offer,draftOffer())?readingSectionFor(review.offer.terms):undefined,readQuestions:review=>sameQuestionOffer(review.offer,reviewedSource)&&current?currentBuyerQuestions():sameQuestionOffer(review.offer,carriedQuestions?.offer)?carriedQuestions.questions:null});
const sample={merchant:'Northstar Supply Co.',itemName:'Traveler’s leather journal',amountCents:4800,terms:`Traveler’s journal: $48.00 USD, payable once at checkout. We dispatch orders within 3 business days after payment. Standard delivery usually takes 5–9 business days after dispatch. Shipping to addresses in the continental United States is included in the displayed price. Returns are accepted within 14 days of delivery if the journal is unused and in its original packaging. Customers pay return postage. A 10% restocking fee applies to all non-defective returns. Personalized monograms are final sale. If your package arrives damaged, contact the seller within 48 hours of receipt with photographs. No subscription is included with this product. Our refund-processing time and contact response time are not specified in this offer.`};
let current=null, pending=null, config={ai:false,paypal:false};
const reviewCopyActions=el('div','payment-actions');reviewCopyActions.id='review-copy-actions';reviewCopyActions.hidden=true;
const saveOnly=el('button','primary-button','Save review');saveOnly.type='button';saveOnly.id='save-review-only';
saveOnly.addEventListener('click',()=>saveReviewCopy(saveOnly,{retain:true}));
const askOnly=el('button','ghost-button','Add a question');askOnly.type='button';askOnly.id='review-only-questions';
askOnly.addEventListener('click',()=>{showReviewScreen('understand');$('clarification-panel').open=true;$('clarification-panel').scrollIntoView({block:'start',behavior:'instant'});$('merchant-extra-question')?.focus({preventScroll:true})});
reviewCopyActions.append(saveOnly,askOnly);$('checkout-controls').after(reviewCopyActions);
let reviewedSource=null, revisionBase=null, inputRevision=0, activeAnalysis=null;
const continuity=createReviewContinuity({
  before:$('open-saved-review'),
  snapshot:()=>JSON.stringify(draftOffer())+'|'+inputRevision,
  onIdsChange:ids=>sourceImport.pruneReviewOriginals(ids),
  onOpen:record=>{
    const entered=draftOffer(),incoming=record.offer;
    const differs=['merchant','itemName','amountCents','terms'].some(key=>entered[key]!==incoming[key]);
    const untouchedExample=['merchant','itemName','amountCents','terms'].every(key=>entered[key]===sample[key]);
    const hasDraft=['merchant','item','amount','terms'].some(id=>$(id).value.trim());
    if(differs&&hasDraft&&!untouchedExample&&!confirm('Open '+incoming.itemName+' from '+incoming.merchant+'? This replaces your displayed offer and clears its payment acknowledgments.'))return false;
    resetReview();reviewedSource=null;revisionBase=null;
    $('merchant').value=incoming.merchant;$('item').value=incoming.itemName;
    $('amount').value=(incoming.amountCents/100).toFixed(2);$('terms').value=incoming.terms;
    const url=new URL(location.href);
    for(const key of ['return','review','cancel','token','PayerID'])url.searchParams.delete(key);
    history.replaceState(null,'',url);
    closeFiles();renderReview(record);draftRecovery?.completed();
    if(record.order)showPendingOrder({...record.order,status:record.status,captureId:record.captureId},{restored:true});
    return sourceImport.restoreReviewOriginals(record.id,record.offer.terms).then(()=>true);
  }
});
let completeReader=null,previewReader=null;
const sourcePreview=el('section','source-preview hidden');sourcePreview.id='source-preview';sourcePreview.tabIndex=-1;
$('empty').after(sourcePreview);
const readNow=el('button','ghost-button','Read all pasted terms');readNow.id='read-source-now';readNow.type='button';
$('analyze').before(readNow);readNow.className='primary-button';readNow.textContent='Read terms →';$('reader-action').append($('analyze'));$('analyze').setAttribute('form','offer-form');
function sourceWithinLimit(){
  if($('terms').value.length<=MAX_SOURCE_CHARACTERS)return true;
  showReviewScreen('read');error(SOURCE_LIMIT_MESSAGE);$('terms').focus({preventScroll:true});$('error').scrollIntoView({block:'center',behavior:'instant'});return false;
}
function previewSource({focus=false,pending=!!activeAnalysis}={}){
  if(!sourceWithinLimit())return;
  showReviewScreen('understand');updateReviewNavigation(current?.offer);
  const source=$('terms').value;
  if(!source.trim()){$('terms').focus();return}
  if(current?.analysis?.mode==='source'&&completeReader){completeReader.showAll({focus});return}
  $('empty').classList.add('hidden');sourcePreview.classList.remove('hidden');
  previewReader=renderSourceReader(sourcePreview,{source,preview:true,pending});
  const trailPanel=el('section','source-trail');trailPanel.id='preview-source-trail';sourceImport.renderTrail(trailPanel,source);sourcePreview.prepend(trailPanel);
  const next=el('button','primary-button',config.paypal?'Continue to payment →':'Keep this review →');next.type='button';next.id='source-continue-payment';
  next.addEventListener('click',()=>beginSourceReview(next));
  const actions=el('div','reader-next preview-actions');
  if(sameQuestionOffer(draftOffer(),carriedQuestions?.offer)&&carriedQuestions.questions.length){
    const resume=el('button','primary-button','Continue saved questions');resume.type='button';resume.id='resume-saved-questions';
    resume.addEventListener('click',()=>beginSourceReview(resume,{afterReview:()=>{
      showReviewScreen('understand');const panel=$('clarification-panel');panel.open=true;
      for(const details of panel.querySelectorAll('.question-reply-editor'))if(details.querySelector('textarea')?.value.trim())details.open=true;
      panel.scrollIntoView({block:'start',behavior:'instant'});
      panel.querySelector('.clarification-question:not(:disabled), #merchant-extra-question')?.focus({preventScroll:true});
    }}));
    next.className='ghost-button';actions.append(resume);
  }
  actions.append(next);document.querySelector('#label-review-actions .preview-actions')?.remove();$('review-actions').classList.add('hidden');$('label-review-actions').append(actions);
  updateTermsFacts(source,previewReader);
  comparison.update({offer:draftOffer(),analysis:{mode:'source',facts:[],unknowns:[],questions:[]}});comparison.mount(actions);
  if(focus){sourcePreview.focus({preventScroll:true});sourcePreview.scrollIntoView({behavior:'smooth',block:'start'})}
}
function updateTermsFacts(source,reader){
  $('source-focus-label').textContent='';
  renderTermsFacts($('terms-fact-rows'),{source,onAsk:async(row,button)=>{
    if(source.trim()!==draftOffer().terms.trim()){error('The purchase terms changed. Select the conditions again in the current source.');return}
    const open=()=>{showReviewScreen('understand');addComparedSourceQuestion(source,row.passages,row.label)};
    if(current&&reviewedSource?.terms===source)open();
    else await beginSourceReview(button,{afterReview:open});
  },onSelect:(row,button)=>{
    showReviewScreen('understand');
    $('source-focus-label').textContent=row.passages.length?row.label+' · '+row.passages.length+' '+(row.passages.length===1?'passage':'passages'):'All original terms';
    if(reader)reader.showAll({focus:true,range:row.passages[0]||null,ranges:row.passages,from:button});
    else if(row.passages[0])showOriginal(button,row.passages[0]);
  }});
  reader?.showAll({ranges:[]});
}
$('all-label-terms').addEventListener('click',()=>{
  showReviewScreen('understand');
  $('source-focus-label').textContent='';
  for(const button of $('terms-fact-rows').querySelectorAll('button'))button.setAttribute('aria-pressed','false');
  (completeReader||previewReader)?.showAll({focus:true,ranges:[]});
});
readNow.addEventListener('click',()=>previewSource({focus:true}));
async function beginSourceReview(button,{afterReview=null}={}){
  if(!sourceWithinLimit())return;
  if(!offerForm.checkValidity()){showReviewScreen('read',{focus:true});offerForm.reportValidity();return;}
  const submitted=draftOffer();
  const questionsToCarry=sameQuestionOffer(submitted,carriedQuestions?.offer)?carriedQuestions:null;
  resetReview();carriedQuestions=questionsToCarry;
  const revision=inputRevision,controller=new AbortController();activeAnalysis=controller;
  button.disabled=true;
  try{
    const result=await request('/api/source-review',submitted,controller.signal);
    if(revision!==inputRevision)return;
    if(JSON.stringify(submitted)!==JSON.stringify(draftOffer()))throw new Error('The purchase changed. Read the current terms before continuing.');
    renderReview(result);
    await sourceImport.rememberReviewOriginals(result.id,result.offer.terms);
    if(afterReview)afterReview(result);else showReviewScreen('approve',{focus:true});
  }catch(e){if(revision===inputRevision){previewSource();error(e.message)}}
  finally{if(revision===inputRevision)activeAnalysis=null;button.disabled=false}
}
document.addEventListener('source-question-target',event=>{
  const text=event.detail?.text??null;
  completeReader?.setQuestionTarget(text);previewReader?.setQuestionTarget(text);
  if(text!==null){showReviewScreen('understand');const reader=completeReader||previewReader;reader?.showAll({focus:true,ranges:[]});document.querySelector('.source-question-attachment:not([hidden])')?.scrollIntoView({block:'start',behavior:'instant'});}
});
document.addEventListener('source-question-attachment-cancel',()=>cancelSourceQuestionAttachment());
document.addEventListener('source-question',async event=>{
  const {source,start,end,text,topic,button}=event.detail||{};
  const ownTopic=typeof topic==='string'&&topic.trim().length>=2&&topic.length<=200;
  if(typeof source!=='string'||source.trim()!==draftOffer().terms.trim()||(!ownTopic&&source.slice(start,end)!==text)){
    error('The purchase terms changed. Find the condition again in the current source.');return;
  }
  const heading=!ownTopic?sourceSectionAt(source,start):null;
  const open=()=>{showReviewScreen('understand');addSourceQuestion(text,ownTopic?topic:null,heading?.text||null,!ownTopic?sourceOccurrence(source,{start,end}):null,heading?.plan?sourceHeadingContext(source,heading.start)?.text:null,!ownTopic?sourcePageAt(source,start)?.url:null,!ownTopic?sourcePageAt(source,start)?.filename:null)};
  if(current&&reviewedSource?.terms===source)open();
  else await beginSourceReview(button,{afterReview:open});
});
function reviewAction(){return !config.ai?'AI unavailable':current?'Refresh AI highlights':'Highlight with AI'}
function currency(cents){return '$'+(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n}
function chooseComparedOffer(offer,questions=[],sourceSection=null){
  resetReview();reviewedSource=null;revisionBase=null;carriedQuestions={offer:structuredClone(offer),questions:structuredClone(questions)};document.body.dataset.example='false';
  $('merchant').value=offer.merchant;$('item').value=offer.itemName;
  $('amount').value=Number.isFinite(offer.amountCents)?(offer.amountCents/100).toFixed(2):'';$('terms').value=offer.terms;
  const url=new URL(location.href);
  for(const key of ['return','review','cancel','token','PayerID'])url.searchParams.delete(key);
  history.replaceState(null,'',url);
  $('terms-fact-rows').sourceReadingSection={source:offer.terms,start:sourceSection?.start??null};
  draftRecovery?.adopt();renderRevision();previewSource({focus:true});
}
function draftOffer(){
  return {merchant:$('merchant').value,itemName:$('item').value,
    amountCents:Math.round(Number($('amount').value)*100),terms:$('terms').value};
}
function renderRevision(){
  const panel=$('revision'), base=revisionBase||reviewedSource;
  if(!base){panel.classList.add('hidden');return}
  const diff=compareOffer(base,draftOffer());
  panel.classList.toggle('hidden',!diff.changed);
  if(!diff.changed)return;
  $('revision-meta').replaceChildren();
  for(const field of diff.fields){
    const fmt=value=>field.key==='amountCents'&&Number.isFinite(value)?currency(value):String(value||'—');
    $('revision-meta').append(el('li',null,field.label+': '+fmt(field.previous)+' → '+fmt(field.current)));
  }
  $('revision-meta').classList.toggle('hidden',!diff.fields.length);
  for(const [id,entries] of [['revision-removed',diff.removed],['revision-added',diff.added]]){
    $(id).replaceChildren();
    for(const passage of entries)$(id).append(el('li',null,passage));
    $(id+'-group').classList.toggle('hidden',!entries.length);
  }
}
function setStage(stage){showReviewScreen(stage)}
function closeFiles(){document.querySelector('.purchase-tools').open=false}
function error(message){$('error').textContent=message;$('error').classList.remove('hidden')}
function resetReview(){cancelSourceQuestionAttachment();carriedQuestions=null;
  document.querySelector('#label-review-actions .preview-actions')?.remove();$('review-actions').classList.add('hidden');
  $('checkout-controls').hidden=false;$('checkout-head').textContent='Review payment';
  updateReviewNavigation(null);
  sourcePreview.classList.add('hidden');sourcePreview.replaceChildren();completeReader=null;previewReader=null;
  $('return-to-review').classList.add('hidden');returnToExcerpt=null;comparison.update(null);inputRevision++;if(activeAnalysis){activeAnalysis.abort();activeAnalysis=null}$('analyze').disabled=!config.ai;$('analyze').textContent=reviewAction();$('questions').replaceChildren();$('merchant-message').replaceChildren();current=null;pending=null;$('review').classList.add('hidden');$('empty').classList.remove('hidden');$('error').classList.add('hidden');$('reviewed').disabled=$('consent').disabled=true;$('reviewed').checked=$('consent').checked=false;$('order').disabled=true;$('order-result').classList.add('hidden');$('consent-label').textContent='I agree to pay the displayed amount.';$('receipt-amount').textContent='$—';$('receipt-item').textContent='No offer reviewed';$('status').textContent=config.ai?'Read the purchase terms first.':'Read the purchase terms to continue.';updateOrder();setStage('read')}
function updateOrder(){
  const reviewOnly=!config.paypal&&!pending;
  reviewCopyActions.hidden=!reviewOnly||!current;
  $('checkout-controls').hidden=reviewOnly||!!pending;
  $('step-approve').textContent=reviewOnly?'Save':'Payment';
  $('continue-payment').textContent=reviewOnly?'Review and save →':'Continue to payment →';
  const next=$('source-continue-payment');if(next)next.textContent=reviewOnly?'Keep this review →':'Continue to payment →';
  if(!pending){$('reviewed').disabled=$('consent').disabled=reviewOnly||!current;$('checkout-head').textContent=reviewOnly?'Keep this review':'Review payment';}
  if(reviewOnly&&current)$('order-result').dataset.paymentState='review';
  else if($('order-result').dataset.paymentState==='review')delete $('order-result').dataset.paymentState;
  const ok=!!current&&config.paypal&&$('reviewed').checked&&$('consent').checked;
  $('order').disabled=!ok||!!pending;$('status').textContent=!config.paypal?'Checkout is not connected.':!current?'Read the purchase terms first.':pending?'Checkout prepared.':'';
}
$('reviewed').addEventListener('change',updateOrder);$('consent').addEventListener('change',updateOrder);
$('sample').addEventListener('click',()=>{
  const entered=draftOffer();
  const hasEnteredOffer=['merchant','item','amount','terms'].some(id=>$(id).value.trim());
  const differsFromExample=['merchant','itemName','amountCents','terms'].some(key=>entered[key]!==sample[key]);
  if((current||reviewedSource||(hasEnteredOffer&&differsFromExample))&&!confirm('Replace your current offer and review with the fictional example? Your entered terms and any review will be cleared.'))return;
  if(draftRecovery)sourceImport.clearOriginals();draftRecovery?.forget();document.body.dataset.example='true';reviewedSource=null;revisionBase=null;$('merchant').value=sample.merchant;$('item').value=sample.itemName;$('amount').value=(sample.amountCents/100).toFixed(2);$('terms').value=sample.terms;resetReview();renderRevision();$('merchant').focus()});
for(const id of ['merchant','item','amount','terms'])$(id).addEventListener('input',()=>{
  document.body.dataset.example='false';comparison.update(null);
  if(id==='merchant'||id==='item')$('terms-fact-rows').sourceReadingSection=null;
  if(current){revisionBase=reviewedSource;resetReview()}
  else if(!sourcePreview.classList.contains('hidden')){sourcePreview.classList.add('hidden');sourcePreview.replaceChildren();$('empty').classList.remove('hidden')}
  renderRevision();
});
async function request(url,data,signal){const res=await fetch(url,{signal,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});let j={};try{j=await res.json()}catch{}if(!res.ok){const error=new Error(j.error||`Request failed (HTTP ${res.status})`);error.status=res.status;throw error}return j}
function appendItems(parent,items,tag){parent.replaceChildren();if(!items.length){parent.append(el('li','no-items','The review did not identify any. Ask the merchant directly.'));return}for(const item of items){parent.append(el('li',tag,item))}}
let returnToExcerpt=null;
document.addEventListener('decision-source-jump',event=>{
  const {range,from}=event.detail||{};
  if(!current||!reviewedSource||$('terms').value!==reviewedSource.terms
    ||!Number.isInteger(range?.start)||!Number.isInteger(range?.end)
    ||range.start<0||range.end>reviewedSource.terms.length||range.end<=range.start||!from?.isConnected)return;
  showReviewScreen('understand');
  if(completeReader)completeReader.showAll({focus:true,range,from});
  else showOriginal(from,range);
});
function showOriginal(from,range){
  returnToExcerpt=from;const source=$('terms');showReviewScreen('read');
  $('return-to-review').classList.remove('hidden');source.focus();
  source.setSelectionRange(range?.start||0,range?.end||0);source.scrollIntoView({behavior:'smooth',block:'center'});
}
$('return-to-review').addEventListener('click',()=>{if(!returnToExcerpt?.isConnected)return;returnToExcerpt.focus();returnToExcerpt.scrollIntoView({behavior:'smooth',block:'center'})});
$('read-complete-source').addEventListener('click',()=>completeReader?completeReader.showAll({focus:true}):showOriginal($('read-complete-source')));
function renderReview(result){const readingPosition=!sourcePreview.classList.contains('hidden')?previewReader?.capturePosition():null;const a=result.analysis,sourceOnly=a.mode==='source';current=result;
  if(Object.hasOwn(result,'sourceTopic'))$('terms-fact-rows').sourceReadingTopic={source:result.offer.terms,topic:result.sourceTopic||''};
  if(Object.hasOwn(result,'sourceSection'))$('terms-fact-rows').sourceReadingSection={source:result.offer.terms,start:result.sourceSection?.start??null};
  document.body.dataset.example=String(['merchant','itemName','amountCents','terms'].every(key=>result.offer[key]===sample[key]));
  sourcePreview.classList.add('hidden');sourcePreview.replaceChildren();completeReader=null;
  updateReviewNavigation(result.offer);
  continuity.remember(result);draftRecovery?.completed();
  $('analysis-head').textContent='Original terms';
  $('interpretation-notes').classList.toggle('hidden',sourceOnly);
  $('reviewed-label').textContent='I have read the full purchase terms.';
  if(reviewedSource)revisionBase=reviewedSource;
  reviewedSource={...result.offer,terms:result.offer.terms??$('terms').value};renderRevision();comparison.update({...result,offer:reviewedSource});comparison.mount($('review'));
  $('empty').classList.add('hidden');$('review').classList.remove('hidden');$('summary').textContent=a.summary;
  $('review-source-trail')?.remove();const trailPanel=el('section','source-trail');trailPanel.id='review-source-trail';sourceImport.renderTrail(trailPanel,reviewedSource.terms);$('read-complete-source').before(trailPanel);
  $('caution').textContent=sourceOnly?'Original source wording':'AI caution: '+a.caution;
  const evidence=$('evidence');evidence.replaceChildren();evidence.classList.toggle('source-reading',sourceOnly);
  $('read-complete-source').classList.toggle('hidden',!sourceOnly);$('return-to-review').classList.add('hidden');returnToExcerpt=null;
  if(!a.facts.length&&a.reviewMethod!=='manual')evidence.append(el('p','no-items','No source-matched evidence quotes were returned. Do not treat the summary as confirmed.'));
  for(const f of a.facts){
    const card=el('article','fact'),head=el('div','fact-head');
    head.append(el('span','fact-kind',f.kind),el('strong',null,f.label));
    const jump=el('button','source-jump','Find in source ↗');jump.type='button';
    jump.setAttribute('aria-label',`Find “${f.label}” in the original merchant terms`);
    const followSource=e=>{
      const source=$('terms'),range=sourceOnly?factSourceRange(reviewedSource.terms,f):findQuoteRange(source.value,f.quote);
      if(!range){error('The source text changed. Analyze the current offer again.');return}
      if(sourceOnly&&completeReader)completeReader.showAll({focus:true,range,from:e.currentTarget});
      else showOriginal(e.currentTarget,range);
    };jump.addEventListener('click',followSource);
    const quote=el('blockquote','quote');
    if(sourceOnly){
      head.replaceChildren(el('strong',null,f.label));
      if(f.quote.length>600){const startJump=jump.cloneNode(true);startJump.addEventListener('click',followSource);head.append(startJump)}
      for(const passage of readingPassages(f.quote))quote.append(el('span','source-passage',passage));
    }else quote.textContent='“'+f.quote+'”';
    card.append(head,quote);
    if(!sourceOnly)card.append(el('p','fact-meaning','AI interpretation (unverified): '+f.meaning));
    card.append(jump);evidence.append(card);
  }
  if(sourceOnly){
    const selections=el('div','source-reading');
    selections.append(...evidence.childNodes);
    completeReader=renderSourceReader(evidence,{source:reviewedSource.terms,facts:a.facts,selections:a.reviewMethod==='manual'?null:selections,preview:a.reviewMethod==='manual'});
    $('read-complete-source').classList.add('hidden');
  }
  updateTermsFacts(reviewedSource.terms,completeReader);document.querySelector('#label-review-actions .preview-actions')?.remove();$('review-actions').classList.remove('hidden');
  appendItems($('unknowns'),a.unknowns,'unknown');renderClarification($('questions'),$('merchant-message'),{...result,offer:reviewedSource,preferLocalDraft:!sameQuestionOffer(reviewedSource,carriedQuestions?.offer),...(sameQuestionOffer(reviewedSource,carriedQuestions?.offer)?{buyerQuestions:carriedQuestions.questions}:{})});
  const rejectedCount=a.rejectedClaims||0;
  const unmatched=a.unmatchedClaims??rejectedCount, unusable=a.unusableClaims||0, omitted=a.omittedClaims||0;
  const notices=[];
  if(unmatched)notices.push(unmatched===1
    ? '1 AI claim was excluded: its quote was not found in the pasted merchant terms.'
    : unmatched+' AI claims were excluded: their quotes were not found in the pasted merchant terms.');
  if(unusable)notices.push(unusable===1
    ? '1 AI claim was excluded: required evidence details were missing or unusable.'
    : unusable+' AI claims were excluded: required evidence details were missing or unusable.');
  if(omitted)notices.push(omitted===1
    ? '1 more AI claim was not checked or shown (eight-claim limit).'
    : omitted+' more AI claims were not checked or shown (eight-claim limit).');
  $('rejected').classList.toggle('has-rejections',rejectedCount>0);
  $('rejected').textContent=notices.length?notices.join(' ')
    : a.facts.length
      ? 'Displayed quotes match the pasted merchant text. AI interpretations remain unverified.'
      : 'No source-matched quotations were available; this review is not confirmation.';
  if(sourceOnly)$('rejected').textContent=(a.rejectedClaims?a.rejectedClaims+' invalid AI selection(s) excluded. ':'')+'Original source excerpts, including nearby conditions. No AI paraphrase or inferred rights are added.';
  $('consent-label').replaceChildren(document.createTextNode('I agree to pay '),el('strong','',currency(result.offer.amountCents)+' USD'),document.createTextNode('.'));$('receipt-amount').textContent=currency(result.offer.amountCents);$('receipt-item').textContent=result.offer.merchant+' · '+result.offer.itemName;
  $('reviewed').disabled=$('consent').disabled=false;setStage('understand');updateOrder();if(sourceOnly&&readingPosition)completeReader.restorePosition(readingPosition);else $('review').focus();
}
offerForm.addEventListener('submit',async e=>{e.preventDefault();if(!config.ai)return;if(!sourceWithinLimit())return;if($('terms').value.length>MAX_AI_SOURCE_CHARACTERS){error('AI highlights support up to 8,000 characters. Use Read terms for this complete policy.');return}resetReview();const revision=inputRevision,controller=new AbortController();activeAnalysis=controller;const submitted=draftOffer();const amountCents=submitted.amountCents;const button=$('analyze');button.disabled=true;const started=Date.now();
  const showProgress=()=>{if(revision!==inputRevision)return;const elapsed=Math.floor((Date.now()-started)/1000);button.textContent='Highlighting… '+elapsed+'s'};
  if(config.reviewMode==='source')previewSource({focus:true,pending:true});
  showProgress();const progress=setInterval(showProgress,1000);
  try{const result=await request('/api/analyze',submitted,controller.signal);if(revision!==inputRevision)return;if(JSON.stringify(submitted)!==JSON.stringify(draftOffer()))throw new Error('The offer changed during analysis. Explain the current version again.');renderReview(result);await sourceImport.rememberReviewOriginals(result.id,result.offer.terms)}catch(e){if(revision===inputRevision){previewReader?.analysisFailed();error(e.message)}}finally{clearInterval(progress);if(revision===inputRevision){activeAnalysis=null;button.disabled=!config.ai;button.textContent=reviewAction()}}
});
function showPendingOrder(result,{restored=false,canceled=false}={}){
  if(!current)return;
  pending=result;$('error').classList.add('hidden');$('checkout-controls').hidden=true;closeFiles();
  const box=$('order-result');box.replaceChildren();
  if(restored){$('reviewed').checked=$('consent').checked=true;$('reviewed').disabled=$('consent').disabled=true}
  if(['captured','refunded','partially_refunded'].includes(result.status)){
    const refunded=result.status==='refunded',partial=result.status==='partially_refunded';
    $('checkout-head').textContent=refunded?'Payment refunded':partial?'Partially refunded':'Payment complete';
    box.dataset.paymentState=result.status;
    box.append(el('p','complete',refunded?'PayPal reports this payment as refunded.':partial?'PayPal reports a partial refund for this payment.':'Your payment is confirmed.'));
    if(result.observedAt)box.append(el('p','checkout-hint','Last checked '+new Date(result.observedAt).toLocaleString()));
    const actions=el('div','payment-actions');
    const save=el('button','primary-button','Save receipt');save.type='button';save.id='save-payment-receipt';
    save.addEventListener('click',()=>saveReviewCopy(save));
    const terms=el('button','ghost-button','Review purchase terms');terms.type='button';
    terms.addEventListener('click',()=>showReviewScreen('understand',{focus:true}));
    actions.append(save,terms);box.append(actions);
    const details=el('details','payment-details'),summary=el('summary',null,'Payment details');
    details.append(summary,el('p',null,'PayPal order: '+result.orderId),el('p',null,'Capture: '+result.captureId));
    const check=el('button','ghost-button','Check payment');check.type='button';check.id='check-payment';
    check.addEventListener('click',async()=>{
      const reviewed=current,ordered=pending;check.disabled=true;check.textContent='Checking payment…';
      try{
        const r=await request('/api/payment-status',{id:reviewed.id,orderId:ordered.orderId});
        if(current!==reviewed||pending!==ordered)return;
        showPendingOrder({...ordered,...r,captureUncertain:false});
      }catch(e){if(current!==reviewed||pending!==ordered)return;error('Could not check this payment. Try again.');check.disabled=false;check.textContent='Check payment'}
    });
    details.append(check);
    box.append(details);
    box.classList.remove('hidden');setStage('approve');updateOrder();return;
  }
  const needsCheck=!!(result.captureUncertain||restored||canceled);
  const canCapture=!needsCheck&&result.canCapture===true;
  const needsApproval=!!result.approval&&(!result.paypalStatus||['CREATED','SAVED','PAYER_ACTION_REQUIRED'].includes(result.paypalStatus));
  box.dataset.paymentState=result.captureUncertain?'uncertain':needsCheck?'check':canCapture?'approved':needsApproval?'approval':'unavailable';
  $('checkout-head').textContent=needsCheck?'Check your payment':canCapture?'Complete your purchase':needsApproval?'Continue with PayPal':'Payment status';
  const observedCopy=({APPROVED:'Approved in PayPal.',VOIDED:'PayPal closed this order.',CREATED:'Approval is needed in PayPal.',SAVED:'Approval is needed in PayPal.',PAYER_ACTION_REQUIRED:'Approval is needed in PayPal.'})[result.paypalStatus]||result.observation;
  box.append(el('p',null,result.captureUncertain?'The payment response was interrupted. Check this payment before continuing.':
    observedCopy||(canceled?'Check this payment after returning from PayPal.':restored?'Check the current status of this payment.':'Approve your purchase in PayPal, then return here.')));
  if(result.observedAt)box.append(el('p','checkout-hint','Last checked '+new Date(result.observedAt).toLocaleString()));
  const actions=el('div','payment-actions');
  const link=el('a',!needsCheck&&!canCapture?'approval-link':'ghost-button','Open PayPal →');
  link.href=result.approval;link.target='_blank';link.rel='noopener noreferrer';
  const check=el('button',needsCheck||(!canCapture&&!needsApproval)?'primary-button':'ghost-button','Check payment');check.type='button';check.id='check-payment';
  const capture=el('button','primary-button capture-button','Pay '+currency(current.offer.amountCents)+' USD');capture.type='button';capture.id='complete-payment';capture.disabled=!canCapture;capture.hidden=!canCapture;
  check.addEventListener('click',async()=>{
    const reviewed=current,ordered=pending;check.disabled=true;capture.disabled=true;check.textContent='Checking payment…';
    try{
      const r=await request('/api/payment-status',{id:reviewed.id,orderId:ordered.orderId});
      if(current!==reviewed||pending!==ordered)return;
      showPendingOrder({...ordered,...r,captureUncertain:false});
    }catch(e){if(current!==reviewed||pending!==ordered)return;error(e.status&&e.status<500?e.message:'Could not check this payment. Try again.');check.disabled=false;check.textContent='Check payment'}
  });
  capture.addEventListener('click',async()=>{
    const reviewed=current,ordered=pending;capture.disabled=true;capture.textContent='Completing payment…';
    try{
      const r=await request('/api/capture',{id:reviewed.id,orderId:ordered.orderId,digest:reviewed.digest,buyerQuestions:currentBuyerQuestions()});
      if(current!==reviewed||pending!==ordered)return;
      showPendingOrder({...ordered,...r});
    }catch(e){if(current!==reviewed||pending!==ordered)return;showPendingOrder({...ordered,captureUncertain:true,canCapture:false});if(e.status&&e.status<500)error(e.message)}
  });
  if(canCapture)actions.append(capture,check);
  else if(needsCheck){actions.append(check);if(needsApproval)actions.append(link);actions.append(capture)}
  else{if(needsApproval)actions.append(link);actions.append(check,capture)}
  box.append(actions);box.classList.remove('hidden');setStage('approve');updateOrder();box.scrollIntoView({behavior:'smooth',block:'center'});
}
$('order').addEventListener('click',async()=>{
  if(!current||!$('reviewed').checked||!$('consent').checked)return;
  const reviewed=current;const button=$('order');button.disabled=true;button.textContent='Preparing checkout…';
  try{const result=await request('/api/checkout',{id:current.id,digest:current.digest,reviewedUnknowns:$('reviewed').checked,consent:$('consent').checked,buyerQuestions:currentBuyerQuestions()});if(current===reviewed)showPendingOrder(result)}
  catch(e){if(current===reviewed){error(e.status&&e.status<500?e.message:'Checkout could not be prepared. Try again.');updateOrder()}}finally{button.textContent='Continue with PayPal →'}
});
async function configureModel(){
  showModelReadiness(config,{checking:true});
  try{
    const res=await fetch('/api/config',{cache:'no-store'});
    if(!res.ok)throw new Error('Could not check AI review availability.');
    const next=await res.json();
    if(typeof next.ai!=='boolean')throw new Error('The review service returned an invalid configuration.');
    config=next;$('environment-status').textContent=config.paypal?'PayPal Sandbox':'Review only';updateOrder();

    showModelReadiness(config);if(config.ai)$('analyze').textContent=reviewAction();
  }catch(e){config={...config,ai:false};showModelReadiness(config,{failed:true});throw e}
}
$('model-recheck').addEventListener('click',()=>configureModel().catch(()=>{}));
async function init(){
  const revision=inputRevision,initialOffer=JSON.stringify(draftOffer());
  try{
    await configureModel();
    $('status').textContent=config.ai?'Read the purchase terms first.':'Connect a real AI service to enable analysis.';
    const params=new URLSearchParams(location.search),returned=params.has('return'),id=params.get('review');
    if(returned){
      if(!id)throw new Error('No review reference was returned from PayPal. No capture was attempted.');
      const response=await fetch('/api/review?id='+encodeURIComponent(id),{cache:'no-store'});
      const record=await response.json();if(!response.ok)throw new Error(record.error||'Could not restore this pending checkout.');
      if(revision!==inputRevision||initialOffer!==JSON.stringify(draftOffer())){
        continuity.remember(record);error('Your current offer has been kept. Open the earlier purchase from Continue a recent review when you are ready.');return;
      }
      $('merchant').value=record.offer.merchant;
      $('item').value=record.offer.itemName;
      $('amount').value=(record.offer.amountCents/100).toFixed(2);
      $('terms').value=record.offer.terms;
      renderReview(record);await sourceImport.restoreReviewOriginals(record.id,record.offer.terms);
      if(record.order)showPendingOrder({...record.order,status:record.status,captureId:record.captureId},{restored:true,canceled:params.has('cancel')});
      return;
    }
    if(!config.ai){$('analyze').disabled=true;$('analyze').textContent='AI unavailable';}
  }catch(e){error(e.message||'Unable to connect to the ConsentCart service.')}
}
$('edit-purchase').addEventListener('click',()=>showReviewScreen('read',{focus:true}));
$('continue-payment').addEventListener('click',()=>showReviewScreen('approve',{focus:true}));
document.addEventListener('purchase-screen',event=>{
 if(event.detail==='read')showReviewScreen('read',{focus:true});
 else if(event.detail==='understand')previewSource({focus:true});
 else if(current)showReviewScreen('approve',{focus:true});
 else{previewSource({focus:true});$('source-continue-payment')?.focus();}
});
for(const id of ['merchant','item','amount','terms'])$(id).addEventListener('input',()=>updateReviewNavigation(current?.offer));
$('sample').click();previewSource();init();continuity.refresh();

function readingSectionFor(source){
 const selected=$('terms-fact-rows').sourceReadingSection;
 if(selected?.source!==source||selected.start===null)return null;
 const heading=sourceHeadingLocations(selected.source).find(h=>h.start===selected.start);
 return heading?.plan?savedSourceSection(selected.source,{start:selected.start,heading:heading.text}):null;
}
function currentSourceSection(){return current?readingSectionFor(current.offer.terms):null}
function currentSourceTopic(){const value=$('terms-fact-rows').sourceReadingTopic;return current&&value?.source===current.offer.terms?value.topic||null:null}
async function saveReviewCopy(button,{retain=false}={}){
  if(!current)return;
  const originalSource=current.offer.terms,id=current.id,captured=['captured','refunded','partially_refunded'].includes(pending?.status);button.disabled=true;
  try{
    await sourceImport.waitForReviewOriginals();
    if(current?.id!==id||current.offer.terms!==originalSource)throw Error('The reviewed purchase changed. Save the current review instead.');
    const originalPdfs=sourceImport.originalsFor(originalSource);
    const response=await fetch('/api/review-record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,digest:current.digest,buyerQuestions:currentBuyerQuestions(),sourceSection:currentSourceSection(),sourceTopic:currentSourceTopic(),...(retain?{retain:true}:{})}),cache:'no-store'});
    if(!response.ok){const result=await response.json();throw new Error(result.error||'Could not save this review.')}
    const html=attachOriginalPdfs(await response.text(),originalPdfs,originalSource,sourceImport.trailFor(originalSource));
    const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download=captured?'ConsentCart-purchase-receipt.html':'ConsentCart-purchase-review.html';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){error(e.message)}finally{button.disabled=false}
}
$('save-review').addEventListener('click',()=>saveReviewCopy($('save-review')));

setupSavedReview({
 button:$('open-saved-review'),input:$('saved-review-file'),preview:$('saved-review-preview'),
 onAdopt:offer=>{
   document.body.dataset.example='false';
   reviewedSource=null;revisionBase=null;
   $('merchant').value=offer.merchant;$('item').value=offer.itemName;
   $('amount').value=offer.isDraft?offer.amountText:(offer.amountCents/100).toFixed(2);$('terms').value=offer.terms;
   sourceImport.restoreOriginals(offer.originalPdfs||[],offer.terms);
   sourceImport.restoreTrail(offer.sourceTrail||null,offer.terms);
   closeFiles();resetReview();draftRecovery?.adopt();
   $('terms-fact-rows').sourceReadingSection={source:offer.terms,start:offer.sourceSection?.start??null};
   $('terms-fact-rows').sourceReadingTopic={source:offer.terms,topic:offer.sourceTopic||''};
   if(offer.buyerQuestions?.length)carriedQuestions={offer:structuredClone(offer),questions:structuredClone(offer.buyerQuestions)};
   renderRevision();
   const url=new URL(location.href);
   for(const key of ['return','review','cancel','token','PayerID'])url.searchParams.delete(key);
   history.replaceState(null,'',url);
   $('reopened-review-status').textContent=offer.isDraft?'Draft loaded. Finish the offer and request a review when you are ready.':'Saved offer loaded. Review the current terms again before deciding.';
   $('merchant').focus();$('offer-head').scrollIntoView({behavior:'smooth',block:'start'});
 }
});

draftRecovery=setupDraftRecovery({form:offerForm,before:document.querySelector('.purchase-layout'),readInput:()=>({merchant:$('merchant').value,itemName:$('item').value,amount:$('amount').value,terms:$('terms').value}),isExample:()=>document.body.dataset.example==='true',onRestore:draft=>{
  resetReview();reviewedSource=null;revisionBase=null;document.body.dataset.example='false';
  $('merchant').value=draft.merchant;$('item').value=draft.itemName;$('amount').value=draft.amount;$('terms').value=draft.terms;sourceImport.clearTrail();sourceImport.restoreForSource();
  const url=new URL(location.href);for(const key of ['return','review','cancel','token','PayerID'])url.searchParams.delete(key);history.replaceState(null,'',url);
  renderRevision();updateReviewNavigation(null);showReviewScreen('read',{focus:true});$('merchant').focus();
}});

setupOfferDraft({button:$('save-offer-draft'),status:$('offer-draft-status'),readInput:()=>({merchant:$('merchant').value,itemName:$('item').value,amount:$('amount').value,terms:$('terms').value})});

$('discard-offer-draft').addEventListener('click',()=>{if($('discard-offer-draft').textContent==='Discard draft')sourceImport.clearOriginals()});
