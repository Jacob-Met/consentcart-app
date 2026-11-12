import {sourceSectionAt,sourceHeadingContext,sourceOccurrence} from './source.js';
import {sourcePageAt} from './source-links.js';
import {appendSourceText} from './source-links.js';
import {renderSourceCharge,sourcePercentages} from './source-charge.js';
// Suggestions are prompts to ask, never findings or merchant promises.
const clean = value => String(value ?? '').trim();
const normalized = value => clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const situationPrefix='Buyer-provided situation (not independently verified):\n';
const situationPrompt='For this purchase, which of the original conditions applies to my situation, what evidence do you need, and what outcome should I expect?';
export function buyerSituationQuestion(value) {
  const details=clean(value);
  return details ? {text:situationPrompt,reason:situationPrefix+details}:null;
}
export function buyerSituationDetails(row) {
  return row?.text===situationPrompt && typeof row.reason==='string' && row.reason.startsWith(situationPrefix)
    ? row.reason.slice(situationPrefix.length) : null;
}


function questionFor(note) {
  const text = note.toLowerCase();
  if (/final.sale/.test(text) && /damag|defect|exempt|exception/.test(text))
    return 'If this item arrives damaged or defective, does the final-sale restriction apply? Please confirm the eligibility conditions and reporting deadline.';
  if (/conflict|which policy|contradict/.test(text) && /return|refund|final.sale/.test(text))
    return 'Which return policy applies to this item: the stated return window or the final-sale restriction? Please confirm any exceptions in writing.';
  if (/refund/.test(text) && /time|process|days|long/.test(text))
    return 'If a refund is approved, when will you issue it, by which payment method, and how long should it take to arrive?';
  if (/return|refund|restock/.test(text))
    return 'Can I return this item, by what deadline, and in what condition? Please confirm the return address, postage, deductions and refund process.';
  if (/cancel/.test(text))
    return 'How and by when can I cancel this purchase or service? Please confirm any cancellation charges and when cancellation takes effect.';
  if (/recurr|subscription|renew|billing|trial/.test(text))
    return 'Is this a one-time purchase or a recurring charge? If recurring, what amount and frequency apply, when is the next charge, and how can I stop renewal?';
  if (/deliver|ship|dispatch|arriv/.test(text))
    return 'When will this item be dispatched and delivered to my location? What happens if delivery is late or the parcel is lost?';
  if (/fee|cost|tax|dut|surcharge|total/.test(text))
    return 'Is the quoted price the total I will pay? Please itemize any shipping, tax, import duty or other charge and say who collects it.';
  if (/contact|response|support|reach/.test(text))
    return 'Where can I contact you about this purchase, and how soon should I expect a response?';
  if (/warranty|guarantee|defect|damage/.test(text))
    return 'What remedy applies if this item is defective or damaged? Please confirm the reporting deadline, required evidence and who pays any return costs.';
  return 'Please clarify this point for this item: '+clean(note);
}

// Pair a specific AI question with a gap only when its subject is clear.
// Broad shared words such as "refund" or "delivery" alone are insufficient:
// eligibility, timing and remedy can be separate unanswered conditions.
const filler = new Set('a an the is are was were be been to of for in on at by from and or if it this that these those my your our i we you they do does did will would can could should please confirm what which whether how much many any not no provided specified stated missing unclear unknown point applies apply'.split(' '));
function subjectWords(text) {
  return new Set(normalized(text).split(' ').filter(word=>word.length>2&&!filler.has(word))
    .map(word=>word.replace(/(?:ing|ed|s)$/,'')));
}
function preciseTopic(text) {
  text=text.toLowerCase();
  if (/final.sale/.test(text) && /damag|defect|exempt|exception/.test(text)) return 'damaged-final-sale';
  if (/refund/.test(text) && /process|time|long|when|take/.test(text) && !/window|eligib|return by/.test(text)) return 'refund-timing';
  if (/dispatch/.test(text) && /when|promise|date|day|time|long|window|schedule/.test(text) && !/cancel|cost|fee/.test(text)) return 'dispatch';
  return null;
}
function sameQuestionSubject(gap, question) {
  const gapTopic=preciseTopic(gap), questionTopic=preciseTopic(question);
  if(gapTopic&&questionTopic)return gapTopic===questionTopic;
  // An exception to final sale must stay distinct from how to request a remedy.
  if(gapTopic==='damaged-final-sale'||questionTopic==='damaged-final-sale')return false;
  const left=subjectWords(gap),right=subjectWords(question);
  const overlap=[...left].filter(word=>right.has(word)).length;
  return overlap>=2 && overlap/Math.min(left.size,right.size)>=0.5;
}

