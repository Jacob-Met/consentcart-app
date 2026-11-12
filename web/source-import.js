import {createPdfPageNavigation} from './pdf-page-navigation.js';
import {createScannedPageReader,turnScannedPage} from './scanned-ocr.js';
import {checkedOriginalPdfs,checkedSourceTrail,originalPdfBrowserStore} from './original-pdfs.js';
import {MAX_SOURCE_CHARACTERS} from './offer-limits.js';
import {importedPdfText,importedPdfFile} from './pdf-source.js';
import {copiedSourceLinks} from './copied-source-links.js';
import {policyTextBeforeCopiedLinks} from './source-links.js';

export function importedPageText(page){
 const url=new URL(page.url);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('The imported page has no usable source address.');
 let text,title=url.hostname,links=[];
 if(/^text\/plain(?:;|$)/i.test(page.contentType||''))text=page.text.trim();
 else{
  // A template stays inert. Imported HTML is never inserted into the live page.
  const template=document.createElement('template');template.innerHTML=page.text;
  title=template.content.querySelector('title')?.textContent.trim()||title;
  const mains=template.content.querySelectorAll('main,[role="main"]');
  const articles=template.content.querySelectorAll('article');
  const region=mains.length===1?mains[0]:articles.length===1?articles[0]:template.content;
  const content=region.cloneNode(true);
  for(const e of content.querySelectorAll('script,style,noscript,template,svg,nav,[hidden],[aria-hidden="true"]'))e.remove();
  const blocks=new Set(['ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','DIV','DL','DT','DD','FIGCAPTION','FIGURE','FOOTER','H1','H2','H3','H4','H5','H6','HEADER','HR','LI','MAIN','OL','P','PRE','SECTION','TABLE','TR','UL']);
  const walk=node=>{
   if(node.nodeType===3)return node.textContent.replace(/[ \t\r\n\f]+/g,' ');
   if(node.nodeType!==1&&node.nodeType!==11)return '';
   if(node.nodeName==='BR')return '\n';
   const inner=[...node.childNodes].map(walk).join('');
   if(node.nodeName==='TD'||node.nodeName==='TH')return inner+'\t';
   return blocks.has(node.nodeName)?'\n\n'+inner+'\n\n':inner;
  };
  text=walk(content).replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  for(const anchor of content.querySelectorAll('a[href]')){
   try{anchor.setAttribute('href',new URL(anchor.getAttribute('href'),url).href)}catch{anchor.removeAttribute('href')}
  }
  const container=document.createElement('div');container.append(content);
  links=copiedSourceLinks(container.innerHTML,text);
 }
 if(text.length<80)throw Error('This page did not provide enough readable terms. Open the original page and paste its terms.');
 const references=[{label:'Original merchant page',url:url.href},...links.filter(link=>link.url!==url.href)];
 const terms=text+'\n\nLinks in copied terms:\n'+references.map(link=>link.label+' — '+link.url).join('\n');
 if(terms.length>MAX_SOURCE_CHARACTERS)throw Error('This page is too long to import completely. Open it and paste the original terms for this offer.');
 return {terms,text,url:url.href,title};
}


export function addMerchantPage(existing,page){
 const original=policyTextBeforeCopiedLinks(existing),incoming=policyTextBeforeCopiedLinks(page.terms);
 if(!original.trim())return page.terms;
 if(original.includes(page.text)&&existing.includes(page.url||page.filename))throw Error('This page is already in your purchase terms.');
 const marker='\n\nLinks in copied terms:\n';
 const references=[...new Set([existing.slice(original.length),page.terms.slice(incoming.length)].flatMap(t=>t.startsWith(marker)?t.slice(marker.length).split('\n'):[]))];
 const heading=page.url?'Additional source: '+page.url:'Additional source file: '+page.filename;
 const combined=original+'\n\n'+heading+'\n\n'+incoming+(references.length?marker+references.join('\n'):'');
 if(combined.length>MAX_SOURCE_CHARACTERS)throw Error('Both pages exceed the text limit. Your current terms are unchanged; keep this page separately.');
 return combined;
}

