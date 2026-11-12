import {serializeOfferDraft,readOfferDraft} from './offer-draft.js';
export const recoveryKey='consentcart.unfinished-offer.v1';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function readRecovery(storage){try{const value=storage.getItem(recoveryKey);return value?readOfferDraft(value):null}catch{return null}}
export function writeRecovery(storage,draft){try{const serialized=serializeOfferDraft(draft);if(Object.values(readOfferDraft(serialized)).every(value=>!value.trim()))storage.removeItem(recoveryKey);else storage.setItem(recoveryKey,serialized);return true}catch{return false}}
export function setupDraftRecovery({form,before,readInput,onRestore,isExample}){
  let storage;try{storage=localStorage}catch{}
  let waiting=readRecovery(storage),edited=false;
  const box=document.createElement('section');box.className='saved-review-preview hidden';box.id='unfinished-offer-recovery';box.tabIndex=-1;
  const heading=document.createElement('h2');heading.textContent='Continue your unfinished purchase?';
  const description=document.createElement('p'),price=document.createElement('p'),terms=document.createElement('details'),summary=document.createElement('summary'),source=document.createElement('pre'),actions=document.createElement('div');actions.className='form-actions';
  terms.append(summary,source);source.style.whiteSpace='pre-wrap';source.style.overflowWrap='anywhere';source.style.font='inherit';price.id='unfinished-offer-price';
  const recover=document.createElement('button');recover.type='button';recover.id='recover-offer-draft';recover.className='primary-button';recover.textContent='Restore draft';
  const discard=document.createElement('button');discard.type='button';discard.id='discard-offer-draft';discard.className='ghost-button';discard.textContent='Discard draft';
  actions.append(recover,discard);box.append(heading,description,price,terms,actions);before.before(box);
  const status=document.createElement('p');status.id='browser-draft-status';status.setAttribute('role','status');form.append(status);
  function hide(){box.classList.add('hidden')}
  function save(){
    if(isExample())return;
    status.textContent=writeRecovery(storage,readInput())?'Unfinished input is kept in this browser. Use Save draft for a separate copy.':'This browser could not keep the latest input. Use Save draft before leaving.';
  }
  function forget(){try{storage.removeItem(recoveryKey)}catch{}waiting=null;edited=false;hide();status.textContent=''}
  function adopt(){waiting=null;edited=false;hide();save()}
  function completed(){
    const saved=readRecovery(storage);
    if(saved&&same(saved,readInput()))forget();
  }
  if(waiting&&!new URLSearchParams(location.search).has('return')){
    description.textContent=(waiting.itemName||'Untitled purchase')+(waiting.merchant?' · '+waiting.merchant:'');
    price.textContent=waiting.amount?'Entered price: $'+waiting.amount+' USD':'Price not entered';
    summary.textContent='Terms saved in this browser';source.textContent=waiting.terms||'No terms pasted yet.';
    box.classList.remove('hidden');
  }
  form.addEventListener('input',event=>{
    if(!['merchant','item','amount','terms'].includes(event.target.id))return;
    if(waiting&&!box.classList.contains('hidden')){edited=true;discard.textContent='Keep current purchase';status.textContent='Your earlier draft is still kept. Choose Restore draft or Keep current purchase.'}
    else save();
  });
  recover.addEventListener('click',()=>{
    if(!waiting)return;
    if(edited&&!confirm('Replace the purchase you are editing with the unfinished draft?'))return;
    const draft=waiting;waiting=null;edited=false;hide();onRestore(draft);save();
  });
  discard.addEventListener('click',()=>{const keep=edited;forget();if(keep)save()});
  return {adopt,forget,completed};
}
