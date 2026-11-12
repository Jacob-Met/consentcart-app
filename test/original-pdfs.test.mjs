import test from 'node:test';import assert from 'node:assert/strict';import {attachOriginalPdfs,readOriginalPdfs,checkedOriginalPdfs,readSourceTrail,checkedSourceTrail} from '../web/original-pdfs.js';
const text='Original refund terms '.repeat(8),base64=btoa('%PDF-1.7 original bytes'),record={filename:'terms.pdf',url:null,text,base64};
test('saved original PDF retains exact bytes and source while rejecting a changed source',()=>{const html=attachOriginalPdfs('<main>Review</main>',[record],text);assert.deepEqual(readOriginalPdfs(html,text),[record]);assert.throws(()=>readOriginalPdfs(html,'Different policy'));assert.throws(()=>checkedOriginalPdfs([{...record,base64:btoa('not pdf')}],text));assert.equal(attachOriginalPdfs('<main>Review</main>',[],text),'<main>Review</main>')});


test('saved originals carry page-specific buyer transcriptions through full HTML export',()=>{
 const handwritten='Merchant states the package renews quarterly, and cancellation must be requested thirty days prior.';
 const text='[PDF page 1 of 1]\n'+handwritten;
 const original={...record,text,transcriptions:{'1':handwritten}};
 const html=attachOriginalPdfs('<main>Review</main>',[original],text);
 assert.deepEqual(readOriginalPdfs(html,text),[original]);
 assert.throws(()=>checkedOriginalPdfs([{...original,transcriptions:{1:'words not present in source'}}],text),/transcription/);
});


test('a saved direct-HTTPS source retains its address, response digest and original wording without granting merchant identity',()=>{
 const terms='Refunds close ten days after delivery. Cancellation must be requested in writing. Contact support before you return.'+
   '\\n\\nLinks in copied terms:\\nOriginal merchant page — https://merchant.example/legal';
 const record={kind:'https-page',url:'https://merchant.example/legal',requestedUrl:'https://merchant.example/terms',
   sha256:'b'.repeat(64),fetchedAt:'2026-11-12T07:40:00.000Z',
   text:'Refunds close ten days after delivery. Cancellation must be requested in writing. Contact support before you return.'};
 const trail={snapshot:terms,entries:[record]};
 const html=attachOriginalPdfs('<main>Review</main>',[],terms,trail);
 assert.deepEqual(readSourceTrail(html,terms),checkedSourceTrail(trail,terms));
 assert.match(html,/not proof of merchant identity/);
 assert.match(html,/merchant.example/);
 assert.throws(()=>readSourceTrail(html,terms+' changed'),/no longer matches/);
 assert.throws(()=>checkedSourceTrail({...trail,entries:[{...record,text:'not in terms'}]},terms),/does not match/);
 assert.throws(()=>checkedSourceTrail({...trail,entries:[{...record,url:'http://merchant.example/legal'}]},terms),/address/);
});


test('a downloaded local PDF is attributed only to the buyer selected file and not a seller identity',()=>{
 const source='[PDF page 1 of 1]\\nCancellation requests must arrive ten days before renewal and refunds stop five days after payment.';
 const trail={snapshot:source,entries:[{kind:'local-pdf',filename:'C:\\\\Downloads\\\\conditions.pdf',
   text:source}]};
 const html=attachOriginalPdfs('<main>Buyer review</main>',[],source,trail);
 const restored=readSourceTrail(html,source);
 assert.equal(restored.entries[0].kind,'local-pdf');
 assert.match(restored.entries[0].filename,/conditions.pdf/);
 assert.match(html,/PDF chosen on this device/);
 assert.doesNotMatch(html,/Read directly from HTTPS/);
});
