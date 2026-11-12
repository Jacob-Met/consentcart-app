import {MAX_SOURCE_CHARACTERS} from './offer-limits.js';

const MAX_PAGES=100;
const MAX_BYTES=8_000_000;

// Preserve page boundaries and PDF.js's original text order. Geometry is used
// only to separate adjacent runs, never to rewrite their wording.
function pageText(items) {
  const lines=[];
  let line='', lastEnd=null, lastY=null;
  const flush=()=>{if(line.trim())lines.push(line.trimEnd());line='';lastEnd=null;lastY=null;};
  for(const item of items) {
    if(typeof item.str!=='string')continue;
    const text=item.str, transform=item.transform||[];
    const x=Number.isFinite(transform[4])?transform[4]:null;
    const y=Number.isFinite(transform[5])?transform[5]:null;
    if(line&&lastY!==null&&y!==null&&Math.abs(y-lastY)>2)flush();
    if(text&&line&&!/\s$/.test(line)&&!/^\s/.test(text)) {
      if(x!==null&&lastEnd!==null ? x-lastEnd>1.5 : true)line+=' ';
    }
    line+=text;
    if(item.hasEOL)flush();
    else {
      lastY=y;
      lastEnd=x!==null&&Number.isFinite(item.width)?x+item.width:null;
    }
  }
  flush();
  return lines.join('\n').trim();
}

export async function importedPdfText(page,options={}) {
  const url=new URL(page.url);
  if(url.protocol!=='https:'||url.username||url.password)throw Error('The PDF has no usable original source address.');
  if(!/^application\/pdf(?:;|$)/i.test(page.contentType||'')||typeof page.pdfBase64!=='string')
    throw Error('This merchant link did not return PDF document bytes.');
  if(!Number.isSafeInteger(page.bytes)||page.bytes<8||page.bytes>MAX_BYTES)
    throw Error('This PDF is too large or incomplete to read.');
  let bytes;
  try {
    const raw=atob(page.pdfBase64);
    if(raw.length!==page.bytes)throw Error('length mismatch');
    bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));
  } catch {
    throw Error('This PDF could not be decoded completely. Open the original document and paste its terms.');
  }
  if(String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')
    throw Error('This link did not return a readable PDF.');
  return readPdf(bytes,url.href,null,options);
}

export async function importedPdfFile(file,options={}) {
  if(options.signal?.aborted)throw new DOMException('Import cancelled','AbortError');
  if(!file||!Number.isSafeInteger(file.size)||file.size<8||file.size>MAX_BYTES)throw Error('This PDF is too large or incomplete to read.');
  const filename=String(file.name||'Saved document.pdf').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,160)||'Saved document.pdf';
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(options.signal?.aborted)throw new DOMException('Import cancelled','AbortError');
  if(bytes.length!==file.size||String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')throw Error('This file is not a complete readable PDF.');
  return readPdf(bytes,filename,filename,options);
}