export function clarificationQuestions(analysis = {}) {
  const rows = [], seen = new Map();
  const suggested=(analysis.questions??[]).map(clean).filter(Boolean);
  const used=new Set();
  const add = (text, reason, origin) => {
    text = clean(text);
    const key = normalized(text);
    if (!key) return;
    if(seen.has(key)){
      const row=seen.get(key);
      if(reason && !row.reason.includes(clean(reason)))row.reason=[row.reason,clean(reason)].filter(Boolean).join(' · ');
      return;
    }
    const row={text, reason:clean(reason), origin};
    seen.set(key,row);rows.push(row);
  };
  for (const note of analysis.unknowns ?? []) {
    if (!clean(note))continue;
    const matching=suggested.findIndex((question,index)=>!used.has(index)&&sameQuestionSubject(note,question));
    if(matching>=0){used.add(matching);add(suggested[matching],note,'ai')}
    else add(questionFor(note),note,'review-gap');
  }
  for (const [index,question] of suggested.entries()) {
    if(!used.has(index))add(question,'','ai');
  }
  return rows;
}

export function merchantMessage(offer, questions) {
  const selected = questions.map(question=>typeof question==='string'
    ? {text:clean(question),reason:''}
    : {text:clean(question.text),reason:clean(question.reason),reply:typeof question.reply==='string'?question.reply:'',included:question.included}).filter(question=>question.text&&question.included!==false);
  if (!selected.length) return '';
  const amount = (offer.amountCents/100).toFixed(2)+' '+(offer.currency || 'USD');
  return [
    'Hello '+clean(offer.merchant)+',',
    '',
    'About '+clean(offer.itemName)+' at the quoted price of '+amount+', please answer these questions for this exact offer:',
    '',
    ...selected.map((question, index) => (index+1)+'. '+question.text
      +(question.reason?.startsWith(situationPrefix) ? '\n   My situation (as I reported it, not independently verified): '+question.reason.slice(situationPrefix.length) : question.reason ? '\n   Please also address this point from my review: '+question.reason : '')
      +(question.reply ? '\n   Previous reply I recorded: '+question.reply : '')),
    '',
    'Please confirm the applicable terms in writing. This message asks questions only; it does not place or change an order.',
    '',
    'Merchant terms I reviewed:',
    String(offer.terms ?? ''),
  ].join('\n');
}

const node = (tag, className, text) => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
};

