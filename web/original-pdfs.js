const MAX_PDF_BYTES=8_000_000;
const reviewKey=id=>{
 if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('Invalid recent review reference.');
 return 'review:'+id.toLowerCase();
};
export const MAX_SAVED_REVIEW_BYTES=24_000_000;
const enc=value=>btoa(Array.from(new TextEncoder().encode(value),b=>String.fromCharCode(b)).join(''));
const dec=value=>new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0)));
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function checkedOriginalPdfs(records,source){
 if(!Array.isArray(records)||records.length>4)throw Error('The saved original PDFs are invalid.');
 let total=0;
 return records.map(record=>{
  if(!record||typeof record.text!=='string'||record.text.length<80||!source.includes(record.text)||typeof record.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(record.base64)||record.base64.length>Math.ceil(MAX_PDF_BYTES/3)*4)throw Error('An original PDF does not match the saved terms.');
  const raw=atob(record.base64);total+=raw.length;
  if(raw.length>MAX_PDF_BYTES||total>16_000_000||!raw.startsWith('%PDF-'))throw Error('The saved original PDFs are too large or invalid.');
  const filename=typeof record.filename==='string'?record.filename.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,160):'Original merchant terms.pdf';
  let url=null;if(record.url){const parsed=new URL(record.url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('The original PDF address is invalid.');url=parsed.href}
  let transcriptions;
  if(record.transcriptions!==undefined){
    if(!record.transcriptions||typeof record.transcriptions!=='object'||Array.isArray(record.transcriptions))
      throw Error('Saved PDF page transcriptions are invalid.');
    const entries=Object.entries(record.transcriptions);
    if(entries.length>100)throw Error('Saved PDF page transcriptions are invalid.');
    transcriptions={};
    for(const [page,value] of entries){
      if(!/^[1-9]\d{0,2}$/.test(page)||Number(page)>100||typeof value!=='string'||
        !value.trim()||value.length>150_000||!record.text.includes(value.trim()))
        throw Error('A saved PDF transcription does not match the reviewed terms.');
      transcriptions[page]=value.trim();
    }
  }
  return {filename:filename||'Original merchant terms.pdf',url,text:record.text,base64:record.base64,
    ...(transcriptions&&Object.keys(transcriptions).length?{transcriptions}:{})};
 });
}
const safeSourceUrl=value=>{
 let parsed;
 try{parsed=new URL(value)}catch{throw Error('A recorded merchant source address is invalid.')}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.href.length>2048)
   throw Error('A recorded merchant source address is invalid.');
 return parsed.href;
};
// Records describe how source text entered the buyer's review. They do not
// claim seller identity or turn an editable saved file into a signed document.
export function checkedSourceTrail(trail,source){
 if(trail==null)return null;
 if(!trail||typeof trail!=='object'||Array.isArray(trail)||trail.snapshot!==source||
   !Array.isArray(trail.entries)||!trail.entries.length||trail.entries.length>16)
   throw Error('The source history no longer matches these reviewed terms.');
 const entries=trail.entries.map(entry=>{
   if(!entry||!['https-page','https-pdf','local-pdf'].includes(entry.kind)||
      typeof entry.text!=='string'||entry.text.length<20||entry.text.length>source.length||
      !source.includes(entry.text))
     throw Error('A recorded source does not match the reviewed wording.');
   if(entry.kind==='local-pdf'){
     if(typeof entry.filename!=='string'||!entry.filename.trim())throw Error('A saved PDF source name is missing.');
     return {kind:'local-pdf',filename:entry.filename.split(/[\\/]/).pop().slice(0,160),text:entry.text};
   }
   if(typeof entry.sha256!=='string'||!/^[0-9a-f]{64}$/.test(entry.sha256)||
      typeof entry.fetchedAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(entry.fetchedAt))
     throw Error('The source response details are invalid.');
   return {kind:entry.kind,url:safeSourceUrl(entry.url),
     requestedUrl:safeSourceUrl(entry.requestedUrl||entry.url),
     sha256:entry.sha256,fetchedAt:entry.fetchedAt,text:entry.text};
 });
 return {snapshot:source,entries};
}
export function attachOriginalPdfs(html,records,source,trail=null){
 const originals=checkedOriginalPdfs(records,source);
 const history=checkedSourceTrail(trail,source);
 if(!originals.length&&!history)return html;
 const section=originals.length?'<section id="saved-original-pdfs"><h2>Original PDF documents</h2><p>Keep these files with the extracted terms. File content is not merchant verification.</p>'+originals.map(r=>'<p><a style="display:inline-block;padding:8px 0" download="'+esc(r.filename)+'" data-consentcart-pdf="'+enc(JSON.stringify({filename:r.filename,url:r.url,text:r.text,...(r.transcriptions?{transcriptions:r.transcriptions}:{})}))+'" href="data:application/pdf;base64,'+r.base64+'">Download original PDF — '+esc(r.filename)+'</a></p>').join('')+'</section>':'';
 const trailSection=history?'<section id="saved-source-trail" data-consentcart-source-trail="'+enc(JSON.stringify(history))+'"><h2>Where these terms came from</h2><p>These are source details saved with your review, not proof of merchant identity. This HTML file is editable; revisit the original website before relying on it.</p><ul>'+
   history.entries.map(r=>r.kind==='local-pdf'
     ?'<li>PDF chosen on this device: '+esc(r.filename)+' (the sender was not authenticated)</li>'
     :'<li>Page fetched over HTTPS: <a rel="noopener noreferrer" href="'+esc(r.url)+'">'+esc(new URL(r.url).hostname)+'</a> ('+esc(r.fetchedAt)+')'+
       (new URL(r.url).hostname!==new URL(r.requestedUrl).hostname?' · redirected from '+esc(new URL(r.requestedUrl).hostname):'')+
       ' — the address is not proof that this seller controls the site</li>').join('')+'</ul></section>':'';
 const result=html.replace('</main>',trailSection+section+'</main>');
 if(result===html||result.length>MAX_SAVED_REVIEW_BYTES)
   throw Error('The review and original sources exceed the saved file limit.');
 return result;
}
export function readSourceTrail(html,source){
 const match=html.match(/data-consentcart-source-trail="([A-Za-z0-9+/=]+)"/);
 if(!match)return null;
 let trail;
 try{trail=JSON.parse(dec(match[1]))}catch{throw Error('The saved source history is damaged.')}
 return checkedSourceTrail(trail,source);
}