export function setupSourceImport(terms,{beforeAdd,afterAdd}={}){
 const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n};
 const section=node('section','source-import');section.setAttribute('aria-label','Import merchant terms');
 const label=node('label',null,'Terms page URL');const address=node('input');address.id='merchant-source-url';address.type='text';address.inputMode='url';address.placeholder='https://merchant.example/terms';address.autocomplete='url';label.append(address);
 const fetchButton=node('button','ghost-button','Preview page');fetchButton.id='preview-merchant-source';fetchButton.type='button';
 const file=node('input');file.type='file';file.accept='.pdf,application/pdf';file.id='merchant-source-file';file.hidden=true;
 const fileButton=node('button','ghost-button','Choose a PDF');fileButton.type='button';fileButton.id='choose-merchant-pdf';fileButton.addEventListener('click',()=>file.click());
 const status=node('p','source-import-status');status.id='merchant-source-status';status.setAttribute('role','status');
 const preview=node('section','source-import-preview');preview.id='merchant-source-preview';preview.hidden=true;
 const heading=node('h3',null,'Review imported terms'),origin=node('a','source-external-link');origin.target='_blank';origin.rel='noopener noreferrer';
 const count=node('p','source-import-count'),copy=node('textarea');copy.readOnly=true;copy.rows=9;copy.id='merchant-source-preview-text';copy.setAttribute('aria-label','Imported page text');
 const use=node('button','primary-button','Use these terms');use.id='use-merchant-source';use.type='button';
 const add=node('button','ghost-button','Add to these terms');add.id='add-merchant-source';add.type='button';
 const cancel=node('button','ghost-button','Cancel import');cancel.id='cancel-merchant-source';cancel.type='button';
 const pdfControls=node('div','pdf-preview-controls'),previousPage=node('button','ghost-button','Previous page'),nextPage=node('button','ghost-button','Next page'),pageCount=node('span');
 const pageNavigation=createPdfPageNavigation({onPage:page=>{pdfIndex=page;renderPdf()}});
 previousPage.type=nextPage.type='button';previousPage.id='pdf-preview-previous';nextPage.id='pdf-preview-next';pageCount.id='pdf-preview-page';pageCount.hidden=true;pdfControls.append(previousPage,pageNavigation.select,pageCount,nextPage);
 const openPdf=node('a','source-external-link','Open original PDF');openPdf.target='_blank';openPdf.rel='noopener noreferrer';openPdf.id='open-original-pdf';pdfControls.append(openPdf);
 const enlarge=node('button','ghost-button','Enlarge original page');enlarge.type='button';enlarge.id='enlarge-original-pdf';pdfControls.append(enlarge);
 const pdfView=node('section','pdf-source-comparison');pdfView.hidden=true;
 const canvas=node('canvas');canvas.id='pdf-original-page';canvas.setAttribute('aria-label','Original PDF page');
 const originalPage=node('div','pdf-original-page'),extractedPage=node('pre','pdf-extracted-page');extractedPage.id='pdf-extracted-page';
 originalPage.tabIndex=0;originalPage.setAttribute('role','region');originalPage.setAttribute('aria-label','Original merchant PDF page: swipe or use arrow keys to inspect the wording');
 const manualPanel=node('section','pdf-page-manual');manualPanel.hidden=true;
 const manualHeading=node('h4',null,'Transcribe this scanned page'),manualHelp=node('p',null,
   'Read English or Spanish wording on this device. Swipe the original image to check every suggested word before including this page.');
 const ocrButton=node('button','ghost-button','Read this page on my device');ocrButton.type='button';ocrButton.id='pdf-page-ocr';ocrButton.classList.add('ocr-read');
 const ocrStatus=node('p','source-import-status');ocrStatus.id='pdf-page-ocr-status';ocrStatus.setAttribute('role','status');
 const manualLabel=node('label',null,'Text visible on this original page');
 const manualText=node('textarea');manualText.id='pdf-manual-page-text';manualText.rows=5;manualText.setAttribute('aria-label','Text visible on scanned PDF page');
 manualLabel.append(manualText);
 const manualSave=node('button','primary-button','Include this page');manualSave.type='button';manualSave.id='pdf-manual-save';
 manualPanel.append(manualHeading,manualHelp,ocrButton,ocrStatus,manualLabel,manualSave);
 originalPage.append(canvas);const extractedColumn=node('div','pdf-text-column');extractedColumn.append(extractedPage,manualPanel);pdfView.append(originalPage,extractedColumn);
 const completeCopy=node('details','pdf-complete-copy');completeCopy.hidden=true;completeCopy.append(node('summary',null,'Complete extracted text'));
 let pdfIndex=1,renderSequence=0,enlarged=false,scanTicket=0;
 const scanReader=createScannedPageReader();
 window.addEventListener('pagehide',()=>scanReader.terminate().catch(()=>{}));
 const renderPdf=async()=>{const ticket=++renderSequence,resource=pending?.preview;if(!resource)return;
 scanTicket++;ocrButton.disabled=false;ocrStatus.textContent='';
 previousPage.disabled=pdfIndex<=1;nextPage.disabled=pdfIndex>=pending.pages;pageCount.textContent='Page '+pdfIndex+' of '+pending.pages;
 const scanned=pending.scannedPages?.includes(pdfIndex);
 pdfView.classList.toggle('pdf-scanned',!!scanned);extractedPage.hidden=!!scanned;manualPanel.hidden=!scanned;
 if(scanned){manualHeading.textContent='Scanned page '+pdfIndex+' — check its text';manualText.value=pending.transcriptions?.[pdfIndex]||''}
 extractedPage.textContent=resource.pageText(pdfIndex);pageNavigation.setPage(pdfIndex,extractedPage);canvas.setAttribute('aria-label','Original PDF page '+pdfIndex);try{canvas.dataset.renderedPage='';const narrow=matchMedia('(max-width:600px)').matches;
 const renderWidth=scanned&&narrow?(enlarged?1150:840):(enlarged?900:(originalPage.clientWidth||640));
 await resource.render(pdfIndex,canvas,renderWidth);if(ticket===renderSequence)canvas.dataset.renderedPage=String(pdfIndex)}catch(error){if(ticket===renderSequence&&error.name!=='RenderingCancelledException')status.textContent='The original page could not be displayed. Check the original PDF before using the extracted text.'}};
 ocrButton.addEventListener('click',async()=>{
   const resource=pending?.preview,page=pdfIndex;
   if(!resource||!pending.scannedPages?.includes(page))return;
   const ticket=++scanTicket,initial=manualText.value;
   ocrButton.disabled=true;ocrStatus.textContent='Reading the original page on this device…';
   let image=null;
   try{
     image=await resource.renderForRecognition(page);
     const result=await scanReader.read(image,progress=>{
       if(ticket===scanTicket)ocrStatus.textContent='Reading the original image ('+progress+'%)…';
     });
     if(ticket!==scanTicket||pending?.preview!==resource||pdfIndex!==page)return;
     if(manualText.value!==initial){
       ocrStatus.textContent='Your newer edits were kept. Use the original image to finish this page.';
       return;
     }
     manualText.value=result.text;
     if(result.rotation&&canvas.dataset.renderedPage===String(page)){
       // Turn only the displayed image; the PDF and saved original stay unchanged.
       const upright=turnScannedPage(canvas,result.rotation);
       canvas.width=upright.width;canvas.height=upright.height;
       canvas.getContext('2d',{alpha:false}).drawImage(upright,0,0);
       upright.width=upright.height=0;
       originalPage.scrollLeft=originalPage.scrollTop=0;
     }
     ocrStatus.textContent=(result.rotation?'Original image turned upright. ':'')+
       'Suggested words are ready. Compare dates, prices and exclusions against the original image, correct any errors, then include this page.';
     manualText.focus({preventScroll:true});
   }catch(error){
     if(ticket===scanTicket)
       ocrStatus.textContent='Automatic reading could not finish. Enter the visible page wording yourself. '+(error?.message||'');
   }finally{
     if(image)image.width=image.height=0;
     if(ticket===scanTicket)ocrButton.disabled=false;
   }
 });
 enlarge.addEventListener('click',()=>{enlarged=!enlarged;pdfView.classList.toggle('pdf-enlarged',enlarged);enlarge.textContent=enlarged?'Fit original page':'Enlarge original page';enlarge.setAttribute('aria-pressed',String(enlarged));renderPdf();if(matchMedia('(min-width:1000px)').matches)preview.scrollIntoView({block:'start',behavior:'instant'})});
 previousPage.addEventListener('click',()=>{if(pdfIndex>1){pdfIndex--;renderPdf()}});nextPage.addEventListener('click',()=>{if(pending&&pdfIndex<pending.pages){pdfIndex++;renderPdf()}});
 const actions=node('div','source-import-actions');actions.append(use,add,cancel);preview.append(heading,origin,count,pdfControls,pageNavigation.find,pdfView,completeCopy,copy,actions);pdfControls.hidden=true;const importActions=node('div','source-import-actions');importActions.append(fetchButton,fileButton);section.append(label,importActions,file,status,preview);terms.closest('label').before(section);
 let pending=null,controller=null,sequence=0,originals=[],originalEpoch=0;
 let sourceTrail=null,sourceTrailRestored=false;
 const originalStore=originalPdfBrowserStore();let persistQueue=Promise.resolve(),originalsReviewId=null;
 const originalStatus=node('p','source-import-status');originalStatus.id='original-pdf-storage-status';originalStatus.setAttribute('role','status');section.append(originalStatus);
 const persistOriginals=()=>{const epoch=++originalEpoch,source=terms.value;originals=originals.filter(r=>source.includes(r.text));const records=originals.slice();originalStatus.textContent=records.length?'Keeping original PDF in this browser…':'';persistQueue=persistQueue.catch(()=>{}).then(()=>originalStore.write(records,source)).then(()=>{if(epoch===originalEpoch)originalStatus.textContent=records.length?'Original PDF kept in this browser.':''},()=>{if(epoch===originalEpoch&&records.length)originalStatus.textContent='This browser could not keep the original PDF. Save the review before leaving.'});return persistQueue};
 const kept=node('section','kept-original-pdfs');kept.id='kept-original-pdfs';section.append(kept);
 const closeOriginal=node('button','ghost-button','Close original comparison');closeOriginal.type='button';closeOriginal.hidden=true;preview.append(closeOriginal);closeOriginal.addEventListener('click',()=>reset());
 const refreshAdoption=()=>{
   if(!pending)return;
   const incomplete=pending.missingPages?.length||0;
   use.disabled=add.disabled=!!incomplete;
   copy.value=pending.terms||pending.text;
   count.textContent=incomplete?
     incomplete+' scanned '+(incomplete===1?'page still needs':'pages still need')+' its visible text. Review the original image and include every page before using these terms.':
     pending.text.length.toLocaleString()+' characters from '+pending.pages+' PDF pages. Review the wording before using it.';
 };
 manualSave.addEventListener('click',()=>{
   if(!pending||!pending.preview)return;
   scanTicket++;ocrButton.disabled=false;
   try{
     pending.setPageTranscription(pdfIndex,manualText.value);
     refreshAdoption();
     extractedPage.textContent=pending.preview.pageText(pdfIndex);
     pageNavigation.setPage(pdfIndex,extractedPage);
     const remaining=pending.missingPages.length;
     status.textContent=remaining?
       'Page '+pdfIndex+' included. '+remaining+' scanned '+(remaining===1?'page remains.':'pages remain.'):
       'Every original page now has text. Check the transcription against the image before using these terms.';
     const next=pending.missingPages[0];
     if(next&&next!==pdfIndex){pdfIndex=next;renderPdf()}
   }catch(error){status.textContent=error.message}
 });
 const relevant=source=>originals.filter(r=>source.includes(r.text));
 const showOriginals=()=>{kept.replaceChildren();for(const record of relevant(terms.value)){const button=node('button','ghost-button','Compare original PDF — '+record.filename);button.type='button';button.addEventListener('click',async()=>{if(!terms.value.includes(record.text)){showOriginals();return}reset();const ticket=sequence,snapshot=terms.value;status.textContent='Opening saved original PDF…';try{const bytes=Uint8Array.from(atob(record.base64),c=>c.charCodeAt(0));const result=record.url?await importedPdfText({url:record.url,contentType:'application/pdf',bytes:bytes.length,pdfBase64:record.base64},{preview:true,transcriptions:record.transcriptions}):await importedPdfFile({name:record.filename,size:bytes.length,arrayBuffer:async()=>bytes.buffer},{preview:true,transcriptions:record.transcriptions});if(ticket!==sequence){result.preview?.dispose();return}if(result.text!==record.text){result.preview?.dispose();throw Error('This PDF extraction differs from the saved terms. Keep the saved wording and check the original separately.')}present(result,snapshot);actions.hidden=true;closeOriginal.hidden=false;status.textContent='Comparing the saved original. Your terms and questions are unchanged.'}catch(error){if(ticket===sequence)status.textContent=error.message}});kept.append(button)}};
 const reset=message=>{sequence++;renderSequence++;scanTicket++;pending?.preview?.dispose().catch(()=>{});canvas.width=canvas.height=0;controller?.abort();controller=null;pending=null;preview.hidden=true;fetchButton.disabled=false;status.textContent=message||''};
 address.addEventListener('input',()=>reset());
 terms.addEventListener('input',()=>{sourceTrail=null;sourceTrailRestored=false;originalsReviewId=null;persistOriginals();showOriginals();if(pending||controller)reset('The purchase terms changed. Preview the page again before replacing them.')});
 cancel.addEventListener('click',()=>reset('Import cancelled. Your purchase terms are unchanged.'));
 const present=(result,snapshot)=>{
   pending=result;pending.snapshot=snapshot;add.hidden=!snapshot.trim()||document.body.dataset.example==='true';use.textContent=snapshot.trim()?'Replace purchase terms':'Use these terms';copy.value=result.terms;if(result.url)origin.href=result.url;else origin.removeAttribute('href');origin.textContent=result.url||('Source file: '+result.filename);
   const isPdf=!!result.preview;pdfView.hidden=pdfControls.hidden=completeCopy.hidden=pageNavigation.find.hidden=!isPdf;pageNavigation.setDocument(isPdf?{pages:result.pages,pageText:result.preview.pageText}:null);if(isPdf){openPdf.href=result.preview.originalUrl;completeCopy.append(copy);completeCopy.open=false;pdfIndex=1;enlarged=false;pdfView.classList.remove('pdf-enlarged');enlarge.textContent='Enlarge original page';enlarge.setAttribute('aria-pressed','false')}else preview.insertBefore(copy,actions);
   heading.textContent=result.title;
   count.textContent=result.text.length.toLocaleString()+' characters from '+(result.pages?result.pages+' PDF pages':'the page')+'. Review the text before using it.';
   actions.hidden=false;closeOriginal.hidden=true;preview.hidden=false;
   if(result.preview)refreshAdoption();else{use.disabled=false;add.disabled=false}
   status.textContent=result.missingPages?.length?
     'Some PDF pages are scanned. Use the page selector to read and include their terms beside the original before adopting the document.':
     'Your purchase terms have not changed.';
   if(result.missingPages?.length)pdfIndex=result.missingPages[0];
   preview.scrollIntoView({block:'nearest',behavior:'instant'});
   if(result.preview)renderPdf();
   (result.missingPages?.length?manualText:use).focus({preventScroll:true});
 };
 file.addEventListener('change',async()=>{
  const selected=file.files?.[0];file.value='';if(!selected)return;
  reset();const ticket=sequence,snapshot=terms.value;controller=new AbortController();status.textContent='Reading every saved PDF page…';
  try{const result=await importedPdfFile(selected,{signal:controller.signal,preview:true});result.sourceOrigin={kind:'local-pdf',filename:selected.name};if(ticket===sequence&&terms.value===snapshot)present(result,snapshot);else result.preview?.dispose().catch(()=>{})}
  catch(error){if(ticket===sequence&&error.name!=='AbortError')status.textContent=error.message}
  finally{if(ticket===sequence)controller=null}
 });
 fetchButton.addEventListener('click',async()=>{
  reset();const ticket=sequence,snapshot=terms.value;controller=new AbortController();
  fetchButton.disabled=true;status.textContent='Opening merchant page…';
  try{
   const response=await fetch('/api/import-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:address.value}),signal:controller.signal});
   const page=await response.json();if(!response.ok)throw Error(page.error||'The page could not be opened.');
   const pdf=/^application\/pdf(?:;|$)/i.test(page.contentType||'');
   if(pdf)status.textContent='Reading every PDF page…';
   const result=pdf?await importedPdfText(page,{signal:controller.signal,preview:true}):importedPageText(page);
   if(/^[0-9a-f]{64}$/.test(page.sha256||'')&&typeof page.fetchedAt==='string')
     result.sourceOrigin={kind:pdf?'https-pdf':'https-page',url:page.url,
       requestedUrl:page.requestedUrl||page.url,sha256:page.sha256,fetchedAt:page.fetchedAt};
   if(ticket!==sequence||terms.value!==snapshot){result.preview?.dispose().catch(()=>{});return;}
   present(result,snapshot);
  }catch(error){if(ticket===sequence&&error.name!=='AbortError')status.textContent=error.message}
  finally{if(ticket===sequence){controller=null;fetchButton.disabled=false}}
 });
 const adopt=append=>{
  if(!pending||terms.value!==pending.snapshot){reset('The purchase terms changed. Preview the page again before replacing them.');return}
  if(pending.missingPages?.length){status.textContent='Include the text from every scanned PDF page before using these terms.';return}
const imported=pending;let next,retained;const previous=sourceTrail?.snapshot===terms.value.trim()?sourceTrail.entries:[];
  try{
    next=append?addMerchantPage(terms.value,imported):imported.terms;
    if(append)retained=beforeAdd?.();
  }catch(error){status.textContent=error.message;return}
  originals=append?relevant(terms.value):[];if(imported.original&&!originals.some(r=>r.base64===imported.original.base64&&r.text===imported.original.text))originals.push(imported.original);
  const replacingExample=document.body.dataset.example==='true';
  imported.preview?.dispose().catch(()=>{});renderSequence++;canvas.width=canvas.height=0;
  pending=null;controller=null;preview.hidden=true;
  // A live merchant source must not keep the fictional merchant, item or price.
  if(replacingExample)for(const id of ['merchant','item','amount']){
    const input=document.getElementById(id);input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  terms.value=next;terms.dispatchEvent(new Event('input',{bubbles:true}));
  const metadata=imported.sourceOrigin||null;
  if(metadata&&imported.text.trim().length>=20){
    const entries=append?[...previous,{...metadata,text:imported.text}]:[{...metadata,text:imported.text}];
    try{sourceTrail=checkedSourceTrail({snapshot:next.trim(),entries},next.trim());sourceTrailRestored=false}
    catch(error){sourceTrail=null;status.textContent='Imported terms are usable, but the original source history could not be kept.'}
  }
  if(append)afterAdd?.(retained,next);
  status.textContent=(imported.filename?(append?'Added file: ':'Imported file: ')+imported.filename:(append?'Added page from ':'Imported from ')+new URL(imported.url).hostname)+'.'
    +(replacingExample?' Enter the merchant, item and quoted price for this purchase.':'');
  const focus=replacingExample?document.getElementById('merchant'):terms;
  focus.focus();if(!replacingExample)terms.setSelectionRange(0,0);
 };
 use.addEventListener('click',()=>adopt(false));add.addEventListener('click',()=>adopt(true));
 const ready=originalStore.read().then(records=>{if(originalEpoch===0){originals=records;showOriginals()}},()=>{});
 const rememberReviewOriginals=async(id,source)=>{
  const records=checkedOriginalPdfs(relevant(source),source);
  if(!records.length){originalsReviewId=null;return false}
  originalsReviewId=id;
  try{
   await originalStore.writeReview(id,records,source);
   if(terms.value===source)originalStatus.textContent='Original PDF kept with this recent review.';
   return true;
  }catch{
   if(terms.value===source)originalStatus.textContent='Could not keep this original PDF in recent history. Save the full review before leaving.';
   return false;
  }
 };
 let pendingRestore=Promise.resolve();
 const restoreReviewOriginals=(id,source)=>{
  const epoch=++originalEpoch;
  const promise=(async()=>{
   await ready;
   let records;
   try{records=await originalStore.readReview(id,source)}
   catch{
    if(epoch===originalEpoch&&terms.value===source){
     originals=[];originalsReviewId=null;showOriginals();
     await persistOriginals();
     originalStatus.textContent='Could not reopen the original PDF for this review. Check a saved copy or re-import the file.';
    }
    return false;
   }
   if(epoch!==originalEpoch||terms.value!==source)return false;
   if(!records.length&&originalsReviewId===id)records=checkedOriginalPdfs(relevant(source),source);
   originals=records;originalsReviewId=id;showOriginals();
   await persistOriginals();
   if(terms.value!==source)return false;
   originalStatus.textContent=records.length?'Original PDF restored for this review.':
    /\[PDF page \d+ of \d+\]|Original local PDF|Additional source file:/i.test(source)?
    'This recent review has no original PDF stored here. Save a full review to keep its files.':'';
   return !!records.length;
  })();
  pendingRestore=promise;
  return promise;
 };
 const pruneReviewOriginals=ids=>originalStore.pruneReviews(ids).catch(()=>{});
 const trailFor=source=>sourceTrail?.snapshot===source.trim()?checkedSourceTrail(sourceTrail,source.trim()):null;
 const renderTrail=(container,source)=>{
   container.replaceChildren();container.classList.add('source-trail');
   container.append(node('h3',null,'Where these terms came from'));
   const present=trailFor(source);
   if(!present){
     container.append(node('p',null,'These words were typed, pasted or changed since import. No merchant source was authenticated.'));
     return;
   }
   const list=node('div','source-trail-list');container.append(list);
   for(const record of present.entries){
     const item=node('div','source-trail-entry');list.append(item);
     if(record.kind==='local-pdf'){
       item.append(node('p',null,'Local PDF: '+record.filename+'. The file was chosen on this device; its sender was not authenticated.'));
       continue;
     }
     const host=new URL(record.url).hostname;
     const link=node('a',null,host);link.href=record.url;link.target='_blank';link.rel='noopener noreferrer';
     const lead=node('p',null,sourceTrailRestored?'Saved source address — ':'Read directly from HTTPS — ');
     lead.append(link);item.append(lead);
     if(new URL(record.requestedUrl).hostname!==host)
       item.append(node('p','source-trail-caution','The requested page redirected from '+new URL(record.requestedUrl).hostname+' to '+host+'. Confirm that destination belongs to the seller.'));
     const note=node('p','source-trail-status',sourceTrailRestored?
       'This saved review is editable. Recheck the website before relying on this source.':
       'Retrieved '+new Date(record.fetchedAt).toLocaleString()+'. The domain is not proof of merchant identity.');
     note.setAttribute('role','status');item.append(note);
     const check=node('button','ghost-button','Recheck live source');check.type='button';item.append(check);
     check.addEventListener('click',async()=>{
       if(sourceTrail?.snapshot!==source.trim()){note.textContent='The terms changed. Review the current source instead.';return}
       check.disabled=true;note.textContent='Reopening the original HTTPS address…';
       try{
         const reply=await fetch('/api/import-source',{method:'POST',
           headers:{'Content-Type':'application/json'},cache:'no-store',
           body:JSON.stringify({url:record.requestedUrl})});
         const page=await reply.json();
         if(!reply.ok)throw Error(page.error||'The original page could not be opened.');
         if(sourceTrail?.snapshot!==source.trim()){note.textContent='Terms changed while checking. Review the current source.';return}
         if(page.url!==record.url){note.textContent='The source now leads to a different address. Check the live page before using these terms.';return}
         if(record.kind==='https-page'){
           const current=importedPageText(page).text;
           if(current!==record.text){note.textContent='The words on the live page differ from this review. Read the updated original before deciding.';return}
           if(page.sha256!==record.sha256){note.textContent='The page markup changed, but the extracted policy wording still matches. Check the live page for hidden conditions.';return}
         }else if(page.sha256!==record.sha256){
           note.textContent='The original PDF file changed. Reimport the new document before deciding.';return;
         }
         note.textContent=(record.kind==='https-pdf'?'The live PDF bytes':'The live page wording and bytes')+
           ' still match this source. Check the merchant domain and original conditions before deciding.';
       }catch{note.textContent='Could not recheck the live page. Its source and merchant identity remain unconfirmed.'}
       finally{check.disabled=false}
     });
   }
 };
 return {
  originalsFor:source=>checkedOriginalPdfs(relevant(source),source),
  trailFor,renderTrail,
  restoreTrail:(value,source)=>{sourceTrail=checkedSourceTrail(value,source);sourceTrailRestored=!!sourceTrail},
  clearTrail:()=>{sourceTrail=null;sourceTrailRestored=false},
  rememberReviewOriginals,restoreReviewOriginals,
  waitForReviewOriginals:()=>pendingRestore,pruneReviewOriginals,
  restoreOriginals:(records,source)=>{originals=checkedOriginalPdfs(records||[],source);originalsReviewId=null;showOriginals();persistOriginals()},
  restoreForSource:async()=>{await ready;showOriginals();if(relevant(terms.value).length)originalStatus.textContent='Original PDF restored from this browser.'},
  clearOriginals:()=>{originals=[];originalsReviewId=null;sourceTrail=null;sourceTrailRestored=false;showOriginals();return persistOriginals()}
 };
}
