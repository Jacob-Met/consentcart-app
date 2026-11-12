// HTTP(S) references are displayed exactly as entered and opened only by a click.
export function sourceLinkParts(text){
 const parts=[];let end=0;
 for(const match of text.matchAll(/https?:\/\/[^\s<>"']+/giu)){
  let raw=match[0].replace(/[.,;!?]+$/u,'');
  while(raw.endsWith(')')&&(raw.match(/\)/g)||[]).length>(raw.match(/\(/g)||[]).length)raw=raw.slice(0,-1);
  let url;try{url=new URL(raw)}catch{continue}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)continue;
  if(match.index>end)parts.push({text:text.slice(end,match.index)});
  parts.push({text:raw,href:url.href});end=match.index+raw.length;
 }
 if(end<text.length)parts.push({text:text.slice(end)});
 return parts;
}
export function appendSourceText(node,text){
 for(const part of sourceLinkParts(text)){
  if(!part.href){node.append(document.createTextNode(part.text));continue}
  const a=document.createElement('a');a.className='source-external-link';a.href=part.href;a.textContent=part.text;a.target='_blank';a.rel='noopener noreferrer';node.append(a);
 }
}
export function sourceTextHtml(text){
 const esc=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return sourceLinkParts(text).map(p=>p.href?'<a class="source-external-link" href="'+esc(p.href)+'" target="_blank" rel="noopener noreferrer">'+esc(p.text)+'</a>':esc(p.text)).join('');
}

export function policyTextBeforeCopiedLinks(source){
 const marker='\n\nLinks in copied terms:\n',index=source.lastIndexOf(marker);
 if(index<0)return source;
 const lines=source.slice(index+marker.length).split('\n');
 if(!lines.length||!lines.every(line=>{if(/^Original local PDF — [^\r\n]{1,160}$/.test(line))return true;const match=/^.{1,160} — (https?:\/\/\S+)$/u.exec(line);if(!match)return false;try{const u=new URL(match[1]);return !u.username&&!u.password}catch{return false}}))return source;
 return source.slice(0,index);
}


// Page boundaries are explicit import metadata. Ordinary quoted URLs or headings
// do not establish a page boundary or an authenticated merchant identity.
export function sourcePageRanges(source){
 if(typeof source!=='string')return [];
 const body=policyTextBeforeCopiedLinks(source),marker='\n\nLinks in copied terms:\n';
 if(body===source)return [];
 const origins=[],files=[];
 for(const line of source.slice(body.length+marker.length).split('\n')){
  const local=/^Original local PDF — ([^\r\n]{1,160})$/.exec(line);if(local){files.push(local[1]);continue}
  const match=/^Original merchant (?:page|PDF) — (https:\/\/\S+)$/.exec(line);if(!match)continue;
  try{const url=new URL(match[1]);if(!url.username&&!url.password&&!origins.includes(url.href))origins.push(url.href)}catch{}
 }
 if(!origins.length&&!files.length)return [];
 const markers=[...body.matchAll(/(?:^|\n\n)Additional source(?:( file): ([^\r\n]+)|: (https:\/\/[^\s]+))\n\n/g)];
 const addedUrls=markers.map(m=>m[3]).filter(Boolean);
 const firstFile=/^Source file: ([^\r\n]+)\n\n/.exec(body);
 let filename=firstFile&&files.includes(firstFile[1])?firstFile[1]:null;
 const pages=[];let start=0,contentStart=filename?firstFile[0].length:0,url=filename?null:origins.find(origin=>!addedUrls.includes(origin))||null;
 const push=end=>pages.push({start,contentStart,end,url,...(filename?{filename}:{})});
 for(const match of markers){
  let next=null,nextFile=null;
  if(match[1]){if(!files.includes(match[2]))continue;nextFile=match[2]}
  else{try{next=new URL(match[3]).href}catch{continue}if(!origins.includes(next))continue}
  const boundary=match.index+(match[0].startsWith('\n\n')?2:0);push(boundary);
  start=boundary;contentStart=match.index+match[0].length;url=next;filename=nextFile;
 }
 push(body.length);return pages;
}
export function sourcePageAt(source,position){
 if(!Number.isInteger(position))return null;
 return sourcePageRanges(source).find(p=>p.start<=position&&position<p.end)||null;
}
