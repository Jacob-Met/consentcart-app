import {MAX_SAVED_REVIEW_BYTES,readOriginalPdfs,readSourceTrail} from './original-pdfs.js';
import {sourceHeadingLocations,sourceHeadingLabel} from './source.js';
import {MAX_SOURCE_CHARACTERS} from './offer-limits.js';
import {termsFactRows} from './terms-facts.js';
import {readOfferDraft} from './offer-draft.js';
const marker='consentcart-offer-v1';
function validatedOffer(value) {
  if(!value||typeof value!=='object')throw Error('The saved review has no usable offer.');
  for(const [key,min,max] of [['merchant',2,100],['itemName',2,100],['terms',80,MAX_SOURCE_CHARACTERS]])
    if(typeof value[key]!=='string'||value[key].trim().length<min||value[key].length>max)
      throw Error('The saved review has invalid '+(key==='terms'?'merchant terms':key==='itemName'?'item details':'merchant details')+'.');
  if(value.currency!=='USD'||!Number.isSafeInteger(value.amountCents)||value.amountCents<1||value.amountCents>1000000)
    throw Error('The saved review must have a USD price between 0.01 and 10,000.00.');
  // Deliberately discard analysis, approval, order, status, URLs and identifiers.
  return {merchant:value.merchant,itemName:value.itemName,amountCents:value.amountCents,currency:'USD',terms:value.terms};
}
export function savedBuyerQuestions(value=[]){
  if(!Array.isArray(value)||value.length>64)throw Error('The saved questions are invalid.');
  const questions=value.map(q=>{
    if(q?.reply&&typeof q.text==='string'&&!q.text.trim())throw Error('Keep the question text with its recorded reply before saving.');
    if(q?.included!==undefined&&typeof q.included!=='boolean')throw Error('The saved question selection is invalid.');
    if(q?.reply!==undefined&&(typeof q.reply!=='string'||q.reply.length>24000))throw Error('A recorded reply must be text of at most 24,000 characters.');
    if(q?.assessment!==undefined&&(!['needs-follow-up','answered'].includes(q.assessment)||typeof q.reply!=='string'||!q.reply.trim()))throw Error('A buyer reply assessment needs a recorded response.');
    if(!q||typeof q.text!=='string'||!q.text.trim()||q.text.length>24000||typeof q.reason!=='string'||q.reason.length>24000)throw Error('The saved questions are invalid.');
    return {text:q.text,reason:q.reason,...(q.reply?.trim()?{reply:q.reply,...(q.assessment?{assessment:q.assessment}:{})}:{}),...(q.included===false?{included:false}:{})};
  });
  if(questions.reduce((n,q)=>n+q.text.length+q.reason.length+(q.reply?.length||0),0)>64000)throw Error('The saved questions exceed the supported size.');
  return questions;
}
export function replyAssessmentLabel(question){
  if(!question?.reply?.trim())return 'Awaiting a reply';
  if(question.assessment==='answered')return 'You marked this answered for your purchase (not independently confirmed)';
  if(question.assessment==='needs-follow-up')return 'You still need clarification';
  return 'Reply recorded, not yet assessed';
}
export function savedSourceSection(source,value){
  if(value==null)return null;
  const heading=sourceHeadingLocations(source).find(h=>h.plan&&h.start===value.start);
  if(!heading||value.heading!==heading.text)throw Error('The saved reading section no longer matches the original terms.');
  return {start:heading.start,heading:heading.text};
}
export function savedSourceTopic(source,value){
  if(value==null||value==='')return null;
  if(typeof value!=='string'||!termsFactRows(source).some(row=>row.id===value&&row.passages.length))throw Error('The saved reading condition no longer matches the original terms.');
  return value;
}
export function savedOfferMetadata(offer,buyerQuestions=[],sourceSection=null,sourceTopic=null) {
  // Export remains a readable snapshot; validation belongs at the import boundary.
  const {merchant,itemName,amountCents,currency,terms}=offer;
  const bytes=new TextEncoder().encode(JSON.stringify({version:1,offer:{merchant,itemName,amountCents,currency,terms},buyerQuestions:savedBuyerQuestions(buyerQuestions),...(sourceSection?{sourceSection:savedSourceSection(terms,sourceSection)}:{}),...(sourceTopic?{sourceTopic:savedSourceTopic(terms,sourceTopic)}:{})}));
  return '<meta name="'+marker+'" content="'+btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''))+'">';
}
const decoded=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
export function readSavedOffer(source) {
  if(typeof source!=='string'||source.length>MAX_SAVED_REVIEW_BYTES)throw Error('Choose a ConsentCart HTML review smaller than 24 MB.');
  const match=source.match(/<meta name="consentcart-offer-v1" content="([A-Za-z0-9+/=]+)">/);
  if(match) {
    let data;
    try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(match[1]),c=>c.charCodeAt(0))))}
    catch{throw Error('The saved offer data is damaged. Open the readable review to recover the original terms.')}
    if(data.version!==1)throw Error('This saved offer version is not supported.');
    const offer=validatedOffer(data.offer),questions=savedBuyerQuestions(data.buyerQuestions);
    const sourceSection=savedSourceSection(offer.terms,data.sourceSection),sourceTopic=savedSourceTopic(offer.terms,data.sourceTopic);
    const originalPdfs=readOriginalPdfs(source,offer.terms);
    const sourceTrail=readSourceTrail(source,offer.terms);
    return {...offer,...(sourceTrail?{sourceTrail}:{}),...(originalPdfs.length?{originalPdfs}:{}),...(questions.length?{buyerQuestions:questions}:{}),...(sourceSection?{sourceSection}:{}),...(sourceTopic?{sourceTopic}:{})};
  }
  // Earlier ConsentCart releases already exported these escaped, fixed labels.
  // Read their text without rendering or executing any uploaded HTML.
  if(!source.includes('<title>ConsentCart purchase review</title>')||!source.includes('CONSENTCART / SAVED PURCHASE REVIEW'))
    throw Error('This is not a recognized ConsentCart saved review. Choose the HTML file downloaded with “Save this review”.');
  const item=source.match(/<h1>([^<]*)<\/h1>/);
  const merchant=source.match(/<dt>Merchant as entered<\/dt><dd>([^<]*)<\/dd>/);
  const amount=source.match(/<dt>Exact reviewed price<\/dt><dd>(\d+\.\d{2}) USD<\/dd>/);
  const terms=source.match(/<h2>Merchant terms reviewed<\/h2><p>[^<]*<\/p><pre>([^<]*)<\/pre>/);
  if(!item||!merchant||!amount||!terms)throw Error('This review does not contain the complete original offer. Open it and copy the terms manually.');
  const [whole,fraction]=amount[1].split('.');
  return validatedOffer({itemName:decoded(item[1]),merchant:decoded(merchant[1]),amountCents:Number(whole)*100+Number(fraction),currency:'USD',terms:decoded(terms[1])});
}
function el(tag,text){const item=document.createElement(tag);if(text!==undefined)item.textContent=text;return item}
export function setupSavedReview({button,input,preview,onAdopt}) {
  button.addEventListener('click',()=>input.click());
  input.addEventListener('change',async()=>{
    const file=input.files?.[0];if(!file)return;
    preview.replaceChildren();preview.classList.remove('hidden');
    try{
      if(file.size>MAX_SAVED_REVIEW_BYTES)throw Error('Choose a saved file smaller than 24 MB.');
      const source=await file.text(),isDraft=source.trimStart().startsWith('{');
      const draft=isDraft?readOfferDraft(source):null;
      const offer=isDraft?{...draft,amountText:draft.amount,isDraft:true}:readSavedOffer(source);
      preview.append(el('h3',isDraft?'Continue this offer draft?':'Reopen this offer?'));
      const facts=el('dl');
      for(const [name,value] of [['Merchant',offer.merchant||'Not entered'],['Item',offer.itemName||'Not entered'],['Price',isDraft?(draft.amount?draft.amount+' USD (draft)':'Not entered'):(offer.amountCents/100).toFixed(2)+' USD']])
        facts.append(el('dt',name),el('dd',value));
      if(offer.sourceSection)facts.append(el('dt','Reading section'),el('dd',sourceHeadingLabel(offer.terms,offer.sourceSection.start)));
      if(offer.sourceTopic)facts.append(el('dt','Reading condition'),el('dd',termsFactRows(offer.terms).find(row=>row.id===offer.sourceTopic)?.label||offer.sourceTopic));
      if(offer.originalPdfs?.length)facts.append(el('dt','Original PDF documents'),el('dd',String(offer.originalPdfs.length)));
      preview.append(facts,el('p',isDraft?'Continue editing this unreviewed input. Missing details can be filled in later. The file is unverified and does not restore consent or checkout.':'Load the original terms into a fresh review. The saved file is unverified; past explanations, consent and checkout are not restored.'));
      if(offer.buyerQuestions?.length){
        const questions=el('details'),heading=el('summary',offer.buyerQuestions.length+(offer.buyerQuestions.some(q=>q.reply)?' saved ':' unresolved ')+(offer.buyerQuestions.length===1?'question':'questions'));
        const list=el('ul');for(const q of offer.buyerQuestions){const item=el('li',q.text);
          item.append(el('p',replyAssessmentLabel(q)));
          if(q.reason)item.append(el('p',q.reason));
          if(q.reply){const reply=el('details');reply.open=true;reply.append(el('summary','Reply you recorded'),el('p',q.reply));item.append(reply)}
          list.append(item)}
        questions.append(heading,list);preview.append(questions);
      }
      const use=el('button',isDraft?'Continue editing this draft':'Use this offer for a new review');use.type='button';use.id='adopt-saved-review';use.className='primary-button';
      const cancel=el('button','Keep current offer');cancel.type='button';cancel.id='cancel-saved-review';cancel.className='ghost-button';
      const actions=el('div');actions.className='saved-review-actions';actions.append(use,cancel);preview.append(actions);
      const clear=()=>{preview.replaceChildren();preview.classList.add('hidden');input.value=''};
      cancel.addEventListener('click',clear);
      use.addEventListener('click',()=>{onAdopt(offer);clear()});
      preview.focus();
    }catch(error){
      const message=el('p',error.message);message.setAttribute('role','alert');
      const close=el('button','Keep current offer');close.type='button';close.className='ghost-button';
      close.addEventListener('click',()=>{preview.replaceChildren();preview.classList.add('hidden');input.value=''});
      preview.append(message,close);preview.focus();
    }
  });
}
