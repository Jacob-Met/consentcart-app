export function createPdfPageNavigation({onPage}) {
 const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n};
 const select=el('select');select.id='pdf-original-page-select';select.setAttribute('aria-label','Original PDF page');
 const find=el('details');find.className='pdf-page-find';find.append(el('summary','Find a page'));
 const label=el('label','Word or phrase in the PDF');const query=el('input');query.type='search';query.maxLength=160;query.id='pdf-page-query';label.append(query);
 const status=el('p');status.id='pdf-page-find-status';status.setAttribute('role','status');
 const matches=el('select');matches.id='pdf-page-matches';matches.setAttribute('aria-label','Pages containing this wording');matches.hidden=true;
 find.append(label,status,matches);
 let original=null,current=1,found=[];
 const literal=value=>value.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&');
 const pattern=()=>query.value.trim().length<2?null:new RegExp(literal(query.value.trim()),'giu');
 let textNode=null;
 const paint=()=>{
  if(!textNode||!original)return;
  const text=original.pageText(current),expression=pattern();textNode.replaceChildren();
  let offset=0;
  if(expression)for(const match of text.matchAll(expression)){
   textNode.append(document.createTextNode(text.slice(offset,match.index)));
   const mark=el('mark',match[0]);mark.className='pdf-page-hit';textNode.append(mark);offset=match.index+match[0].length;
  }
  textNode.append(document.createTextNode(text.slice(offset)));
 };

 const showPage=value=>{const page=Number(value);if(original&&Number.isInteger(page)&&page>=1&&page<=original.pages){current=page;select.value=String(page);onPage(page)}};
 select.addEventListener('change',()=>showPage(select.value));
 matches.addEventListener('change',()=>showPage(matches.value));
 const search=()=>{
  const text=query.value.trim().toLocaleLowerCase();found=[];
  matches.replaceChildren();matches.hidden=true;status.textContent='';
  paint();if(!original||text.length<2)return;
  for(let page=1;page<=original.pages;page++)if(original.pageText(page).toLocaleLowerCase().includes(text))found.push(page);
  status.textContent=found.length?found.length+' matching '+(found.length===1?'page':'pages'):'No matching text.';
  if(!found.length)return;
  const placeholder=el('option','Choose a matching page');placeholder.value='';matches.append(placeholder);
  for(const page of found){const option=el('option','Page '+page+' of '+original.pages);option.value=String(page);matches.append(option)}
  matches.hidden=false;
 };
 query.addEventListener('input',search);
 query.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(found.length){const page=found.find(n=>n>current)||found[0];matches.value=String(page);showPage(page)}}});
 return {
  select,find,
  setDocument(value){original=value;current=1;select.replaceChildren();query.value='';find.open=false;search();if(!value)return;for(let i=1;i<=value.pages;i++){const option=el('option','Page '+i+' of '+value.pages);option.value=String(i);select.append(option)}select.value='1'},
  setPage(page,node){current=page;textNode=node;select.value=String(page);matches.value=found.includes(page)?String(page):'';paint()}
 };
}