const draftStore='consentcart.question-drafts.v1';
const validDigest=digest=>/^[a-f0-9]{64}$/i.test(digest||'');
// An edit belongs to this exact original question and unresolved context.
// A regenerated suggestion must not silently inherit another question's edit.
export const questionDraftKey=row=>JSON.stringify([row.text,row.reason,row.origin]);
function readDraftRecord(storage,digest){
  if(!validDigest(digest))return null;
  try{
    const rows=JSON.parse(storage.getItem(draftStore)||'[]');
    return Array.isArray(rows)?rows.find(row=>row?.digest===digest&&typeof row.text==='string')||null:null;
  }catch{return null}
}
export function readQuestionDraft(storage,digest){
  return readDraftRecord(storage,digest)?.text||'';
}
const validReply=reply=>reply===undefined||(typeof reply==='string'&&reply.length<=24000);
const replyAssessment=(reply,assessment)=>reply?.trim()&&['needs-follow-up','answered'].includes(assessment);
const validReplyAssessment=row=>row.assessment===undefined||Boolean(replyAssessment(row.reply,row.assessment));
const replyFields=(reply,assessment='')=>reply?.trim()?{reply,...(replyAssessment(reply,assessment)?{assessment}:{})}:{};
export function readQuestionReply(storage,digest){return readDraftRecord(storage,digest)?.reply||''}
export function readBuyerSituation(storage,digest){return readDraftRecord(storage,digest)?.situation||''}
export function readQuestionChoices(storage,digest){
  const choices=readDraftRecord(storage,digest)?.choices;
  return Array.isArray(choices)?choices.filter(row=>row&&typeof row.key==='string'&&typeof row.text==='string'&&row.text.length<=1000&&typeof row.checked==='boolean'&&validReply(row.reply)&&validReplyAssessment(row)):[];
}
export function readSourceQuestions(storage,digest){
  const rows=readDraftRecord(storage,digest)?.sourceQuestions;
  return Array.isArray(rows)?rows.filter(row=>row&&typeof row.text==="string"&&row.text.length<=24000&&typeof row.reason==="string"&&row.reason.length<=24000&&typeof row.checked==="boolean"&&validReply(row.reply)&&validReplyAssessment(row)):[];
}
export function writeQuestionDraft(storage,digest,text,choices=[],sourceQuestions=[],reply='',situation=''){
  if(!validDigest(digest)||!validReply(reply)||typeof situation!=='string'||situation.length>3000||[...choices,...sourceQuestions].some(row=>!validReply(row.reply)||!validReplyAssessment(row)))return false;
  try{
    let rows=JSON.parse(storage.getItem(draftStore)||'[]');
    if(!Array.isArray(rows))rows=[];
    rows=rows.filter(row=>row&&row.digest!==digest&&typeof row.digest==='string'&&typeof row.text==='string');
    // An explicit empty edit must not revive an older checkout checkpoint on return.
    rows.unshift({digest,text:String(text),choices,sourceQuestions,reply,situation});
    storage.setItem(draftStore,JSON.stringify(rows.slice(0,5)));return true;
  }catch{return false}
}
// Fixed questions ask for missing details; they do not interpret or answer the policy.
export function sourceQuestion(quote,topic=null){
  if(topic)return 'For this purchase, what requirements, costs or exceptions apply to '+topic+'?';
  const text=String(quote).toLowerCase();
  if(text.length<=600){
    if(/cancel[^.!?]{0,180}processing|processing[^.!?]{0,180}cancel/.test(text)&&/renew/.test(text))return 'When does processing start, and by when must I cancel to stop the next renewal?';
    if(/damag/.test(text)&&/contact/.test(text)&&/before/.test(text))return 'What information or instructions do I need from you before returning a damaged item?';
    if(/waiv/.test(text)&&/fee|charge/.test(text))return 'Under what circumstances can this fee be waived, and what evidence would you need from me?';
    if(/repair/.test(text)&&/most|except|depend/.test(text))return 'Which repairs are not covered, and will you confirm any charge before I send the item?';
    if(/return/.test(text)&&/reject|forfeit/.test(text))return 'Which return requirements must I meet to avoid rejection or forfeiting the item?';
  }
  return 'For this purchase, which requirements, costs and exceptions apply to this condition?';
}
function replyEditor(value='',assessment=''){
  const details=node('details','question-reply-editor');
  const summary=node('summary','',value?'Reply you recorded':'Add a merchant reply');
  const label=node('label','','Reply text');
  const field=node('textarea','clarification-reply');field.rows=3;field.value=value;
  field.placeholder='Paste the reply, including who sent it and when.';
  field.setAttribute('aria-label','Reply you recorded');
  const decision=node('label','reply-applicability-label','Does this reply answer the question for this purchase?');
  const choice=node('select','reply-assessment');
  choice.setAttribute('aria-label','Your assessment of the recorded reply');
  for(const [key,text] of [['','Not assessed'],['needs-follow-up','I still need clarification'],['answered','Yes, it answers this question for my purchase']]){
    const option=node('option','',text);option.value=key;choice.append(option);
  }
  choice.value=replyAssessment(value,assessment)?assessment:'';
  choice.disabled=!value.trim();decision.append(choice);
  label.append(field);
  details.append(summary,label,decision,node('p','clarification-help','This is your assessment, not merchant verification or payment approval. Marking answered removes this question from the next outgoing message; you can include it again.'));
  details.open=Boolean(value.trim());
  field.addEventListener('input',()=>{
    summary.textContent=field.value.trim()?'Reply you recorded':'Add a merchant reply';
    const prior=choice.value;
    choice.value='';choice.disabled=!field.value.trim();
    if(prior)field.dispatchEvent(new CustomEvent('reply-assessment-reset',{detail:{prior}}));
  });
  return {details,field,assessment:choice};
}
// Earlier source questions omitted non-plan headings. Upgrade only that exact
// unlabelled context; two already-labelled sections remain distinct.
export function sameSourceQuestionContext(previous,next){
 if(previous===next)return true;
 return !previous.startsWith('Source heading: ')
   && next.startsWith('Source heading: ')
   && previous===next.replace(/^Source heading: [^\n]*\n\n/,'');
}

let appendSourceQuestion=null, cancelAttachment=null;
export function cancelSourceQuestionAttachment(){cancelAttachment?.()}
export function combinedSourceContext(previous,next){
  const separator='\n\nAdditional selected condition:\n';
  if(previous===next||previous.split(separator).includes(next))return previous;
  return previous+separator+next;
}

