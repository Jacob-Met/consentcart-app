import {MAX_SOURCE_CHARACTERS} from './offer-limits.js';
const format='consentcart-offer-draft';
function checkedDraft(value) {
  if(!value||typeof value!=='object')throw Error('The draft contains no editable offer.');
  const draft={};
  for(const [key,max] of [['merchant',100],['itemName',100],['amount',32],['terms',MAX_SOURCE_CHARACTERS]]) {
    if(typeof value[key]!=='string'||value[key].length>max)throw Error('The draft contains invalid '+key+' text.');
    draft[key]=value[key];
  }
  if(draft.amount!==''&&!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(draft.amount))
    throw Error('The draft price must be a number or left empty.');
  return draft;
}
export function serializeOfferDraft(value) {
  return JSON.stringify({format,version:1,currency:'USD',draft:checkedDraft(value)},null,2)+'\n';
}
export function readOfferDraft(source) {
  if(typeof source!=='string'||source.length>1000000)throw Error('Choose a saved file smaller than 1 MB.');
  let record;try{record=JSON.parse(source)}catch{throw Error('This draft file is damaged. Choose the original downloaded file.')}
  if(record?.format!==format||record.version!==1||record.currency!=='USD')
    throw Error('This is not a supported ConsentCart offer draft.');
  // Only editable input survives. Any added review, consent or payment data is discarded.
  return checkedDraft(record.draft);
}
export function setupOfferDraft({button,status,readInput}) {
  button.addEventListener('click',()=>{
    try{
      const file=serializeOfferDraft(readInput());
      const url=URL.createObjectURL(new Blob([file],{type:'application/json;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download='ConsentCart-offer-draft.json';
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      status.textContent='Draft download started. Keep the file private; open it here to continue later.';
    }catch(error){status.textContent=error.message}
  });
}
