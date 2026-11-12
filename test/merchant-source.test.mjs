import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createMerchantSourceClient,merchantPageUrl} from '../merchant-source.mjs';
function requestFixture(pages,observed){
 return (url,options,callback)=>{
  const req=new EventEmitter();
  req.end=()=>queueMicrotask(()=>{
   observed.push({url:url.href,options});
   const page=pages.shift(),res=Readable.from([Buffer.from(page.text||'')]);
   res.statusCode=page.status||200;res.headers=page.headers||{'content-type':'text/html; charset=utf-8'};
   callback(res);
  });return req;
 };
}
test('public page read pins checked DNS, retains complete bytes and final provenance',async()=>{
 const observed=[],html='<main><p>Returns require the original certificate. Inspection follows within 48 hours.</p></main>';
 const client=createMerchantSourceClient({lookupImpl:async()=>[{address:'93.184.216.34',family:4}],requestImpl:requestFixture([{text:html}],observed)});
 const page=await client('https://merchant.example/terms#refunds');
 assert.equal(page.text,html);assert.equal(page.url,'https://merchant.example/terms');
 assert.equal(page.bytes,Buffer.byteLength(html));
 assert.equal(page.sha256,createHash('sha256').update(html).digest('hex'));
 assert.match(page.fetchedAt,/^\d{4}-\d{2}-\d{2}T/);
 const address=await new Promise((resolve,reject)=>observed[0].options.lookup('merchant.example',{},(err,ip)=>err?reject(err):resolve(ip)));
 assert.equal(address,'93.184.216.34');assert.equal(observed[0].options.agent,false);assert.equal(observed[0].options.headers.Cookie,undefined);
});
test('redirect destinations are checked before connecting, including private destinations',async()=>{
 const observed=[];
 const client=createMerchantSourceClient({lookupImpl:async host=>[{address:host==='merchant.example'?'93.184.216.34':'127.0.0.1',family:4}],requestImpl:requestFixture([{status:302,headers:{location:'https://internal.example/terms'}}],observed)});
 await assert.rejects(client('https://merchant.example/terms'),/public merchant page/);
 assert.equal(observed.length,1);
});
test('a public redirect preserves the final source URL and its entire response',async()=>{
 const observed=[],client=createMerchantSourceClient({lookupImpl:async()=>[{address:'93.184.216.34',family:4}],requestImpl:requestFixture([{status:302,headers:{location:'/legal/terms'}},{text:'Complete terms here.'}],observed)});
 const page=await client('https://merchant.example/terms');assert.equal(page.url,'https://merchant.example/legal/terms');assert.equal(page.requestedUrl,'https://merchant.example/terms');assert.equal(page.text,'Complete terms here.');assert.match(page.sha256,/^[0-9a-f]{64}$/);
});
test('unsupported documents, missing redirect and oversized pages fail without a partial import',async()=>{
 for(const page of [{headers:{'content-type':'application/zip'},text:'PKZZ'},{status:302,headers:{}},{text:'x'.repeat(2_000_001)}]){
  const client=createMerchantSourceClient({lookupImpl:async()=>[{address:'93.184.216.34',family:4}],requestImpl:requestFixture([page],[])});
  await assert.rejects(client('https://merchant.example/terms'));
 }
});
test('credentialed, local-literal and non-HTTPS addresses never become merchant source URLs',()=>{
 for(const url of ['http://merchant.example/terms','https://user:secret@merchant.example/terms','https://127.0.0.1/','https://[::1]/','https://merchant.example:8443/terms','file:///etc/hosts'])assert.throws(()=>merchantPageUrl(url));
});

test('PDF response preserves exact bytes for the existing explicit-preview browser action',async()=>{
 const pdf=Buffer.from('%PDF-1.7\\n'+'x'.repeat(3000)+'\\n%%EOF');
 const observed=[];
 const client=createMerchantSourceClient({lookupImpl:async()=>[{address:'93.184.216.34',family:4}],requestImpl:requestFixture([{text:pdf,headers:{'content-type':'application/pdf'}}],observed)});
 const result=await client('https://merchant.example/buyer/terms.pdf');
 assert.equal(result.contentType,'application/pdf');
 assert.equal(result.bytes,pdf.length);
 assert.deepEqual(Buffer.from(result.pdfBase64,'base64'),pdf);
 assert.equal(result.text,undefined);
 assert.ok(observed[0].options.headers.Accept.includes('application/pdf'));
});

test('PDF type without PDF signature is rejected without returning source text',async()=>{
 const client=createMerchantSourceClient({lookupImpl:async()=>[{address:'93.184.216.34',family:4}],requestImpl:requestFixture([{text:'Not a real document',headers:{'content-type':'application/pdf'}}],[])});
 await assert.rejects(client('https://merchant.example/terms.pdf'),/readable PDF/);
});
