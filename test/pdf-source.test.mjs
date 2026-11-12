import test from 'node:test';
import assert from 'node:assert/strict';
import {importedPdfText,importedPdfFile} from '../web/pdf-source.js';
import {MAX_SOURCE_CHARACTERS} from '../web/offer-limits.js';

const bytes=Buffer.from('%PDF-1.7\nmock PDF source test bytes');
const base={contentType:'application/pdf',url:'https://merchant.example/legal/terms.pdf',bytes:bytes.length,pdfBase64:bytes.toString('base64')};
const lines=[
  [{str:'An annual subscription renews unless cancelled at least ten days before the renewal date.',hasEOL:true},
   {str:'Cancellation stops billing but this source says nothing about data retention.',hasEOL:true}],
  [{str:'The subscriber must download the invoices before the account closes.',hasEOL:true},
   {str:'Additional charges for storage are not stated in the merchant document.',hasEOL:true}]
];
const reader=entries=>({
  promise:Promise.resolve({numPages:entries.length,getPage:async i=>({getTextContent:async()=>({items:entries[i-1]}),cleanup(){}})}),
  async destroy(){}
});

test('complete merchant PDF includes every page and original URL without invented terms',async()=>{
 const result=await importedPdfText(base,{openDocument:()=>reader(lines)});
 assert.equal(result.pages,2);assert.equal(result.title,'merchant.example · PDF');
 assert.ok(result.text.startsWith('[PDF page 1 of 2]'));
 assert.ok(result.text.includes('[PDF page 2 of 2]'));
 for(const page of lines)for(const row of page)assert.ok(result.text.includes(row.str));
 assert.match(result.terms,/Original merchant PDF — https:\/\/merchant\.example\/legal\/terms\.pdf$/);
 assert.equal(result.terms.includes('Merchant has answered'),false);
});

test('PDF missing selectable page refuses whole import, never silently truncates',async()=>{
 await assert.rejects(importedPdfText(base,{openDocument:()=>reader([lines[0],[]])}),/page 2 has no selectable text/);
 await assert.rejects(importedPdfText(base,{openDocument:()=>reader(Array.from({length:101},()=>lines[0]))}),/too many pages/);
 await assert.rejects(importedPdfText(base,{openDocument:()=>reader([[{str:'X'.repeat(MAX_SOURCE_CHARACTERS),hasEOL:true}]])}),/text limit/);
});

test('binary mismatch, origin mismatch, cancelled PDF and failed parsing do not return partial terms',async()=>{
 await assert.rejects(importedPdfText({...base,bytes:bytes.length+1},{openDocument:()=>reader(lines)}),/decoded completely/);
 await assert.rejects(importedPdfText({...base,url:'http://127.0.0.1/private'},{openDocument:()=>reader(lines)}),/source address/);
 await assert.rejects(importedPdfText(base,{signal:{aborted:true},openDocument:()=>reader(lines)}),{name:'AbortError'});
 await assert.rejects(importedPdfText(base,{openDocument:()=>({promise:Promise.reject(new Error('bad PDF')),destroy:async()=>{}})}),/could not be read completely/);
});

import {sourcePageAt,policyTextBeforeCopiedLinks} from '../web/source-links.js';
import {addMerchantPage} from '../web/source-import.js';
test('saved PDF retains exact complete text and filename without fabricating a merchant URL',async()=>{
 const file={name:'subscription terms.pdf',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};
 const result=await importedPdfFile(file,{openDocument:()=>reader(lines)});
 assert.equal(result.url,null);assert.equal(result.filename,file.name);
 assert.equal(sourcePageAt(result.terms,result.terms.indexOf(lines[1][0].str)).filename,file.name);
 assert.ok(!policyTextBeforeCopiedLinks(result.terms).includes('Original local PDF'));
 const mixed=addMerchantPage('An original pasted invoice says cancellation stops renewal.',result);
 assert.equal(sourcePageAt(mixed,0).url,null);assert.equal(sourcePageAt(mixed,0).filename,undefined);
 assert.equal(sourcePageAt(mixed,mixed.indexOf(lines[0][0].str)).filename,file.name);
 assert.throws(()=>addMerchantPage(mixed,result),/already/);
 await assert.rejects(importedPdfFile(file,{openDocument:()=>reader([lines[0],[]])}),/page 2 has no selectable text/);
 await assert.rejects(importedPdfFile(file,{signal:{aborted:true}}),{name:'AbortError'});
});
test('URL PDF retains original page provenance',async()=>{
 const result=await importedPdfText(base,{openDocument:()=>reader(lines)});
 assert.equal(sourcePageAt(result.terms,10).url,base.url);
});

test('original PDF preview keeps exact bytes and releases its object URL on disposal',async()=>{
 let destroyed=0;
 const result=await importedPdfText(base,{preview:true,openDocument:()=>({...reader(lines),destroy:async()=>{destroyed++}})});
 assert.deepEqual(Buffer.from(await (await fetch(result.preview.originalUrl)).arrayBuffer()),bytes);
 assert.ok(result.preview.pageText(2).includes(lines[1][0].str));
 await result.preview.dispose();assert.equal(destroyed,1);
 await assert.rejects(fetch(result.preview.originalUrl));
 await assert.rejects(result.preview.render(1,{}),/no longer available/);
});


test('scanned PDF pages remain visibly incomplete until each original is transcribed',async()=>{
 const entries=[lines[0],[],lines[1],[]];
 const result=await importedPdfText(base,{openDocument:()=>reader(entries),preview:true});
 assert.deepEqual(result.scannedPages,[2,4]);
 assert.deepEqual(result.missingPages,[2,4]);
 assert.equal(result.terms,'','no partial document may be adopted');
 assert.match(result.preview.pageText(2),/No selectable text/);
 assert.throws(()=>result.setPageTranscription(1,'These words cannot override selectable source text.'),/Only pages/);
 assert.throws(()=>result.setPageTranscription(2,'   '),/Type the words/);
 const second='A refund for this subscription must be requested from the merchant within five calendar days.';
 result.setPageTranscription(2,second);
 assert.deepEqual(result.missingPages,[4]);
 assert.equal(result.terms,'');
 assert.match(result.preview.pageText(2),/five calendar days/);
 const fourth='Cancelling the renewal does not itself guarantee any refund for an earlier charge.';
 result.setPageTranscription(4,fourth);
 assert.deepEqual(result.missingPages,[]);
 assert.ok(result.terms.includes(second)&&result.terms.includes(fourth));
 assert.ok(result.terms.includes('[PDF page 4 of 4]'));
 assert.deepEqual(result.original.transcriptions,{'2':second,'4':fourth});
 const reopened=await importedPdfText(base,{openDocument:()=>reader(entries),preview:true,transcriptions:result.original.transcriptions});
 assert.deepEqual(reopened.missingPages,[]);
 assert.equal(reopened.text,result.text);
 assert.equal(reopened.original.text,result.original.text);
 await result.preview.dispose();await reopened.preview.dispose();
});

test('scanned page text cannot silently exceed the whole-PDF source limit',async()=>{
 const result=await importedPdfText(base,{openDocument:()=>reader([lines[0],[]]),preview:true});
 assert.throws(()=>result.setPageTranscription(2,'x'.repeat(MAX_SOURCE_CHARACTERS)),/text limit/);
 assert.deepEqual(result.missingPages,[2]);
 assert.equal(result.terms,'');
 await result.preview.dispose();
});