export function readOriginalPdfs(html,source){
 const records=[];for(const m of html.matchAll(/data-consentcart-pdf="([A-Za-z0-9+/=]+)" href="data:application\/pdf;base64,([A-Za-z0-9+/=]+)"/g)){
  let metadata;try{metadata=JSON.parse(dec(m[1]))}catch{throw Error('An original PDF attachment is damaged.')}
  records.push({...metadata,base64:m[2]});
 }
 return checkedOriginalPdfs(records,source);
}

export function originalPdfBrowserStore(database=globalThis.indexedDB){
 const open=()=>new Promise((resolve,reject)=>{
  if(!database){reject(Error('Browser document storage is unavailable.'));return}
  let request;try{request=database.open('consentcart-original-pdfs',1)}catch(error){reject(error);return}
  request.onupgradeneeded=()=>request.result.createObjectStore('documents');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 const access=async(mode,operation)=>{const db=await open();try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('documents',mode);let result;
  const request=operation(tx.objectStore('documents'));request.onsuccess=()=>{result=request.result};
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Document storage was interrupted.'));
 })}finally{db.close()}};
 return {
  async read(){const saved=await access('readonly',store=>store.get('current'));return saved?checkedOriginalPdfs(saved.records,saved.source):[]},
  async write(records,source){const checked=checkedOriginalPdfs(records,source);await access('readwrite',store=>checked.length?store.put({source,records:checked},'current'):store.delete('current'))},
  async clear(){await access('readwrite',store=>store.delete('current'))},
  // Each recent server review keeps its own checked originals. The current
  // draft key remains separate, so another purchase cannot overwrite them.
  async readReview(id,source){
   const saved=await access('readonly',store=>store.get(reviewKey(id)));
   if(!saved)return [];
   if(saved.source!==source)throw Error('The original PDF belongs to different reviewed terms.');
   return checkedOriginalPdfs(saved.records,source);
  },
  async writeReview(id,records,source){
   const key=reviewKey(id),checked=checkedOriginalPdfs(records,source);
   await access('readwrite',store=>checked.length?store.put({source,records:checked},key):store.delete(key));
  },
  async pruneReviews(ids){
   if(!Array.isArray(ids))throw Error('Recent review references are invalid.');
   const keep=new Set(ids.map(reviewKey));
   const keys=await access('readonly',store=>store.getAllKeys());
   for(const key of keys)if(typeof key==='string'&&key.startsWith('review:')&&!keep.has(key))
    await access('readwrite',store=>store.delete(key));
  }
 };
}