async function readPdf(bytes,origin,filename,{openDocument,signal,preview=false,transcriptions={}}={}) {
  if(!openDocument) {
    const pdfjs=await import('./vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';
    openDocument=data=>pdfjs.getDocument({data,isEvalSupported:false,stopAtErrors:true});
  }
  const originalBytes=preview?bytes.slice():null;
  let loading,retained=false;
  try {
    if(signal?.aborted)throw new DOMException('Import cancelled','AbortError');
    loading=openDocument(bytes);
    const pdf=await loading.promise;
    if(!Number.isInteger(pdf.numPages)||pdf.numPages<1||pdf.numPages>MAX_PAGES)
      throw Error('This PDF has too many pages to import completely (100 maximum). Open it and paste the relevant terms.');
    const pageBodies=[],scannedPages=[],manualTexts={};
    for(let i=1;i<=pdf.numPages;i++){
      if(signal?.aborted)throw new DOMException('Import cancelled','AbortError');
      const current=await pdf.getPage(i);
      const content=await current.getTextContent();
      const extracted=pageText(content.items);
      current.cleanup?.();
      if(!extracted) {
        scannedPages.push(i);
        const manual=typeof transcriptions?.[i]==='string'?transcriptions[i].trim():'';
        if(manual)manualTexts[i]=manual;
        pageBodies.push(manual);
        if(!preview&&!manual)throw Error('PDF page '+i+' has no selectable text. It may be scanned; use the original PDF to check that page before pasting the terms.');
      } else pageBodies.push(extracted);
    }
    const pageParts=bodies=>bodies.map((body,index)=>'[PDF page '+(index+1)+' of '+pdf.numPages+']\n'+
      (body?(scannedPages.includes(index+1)?'[Buyer-transcribed from original image; not merchant-verified]\n':'')+body:
      '[No selectable text on this page — enter its visible words before using this PDF]'));
    const makeDocument=bodies=>{
      const missingPages=scannedPages.filter(i=>!bodies[i-1]?.trim());
      const text=pageParts(bodies).join('\n\n');
      if(text.length+origin.length+128>MAX_SOURCE_CHARACTERS)
        throw Error('This PDF exceeds the text limit. No partial document was imported.');
      if(!missingPages.length&&text.length<80)
        throw Error('This PDF did not provide enough readable terms. Open the original PDF and paste its terms.');
      const terms=missingPages.length?'':(filename?'Source file: '+filename+'\n\n':'')+text+
        '\n\nLinks in copied terms:\n'+(filename?'Original local PDF — ':'Original merchant PDF — ')+origin;
      if(terms.length>MAX_SOURCE_CHARACTERS)
        throw Error('This PDF exceeds the text limit. No partial document was imported.');
      return {text,terms,missingPages};
    };
    const initial=makeDocument(pageBodies);
    const result={...initial,url:filename?null:origin,...(filename?{filename}:{}),
      title:(filename||new URL(origin).hostname)+' · PDF',pages:pdf.numPages,scannedPages,
      transcriptions:{...manualTexts}};
    if(preview){
      let encoded='';for(let i=0;i<originalBytes.length;i+=32768)encoded+=String.fromCharCode(...originalBytes.subarray(i,i+32768));
      result.original={filename:filename||'Original merchant terms.pdf',url:filename?null:origin,
        text:result.missingPages.length?'':result.text,base64:btoa(encoded),
        ...(Object.keys(manualTexts).length?{transcriptions:{...manualTexts}}:{})};
      result.setPageTranscription=(index,value)=>{
        if(!Number.isInteger(index)||!scannedPages.includes(index))
          throw Error('Only pages without selectable text can be transcribed here.');
        const entry=String(value||'').trim();
        if(!entry)throw Error('Type the words visible on this page before including it.');
        const next=pageBodies.slice();next[index-1]=entry;
        const document=makeDocument(next);
        pageBodies[index-1]=entry;manualTexts[index]=entry;
        Object.assign(result,document);
        result.transcriptions={...manualTexts};
        result.original.text=result.missingPages.length?'':result.text;
        result.original.transcriptions={...manualTexts};
        return result;
      };
      let disposed=false,renderTask=null,renderGeneration=0;
      const originalUrl=URL.createObjectURL(new Blob([originalBytes],{type:'application/pdf'}));
      result.preview={
        originalUrl,
        pageText:index=>pageParts(pageBodies)[index-1]||'',
        async renderForRecognition(index,width=1600){
          if(disposed||!Number.isInteger(index)||index<1||index>pdf.numPages)
            throw Error('The original PDF page is no longer available.');
          const page=await pdf.getPage(index);
          const unit=page.getViewport({scale:1});
          const scale=Math.min(Math.min(Math.max(width,1000),2000)/unit.width,2600/unit.height,3);
          const viewport=page.getViewport({scale});
          const canvas=document.createElement('canvas');
          canvas.width=Math.ceil(viewport.width);
          canvas.height=Math.ceil(viewport.height);
          try{
            await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport}).promise;
            if(disposed)throw Error('The original PDF page is no longer available.');
            return canvas;
          }catch(error){canvas.width=canvas.height=0;throw error}
        },
        async render(index,canvas,width=640){
          if(disposed||!Number.isInteger(index)||index<1||index>pdf.numPages)throw Error('This PDF preview is no longer available.');
          const generation=++renderGeneration;renderTask?.cancel();
          const page=await pdf.getPage(index);if(disposed||generation!==renderGeneration)return;
          const unit=page.getViewport({scale:1}),ratio=Math.min(globalThis.devicePixelRatio||1,2);
          const viewport=page.getViewport({scale:Math.max(240,Math.min(width,1200))*ratio/unit.width});
          canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
          renderTask=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport});
          await renderTask.promise;
        },
        async dispose(){if(disposed)return;disposed=true;renderGeneration++;renderTask?.cancel();URL.revokeObjectURL(originalUrl);await loading.destroy?.()}
      };
      retained=true;
    }
    return result;
  } catch(error) {
    if(error?.name==='AbortError'||error?.message?.startsWith('This PDF')||error?.message?.startsWith('PDF page')||
      error?.message?.startsWith('Type the words')||error?.message?.startsWith('Only pages'))
      throw error;
    if(error?.name==='PasswordException')
      throw Error('This PDF is password-protected. Open it yourself and paste the original terms.');
    throw Error('This PDF could not be read completely. Open the original document and paste its terms.');
  } finally {
    if(loading&&!retained)await loading.destroy?.().catch(()=>{});
  }
}
