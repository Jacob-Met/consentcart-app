import {MAX_SOURCE_CHARACTERS} from './offer-limits.js';
export function copiedSourceLinks(html,plain){
 if(!html||html.length>1000000||!plain)return [];
 const template=document.createElement('template');template.innerHTML=html;
 const links=[],seen=new Set();
 for(const anchor of template.content.querySelectorAll('a[href]')){
  const label=anchor.textContent.trim();let url;
  try{url=new URL(anchor.getAttribute('href'))}catch{continue}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>2048)continue;
  if(!label||label.length>160||!plain.includes(label)||plain.includes(url.href)||seen.has(url.href))continue;
  seen.add(url.href);links.push({label,url:url.href});if(links.length===40)break;
 }
 return links;
}
export function setupCopiedSourceLinks(terms){
 const action=document.createElement('button');action.type='button';action.className='ghost-button';action.id='keep-copied-links';action.hidden=true;
 terms.closest('label').after(action);let links=[],snapshot=null;
 terms.addEventListener('paste',event=>{
  links=copiedSourceLinks(event.clipboardData?.getData('text/html'),event.clipboardData?.getData('text/plain'));
  action.hidden=true;action.disabled=false;snapshot=null;
  setTimeout(()=>{snapshot=terms.value;action.textContent='Keep '+links.length+' copied '+(links.length===1?'link':'links');action.hidden=!links.length;},0);
 });
 terms.addEventListener('input',()=>{if(snapshot!==null&&terms.value!==snapshot){action.hidden=true;links=[];snapshot=null}});
 action.addEventListener('click',()=>{
  if(terms.value!==snapshot||!links.length){action.hidden=true;return}
  const addition='\n\nLinks in copied terms:\n'+links.map(x=>x.label+' — '+x.url).join('\n');
  if(terms.value.length+addition.length>MAX_SOURCE_CHARACTERS){action.textContent='Links exceed the text limit';action.disabled=true;return}
  terms.value+=addition;action.hidden=true;links=[];snapshot=null;
  terms.dispatchEvent(new Event('input',{bubbles:true}));terms.focus();terms.setSelectionRange(terms.value.length-addition.length,terms.value.length);
 });
}
