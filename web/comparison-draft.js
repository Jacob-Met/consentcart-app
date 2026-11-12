import {savedSourceSection} from './saved-review.js';
import {MAX_SOURCE_CHARACTERS} from './offer-limits.js';
const key='consentcart.comparison-draft.v1';
const text=(value,max)=>typeof value==='string'&&value.length<=max;
export function comparisonDraft(value){
 if(!value||value.version!==1)return null;
 function record(input){
  const o=input?.offer,q=input?.buyerQuestions;
  if(!o||!text(o.merchant,100)||!text(o.itemName,100)||!text(o.terms,MAX_SOURCE_CHARACTERS)||!o.terms.trim()||!Number.isSafeInteger(o.amountCents)||o.amountCents<0||o.amountCents>1000000||!Array.isArray(q)||q.length>64)return null;
  if(q.some(x=>!text(x?.text,24000)||!text(x?.reason,24000)||(x.reply!==undefined&&!text(x.reply,24000))||(x.included!==undefined&&typeof x.included!=='boolean'))||q.reduce((n,x)=>n+x.text.length+x.reason.length+(x.reply?.length||0),0)>64000)return null;
  let sourceSection;try{sourceSection=savedSourceSection(o.terms,input.sourceSection)}catch{return null}
  return {...(sourceSection?{sourceSection}:{}),offer:{merchant:o.merchant,itemName:o.itemName,amountCents:o.amountCents,terms:o.terms},buyerQuestions:q.map(x=>({text:x.text,reason:x.reason,...(x.reply?.trim()?{reply:x.reply}:{}),...(x.included===false?{included:false}:{})})),analysis:{mode:'source',facts:[],unknowns:[],questions:[]}};
 }
 const saved=record(value.saved),current=record(value.current);
 return saved&&current?{version:1,saved,current}:null;
}
export function readComparisonDraft(storage){try{return comparisonDraft(JSON.parse(storage.getItem(key)))}catch{return null}}
export function writeComparisonDraft(storage,saved,current){
 const value=comparisonDraft({version:1,saved,current});if(!value)return false;
 try{storage.setItem(key,JSON.stringify(value));return true}catch{return false}
}
export function clearComparisonDraft(storage){try{storage.removeItem(key);return true}catch{return false}}
export function comparisonDraftStore(){try{return localStorage}catch{return null}}