export function addSourceQuestion(quote,topic=null,sourceHeading=null,occurrence=null,sourceContext=null,sourceUrl=null,sourceFilename=null){
  return appendSourceQuestion?.({text:sourceQuestion(quote,topic),reason:topic?'Topic to clarify: '+topic:(sourceUrl?'Source page: '+sourceUrl+'\n\n':sourceFilename?'Source file: '+sourceFilename+'\n\n':'')+(sourceHeading?'Source heading: '+sourceHeading+'\n\n':'')+(sourceContext?'Preceding source heading: '+sourceContext+'\n\n':'')+(occurrence?'Source occurrence: '+occurrence.index+' of '+occurrence.count+'\n\n':'')+String(quote),checked:true})??false;
}

export function comparedSourceQuestion(source,ranges,topic){
 if(typeof source!=='string'||!Array.isArray(ranges)||!ranges.length||typeof topic!=='string'||topic.length>200)return null;
 const seen=new Set(),reasons=[];
 for(const range of ranges){
  if(!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<=range.start||range.end>source.length||source.slice(range.start,range.end)!==range.text)return null;
  const key=range.start+':'+range.end;if(seen.has(key))continue;seen.add(key);
  const heading=sourceSectionAt(source,range.start),page=sourcePageAt(source,range.start),url=page?.url,occurrence=sourceOccurrence(source,range);
  const preceding=heading?.plan?sourceHeadingContext(source,heading.start)?.text:null;
  reasons.push((url?'Source page: '+url+'\n\n':page?.filename?'Source file: '+page.filename+'\n\n':'')+(heading?'Source heading: '+heading.text+'\n\n':'')+(preceding?'Preceding source heading: '+preceding+'\n\n':'')+(occurrence?'Source occurrence: '+occurrence.index+' of '+occurrence.count+'\n\n':'')+range.text);
 }
 return {text:questionFor(topic)+' Please confirm which of the attached original conditions apply to this exact offer.',reason:reasons.join('\n\nAdditional selected condition:\n'),checked:true};
}
export function addComparedSourceQuestion(source,ranges,topic){
 const row=comparedSourceQuestion(source,ranges,topic);return row?appendSourceQuestion?.(row)??false:false;
}

function setSourceReason(element,text){element.replaceChildren();appendSourceText(element,text);}
// Selected excerpts are always verbatim source text. A question only helps pick
// the sentence worth reading first; it never supplies an inferred policy outcome.
function decisionSentence(source,question=''){
  const sentences=source.split(/(?<=[.!?])\s+(?=[\p{Lu}“‘])/u).map(part=>part.trim()).filter(Boolean);
  if(!sentences.length)return source.trim();
  const ignore=new Set(['which','what','where','when','your','this','that','from','with','these','those','terms','original','please','confirm','applies','apply','purchase','offer','condition','attached','merchant','question','does','the']);
  const keywords=new Set((question.toLowerCase().match(/\p{L}{4,}/gu)||[]).map(word=>word.slice(0,5)).filter(word=>!ignore.has(word)));
  const score=sentence=>{
    const lower=sentence.toLowerCase();
    const overlap=[...keywords].filter(word=>lower.includes(word)).length;
    return Math.min(overlap,5)
      +(/\bimmediately\b|\binstantly\b|\bas soon as\b/i.test(sentence)?12:0)
      +(/\b(?:end of (?:your |the |each )?(?:current )?(?:billing |subscription )?(?:period|cycle)|within \d+|before \d+|after \d+)\b/i.test(sentence)?7:0)
      +(/\b(?:unless|cannot|excluded|not refundable|no refunds?|only if)\b/i.test(sentence)?2:0);
  };
  let best=sentences[0],bestScore=score(best);
  for(const sentence of sentences.slice(1)){
    const next=score(sentence);
    if(next>bestScore){best=sentence;bestScore=next}
  }
  return best;
}
// Resolve only literal quoted source wording. Never manufacture a source location
// from the buyer's edited question or from a page title alone.
export function selectedConditionRange(source,context){
  if(typeof source!=='string'||!source||typeof context!=='string')return null;
  const parts=context.split('\n\n').map(part=>part.trim()).filter(Boolean);
  const quote=parts.filter(part=>!/^(?:Source page|Source file|Source heading|Source occurrence|Preceding source heading|Topic to clarify):/.test(part)).join('\n\n');
  if(!quote)return null;
  const page=parts.find(part=>part.startsWith('Source page: '))?.slice('Source page: '.length);
  const file=parts.find(part=>part.startsWith('Source file: '))?.slice('Source file: '.length);
  const occurrence=/^Source occurrence: (\d+) of (\d+)$/.exec(parts.find(part=>part.startsWith('Source occurrence: '))||'');
  const matches=[];let at=-1;
  while((at=source.indexOf(quote,at+1))!==-1)matches.push(at);
  if(occurrence){
    const index=Number(occurrence[1]),count=Number(occurrence[2]);
    if(count!==matches.length||index<1||index>count)return null;
    matches.splice(0,matches.length,matches[index-1]);
  }
  const qualified=matches.filter(start=>{
    const sourcePage=sourcePageAt(source,start);
    return (!page||sourcePage?.url===page)&&(!file||sourcePage?.filename===file)
      && (!sourcePage||start+quote.length<=sourcePage.end);
  });
  if(qualified.length!==1)return null;
  return {start:qualified[0],end:qualified[0]+quote.length};
}
export function selectedConditionGlances(text,question='',source=''){
  return String(text||'').split('\n\nAdditional selected condition:\n').map(chunk=>{
    const parts=chunk.split('\n\n').map(part=>part.trim()).filter(Boolean);
    const passages=parts.filter(part=>!/^(?:Source page|Source file|Source heading|Source occurrence|Preceding source heading|Topic to clarify):/.test(part));
    const excerpt=passages.join(' ').replace(/\s+/g,' ').trim();
    const chosen=excerpt.length<=250?excerpt:decisionSentence(excerpt,question);
    const heading=parts.find(part=>/^Source heading:/.test(part))?.replace(/^Source heading:\s*/, '').trim()||'';
    const range=source?selectedConditionRange(source,chunk):null;
    return chosen?{text:chosen.slice(0,300)+(chosen.length>300?'…':''),heading,...(range?{range}:{})}:null;
  }).filter(Boolean);
}
export function sourceGlance(text,question=''){
  const entries=selectedConditionGlances(text,question);
  if(!entries.length)return '';
  const count=entries.length-1;
  const passage=entries[0].text;
  return 'Provided terms · '+passage.slice(0,185)+(passage.length>185?'…':'')
    +(count?' · '+count+' additional selected '+(count===1?'condition':'conditions'):'');
}


export function renderClarification(list, composer, result) {
  cancelSourceQuestionAttachment();
  let attachmentTarget=null;
  const attachmentChanged=()=>document.dispatchEvent(new CustomEvent('source-question-target',{detail:{text:attachmentTarget?attachmentTarget.field.value:null}}));
  cancelAttachment=()=>{attachmentTarget=null;attachmentChanged()};
  let useSavedQuestions=Array.isArray(result.buyerQuestions);
  if(result.preferLocalDraft)try{if(readDraftRecord(localStorage,result.digest))useSavedQuestions=false}catch{}
  list.replaceChildren(); composer.replaceChildren();
  list.classList.add('clarification-list');
  composer.className = 'merchant-message';
  let sourceRows=[];
  if(useSavedQuestions)sourceRows=result.buyerQuestions.filter(q=>(q.reason||q.reply)&&buyerSituationDetails(q)===null).map(q=>({...q,checked:q.included!==false}));
  else try{sourceRows=readSourceQuestions(localStorage,result.digest)}catch{}
  // A saved generated question already carries its original context. Do not regenerate
  // a second editable copy, including when the buyer cleared the saved question.
  const rows = useSavedQuestions?[]:clarificationQuestions(result.analysis).filter(row=>!sourceRows.some(saved=>saved.reason===(row.reason?'Review uncertainty (unverified): '+row.reason:'AI suggestion (unverified)')));
  const selections = [];
  let restoredChoices=[];try{restoredChoices=readQuestionChoices(localStorage,result.digest)}catch{}
  const panel=document.getElementById('clarification-panel');panel.open=false;
  panel.querySelector('#reply-assessment-summary')?.remove();
  const overview=node('p','reply-assessment-summary');
  overview.id='reply-assessment-summary';overview.hidden=true;list.before(overview);
  document.getElementById('clarification-toggle').textContent=rows.length ? 'Draft '+rows.length+' '+(rows.length===1?'question':'questions')+' for the merchant' : 'Ask the merchant your own question';
  for (const [index, row] of rows.entries()) {
    const restored=restoredChoices.find(choice=>choice.key===questionDraftKey(row));
    const li = node('li', 'clarification-row');
    const label = node('label', 'clarification-choice');
    const checkbox = node('input'); checkbox.type='checkbox'; checkbox.checked=restored?.checked??true;
    checkbox.setAttribute('aria-label', 'Include question '+(index+1)+' in message');
    label.append(checkbox, node('span', '', 'Question '+(index+1)));
    const field = node('textarea', 'clarification-question');
    field.rows=Math.max(2,Math.ceil(row.text.length/35)); field.maxLength=1000; field.value=restored?.text??row.text;field.disabled=!checkbox.checked;
    field.setAttribute('aria-label', 'Edit question '+(index+1));
    const reason = node('p', 'clarification-reason', row.reason
      ? 'Review uncertainty (unverified): '+row.reason
      : 'AI suggestion (unverified)');
    const reply=replyEditor(restored?.reply||'',restored?.assessment||'');
    li.append(label, field, reason,reply.details); list.append(li);
    selections.push({checkbox,field,reply:reply.field,assessment:reply.assessment,reason:reason.textContent,key:questionDraftKey(row)});
  }
  if (!rows.length && result.analysis.reviewMethod!=='manual') list.append(node('li','no-items',
    'No questions were suggested. This does not confirm that all terms are clear; you can add your own.'));
  const situationLabel=node('label','clarification-extra','Your situation — what happened in this purchase? (optional)');
  const situation=node('textarea');situation.rows=3;situation.maxLength=3000;situation.id='merchant-case-details';
  situation.placeholder='For example: ordered on 4 November through a reseller; service was activated; I requested cancellation before renewal.';
  const savedSituation=useSavedQuestions?result.buyerQuestions.find(q=>buyerSituationDetails(q)!==null):null;
  if(savedSituation)situation.value=buyerSituationDetails(savedSituation);
  else try{situation.value=readBuyerSituation(localStorage,result.digest)}catch{}
  situationLabel.append(situation);composer.append(situationLabel);
  composer.append(node('p','clarification-help','Describe only relevant dates, purchase channel, item condition and what you already did. These are your details, not verified merchant facts.'));
  const extraLabel=node('label','clarification-extra','Your own question (optional)');
  const extra=node('textarea'); extra.rows=2; extra.maxLength=24000;extra.id='merchant-extra-question';
  extra.placeholder='Ask about a condition that matters to your purchase.';
  if(useSavedQuestions)extra.value=result.buyerQuestions.filter(q=>!q.reason&&!q.reply).map(q=>q.text).join('\n\n');
  else if(typeof result.questionDraft==='string')extra.value=result.questionDraft;
  else try{extra.value=readQuestionDraft(localStorage,result.digest)}catch{}
  extraLabel.append(extra); composer.append(extraLabel);
  let savedExtraReply='';if(!useSavedQuestions)try{savedExtraReply=readQuestionReply(localStorage,result.digest)}catch{}
  const extraReply=replyEditor(savedExtraReply);extraReply.field.id='merchant-extra-reply';extraReply.details.querySelector('.reply-applicability-label')?.remove();composer.append(extraReply.details);
  const details=node('details','merchant-preview');
  const summary=node('summary','','Preview message with the exact reviewed offer');
  const previewLabel=node('label','merchant-preview-label','Message to copy or save');
  const preview=node('textarea');preview.rows=9;preview.readOnly=true;preview.id='merchant-message-preview';
  previewLabel.append(preview); details.append(summary,previewLabel);composer.append(details);
  const actions=node('div','merchant-message-actions');
  const copy=node('button','ghost-button','Copy questions and offer');copy.type='button';copy.id='copy-merchant-message';
  const save=node('button','ghost-button','Save message ↓');save.type='button';save.id='save-merchant-message';
  actions.append(copy,save);composer.append(actions);
  const feedback=node('p','merchant-message-status');feedback.id='merchant-message-status';feedback.setAttribute('role','status');
  const note=node('p','clarification-help',result.analysis.reviewMethod==='manual'?'Copy or save your message, then send it through the merchant’s contact channel.':'The message stays with you until you send it to the merchant. Saving or copying does not resolve any question or approve checkout. It includes each selected question’s original unresolved review point and the full terms you pasted.');
  composer.append(feedback,note);
  function assessmentChanged(row){
    if(row.assessment.value==='answered'){
      row.checkbox.checked=false;
      row.field.disabled=true;
    }else if(row.assessment.value==='needs-follow-up'){
      row.checkbox.checked=true;
      row.field.disabled=false;
    }
    saveDraft();
  }
  function replyEdited(row,event){
    if(event.detail?.prior==='answered'){
      row.checkbox.checked=true;
      row.field.disabled=false;
    }
  }
  function update() {
    const selected=selections.filter(row=>row.checkbox.checked).map(row=>({text:row.field.value,reason:row.reason,...replyFields(row.reply.value,row.assessment.value)}));
    const situationQuestion=buyerSituationQuestion(situation.value);
    if(situationQuestion)selected.unshift(situationQuestion);
    if(clean(extra.value)) selected.push({text:extra.value,reason:'',...replyFields(extraReply.field.value)});
    preview.value=merchantMessage(result.offer,selected);
    copy.disabled=save.disabled=!preview.value;feedback.textContent='';
    const answered=selections.filter(row=>row.reply.value.trim()&&row.assessment.value==='answered').length;
    const followup=selections.filter(row=>row.reply.value.trim()&&row.assessment.value==='needs-follow-up').length;
    const pending=selections.filter(row=>row.reply.value.trim()&&!row.assessment.value).length;
    const replies=answered+followup+pending+(extraReply.field.value.trim()?1:0);
    overview.hidden=!replies;
    overview.textContent=replies?replies+' recorded '+(replies===1?'reply':'replies')+' · '+answered+' you marked answered · '+followup+' still need clarification · '+(pending+(extraReply.field.value.trim()?1:0))+' not assessed':'';

  }
  function saveDraft(){
    update();
    let saved=false;
    try{saved=writeQuestionDraft(localStorage,result.digest,extra.value,
      selections.filter(row=>!row.source).map(({key,field,checkbox,reply,assessment})=>({key,text:field.value,checked:checkbox.checked,...replyFields(reply.value,assessment.value)})),
      selections.filter(row=>row.source).map(({field,checkbox,reason,reply,assessment})=>({text:field.value,reason,checked:checkbox.checked,...replyFields(reply.value,assessment.value)})),extraReply.field.value,situation.value)}catch{}
    feedback.textContent=saved?'Question and reply draft saved in this browser.':([extraReply.field,...selections.map(row=>row.reply)].some(field=>field.value.length>24000)?'A reply exceeds 24,000 characters. The full text is still here; shorten it before saving or leaving.':'This browser could not keep your draft. Save this review before leaving.');
  }
  for (const row of selections) {
    const {checkbox,field,reply,assessment}=row;
    checkbox.addEventListener('change',()=>{field.disabled=!checkbox.checked;saveDraft()});
    field.addEventListener('input',()=>{assessment.value='';saveDraft()});
    reply.addEventListener('reply-assessment-reset',event=>replyEdited(row,event));
    reply.addEventListener('input',saveDraft);
    assessment.addEventListener('change',()=>assessmentChanged(row));
  }
  function addContextRow(row){
    const li=node('li','clarification-row source-question-row');
    const checkbox=node('input');checkbox.type='checkbox';checkbox.checked=row.checked!==false;
    checkbox.setAttribute('aria-label','Include this question in message');
    const label=node('label','clarification-choice');label.append(checkbox,node('span','','Include in message'));
    const field=node('textarea','clarification-question');field.rows=3;field.maxLength=24000;field.value=row.text;field.disabled=!checkbox.checked;field.setAttribute('aria-label','Edit source question');
    const context=node('details','question-context');
    const reason=node('p','clarification-reason');setSourceReason(reason,row.reason);
    context.append(node('summary','','Read all selected original conditions'),reason);context.hidden=!row.reason;
    const glance=node('p','question-source-glance',sourceGlance(row.reason));glance.hidden=!row.reason;
    const reply=replyEditor(row.reply||'',row.assessment||'');
    const attach=node('button','ghost-button attach-question-condition','Add another source condition');attach.type='button';
    const undo=node('button','ghost-button undo-question-condition','Undo last added condition');undo.type='button';undo.hidden=true;
    li.append(label,field,glance,reply.details,context,attach,undo);list.querySelector('.no-items')?.remove();list.append(li);
    const selection={checkbox,field,reply:reply.field,assessment:reply.assessment,glance,reason:row.reason,source:true,contextHistory:[],undo};selections.push(selection);
    if(sourcePercentages(row.reason).length){
      const charge=renderSourceCharge({offer:result.offer,getSource:()=>selection.reason,onOpen:()=>{context.open=true},onAdd:text=>{
        if(!checkbox.checked)return 'Include this question in the message before adding a calculation.';
        if(field.value.includes(text))return 'This calculation is already in your question.';
        const next=(field.value.trim()?field.value.trim()+'\n\n':'')+text;
        if(next.length>field.maxLength)return 'The question is too long to add this calculation. Shorten it first.';
        field.value=next;saveDraft();list.dispatchEvent(new Event('input',{bubbles:true}));return '';
      }});
      li.insertBefore(charge,reply.details);
    }

    attach.addEventListener('click',()=>{attachmentTarget=selection;attachmentChanged()});
    undo.addEventListener('click',()=>{if(!selection.contextHistory.length)return;selection.reason=selection.contextHistory.pop();selection.assessment.value='';setSourceReason(context.querySelector('.clarification-reason'),selection.reason);selection.glance.textContent=sourceGlance(selection.reason);context.hidden=!selection.reason;undo.hidden=!selection.contextHistory.length;saveDraft();list.dispatchEvent(new Event('input',{bubbles:true}))});
    checkbox.addEventListener('change',()=>{field.disabled=!checkbox.checked;saveDraft()});
    field.addEventListener('input',()=>{reply.assessment.value='';saveDraft()});
    reply.field.addEventListener('reply-assessment-reset',event=>replyEdited(selection,event));
    reply.field.addEventListener('input',saveDraft);
    reply.assessment.addEventListener('change',()=>assessmentChanged(selection));
    return field;
  }
  sourceRows.forEach(addContextRow);
  appendSourceQuestion=row=>{
    panel.open=true;
    const total=selections.reduce((n,r)=>n+r.field.value.length+r.reason.length+r.reply.value.length,extra.value.length+extraReply.field.value.length);
    if(row.reason.length>24000||(!attachmentTarget&&(total+row.text.length+row.reason.length>64000||selections.length>=63))){
      feedback.textContent='This passage is too long to add to the question draft. Select a shorter passage, or write your own question below.';extra.focus();return false;
    }
    if(attachmentTarget){
      const target=attachmentTarget, reason=combinedSourceContext(target.reason,row.reason);
      if(reason.length>24000||total+reason.length-target.reason.length>64000){feedback.textContent='These conditions exceed the saved question limit. Keep this passage as a separate question instead.';return false;}
      if(reason!==target.reason){target.contextHistory.push(target.reason);target.undo.hidden=false;}
      if(reason!==target.reason)target.assessment.value='';
      target.reason=reason;target.checkbox.checked=true;target.field.disabled=false;
      setSourceReason(target.field.closest('.clarification-row').querySelector('.clarification-reason'),reason);target.glance.textContent=sourceGlance(reason);
      target.field.closest('.clarification-row').querySelector('.question-context').hidden=false;
      cancelSourceQuestionAttachment();saveDraft();list.dispatchEvent(new Event('input',{bubbles:true}));
      target.field.focus({preventScroll:true});target.field.scrollIntoView({behavior:'instant',block:'center'});return true;
    }
    const duplicate=selections.find(r=>r.source&&sameSourceQuestionContext(r.reason,row.reason));
    const field=duplicate?.field||addContextRow(row);
    if(duplicate){duplicate.checkbox.checked=true;field.disabled=false;if(duplicate.reason!==row.reason){duplicate.assessment.value='';duplicate.reason=row.reason;setSourceReason(field.closest('.clarification-row').querySelector('.clarification-reason'),row.reason);duplicate.glance.textContent=sourceGlance(row.reason)}}
    saveDraft();list.dispatchEvent(new Event('input',{bubbles:true}));
    field.focus({preventScroll:true});field.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});return true;
  };
  situation.addEventListener('input',saveDraft);
  extra.addEventListener('input',saveDraft);extraReply.field.addEventListener('input',saveDraft);
  copy.addEventListener('click',async()=>{
    const text=preview.value;if(!text)return;
    try{
      if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      feedback.textContent='Copied. Send it through the merchant’s own contact channel when you are ready.';
    }catch{
      details.open=true;preview.focus();preview.select();
      feedback.textContent='Your browser could not copy automatically. The message is selected; use Copy, or save it as a text file.';
    }
  });
  save.addEventListener('click',()=>{
    if(!preview.value)return;
    const url=URL.createObjectURL(new Blob([preview.value],{type:'text/plain;charset=utf-8'}));
    const link=node('a');link.href=url;link.download='ConsentCart-merchant-questions.txt';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    feedback.textContent='Message saved. Your questions remain unresolved until the merchant answers.';
  });
  // Imported questions must survive a browser restart before another edit.
  if(useSavedQuestions)saveDraft();else update();
}

// Read the live composer, including unsaved edits when browser storage is refused.
export function currentBuyerQuestions(){
  const questions=[...document.querySelectorAll('.clarification-row')].filter(row=>row.querySelector('input[type="checkbox"]')?.checked||row.querySelector('.clarification-reply')?.value.trim()).map(row=>({
    text:row.querySelector('.clarification-question')?.value.trim()||'',
    reason:row.querySelector('.clarification-reason')?.textContent||'',
    ...replyFields(row.querySelector('.clarification-reply')?.value||'',row.querySelector('.reply-assessment')?.value||''),
    ...(row.querySelector('input[type="checkbox"]')?.checked?{}:{included:false})
  })).filter(row=>row.text||row.reply);
  const extra=document.getElementById('merchant-extra-question')?.value.trim();
  const reply=document.getElementById('merchant-extra-reply')?.value||'';
  if(extra||reply.trim())questions.push({text:extra||'',reason:'',...replyFields(reply)});
  const situation=buyerSituationQuestion(document.getElementById('merchant-case-details')?.value);
  if(situation)questions.unshift(situation);
  return questions;
}
