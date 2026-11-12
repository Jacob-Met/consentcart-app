import test from 'node:test';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {findQuoteRange} from '../web/source.js';
import {createModelClient,createPayPalClient,validateAnalysis,normalizeOffer,digestOffer} from '../engine.mjs';
const terms='Price is $48.00 payable once. Shipping is included in the price. Returns are accepted within 14 days of delivery. Buyer pays return shipping. Non-defective returns have a 10% restocking fee. No subscription is included with the journal.';
const offer={merchant:'Northstar',itemName:'Leather journal',terms,amountCents:4800};
const modelReply={summary:'Returns are time limited.',caution:'medium',facts:[{label:'Return window',quote:'Returns are accepted within 14 days of delivery.',meaning:'Fourteen days after delivery.',kind:'returns'},{label:'Invented clause',quote:'Everything is free forever',meaning:'Should not appear',kind:'other'}],unknowns:['No refunds processing time provided'],questions:['How long will a refund take?']};
function mockUpstream({captureAmount='48.00',failCapture=false}={}){
 const calls=[];
 async function fetchImpl(url,request){calls.push({url,method:request?.method,body:request?.body,headers:request?.headers});
  let body,status=200;
  if(url==='https://model.localhost/v1/chat/completions')body={choices:[{message:{content:JSON.stringify(modelReply)}}]};
  else if(url.endsWith('/v1/oauth2/token'))body={access_token:'TEST_ACCESS_TOKEN',expires_in:300};
  else if(url.endsWith('/v2/checkout/orders'))body={id:'ORDER00001',links:[{rel:'approve',href:'https://www.sandbox.paypal.com/checkoutnow?token=ORDER00001'}]};
  else if(url.endsWith('/v2/checkout/orders/ORDER00001/capture')){
   if(failCapture){body={details:[{issue:'ORDER_NOT_APPROVED'}]};status=422}
   else body={status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'CAPTURE00001',status:'COMPLETED',amount:{currency_code:'USD',value:captureAmount}}]}}]};
  }else throw new Error('unexpected upstream URL '+url);
  return {ok:status>=200&&status<300,status,json:async()=>body};
 }
 return {fetchImpl,calls};
}
const env={AI_BASE_URL:'https://model.localhost/v1',AI_MODEL:'test-model',PAYPAL_SANDBOX_CLIENT_ID:'test-id',PAYPAL_SANDBOX_CLIENT_SECRET:'test-secret'};
async function setup(options){const upstream=mockUpstream(options);const app=createApp({fetchImpl:upstream.fetchImpl,env:{...env,PORT:'4178'}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;return {...upstream,app,base,async post(path,body){const res=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,data:await res.json()}}}}
async function close(t,ctx){t.after(()=>new Promise(resolve=>ctx.app.server.close(resolve)))}
test('evidence quotes resolve to exactly selectable source ranges',()=>{
 const source='A 14-day RETURN period applies. Pay $48.00 once.';
 assert.deepEqual(findQuoteRange(source,'return period'),{start:9,end:22});
 assert.equal(source.slice(9,22),'RETURN period');
 assert.equal(findQuoteRange(source,'not actually present'),null);
 assert.equal(findQuoteRange(source,'too few'),null);
});
test('unsupported model citations never reach the buyer',()=>{
 const out=validateAnalysis(modelReply,normalizeOffer(offer));assert.equal(out.facts.length,1);assert.equal(out.rejectedClaims,1);
 assert.equal(out.facts[0].quote,'Returns are accepted within 14 days of delivery.');
});
test('nine exact matching source citations are an eight-card display limit, not a rejected quote',()=>{
 const clauses=Array.from({length:9},(_,i)=>'Clause '+(i+1)+': exact shipping and return conditions acknowledged by this buyer.');
 const source=clauses.join(' ');
 const facts=clauses.map((quote,i)=>({label:'Clause '+(i+1),quote,meaning:'As written',kind:'other'}));
 const out=validateAnalysis({facts,caution:'low'},normalizeOffer({...offer,terms:source}));
 assert.ok(facts.every(f=>source.includes(f.quote)));
 assert.equal(out.facts.length,8);
 assert.equal(out.rejectedClaims,0);
 assert.equal(out.unmatchedClaims,0);
 assert.equal(out.unusableClaims,0);
 assert.equal(out.omittedClaims,1);
});
test('zero, one and three hallucinated citations are distinguishable from display overflow',()=>{
 const clauses=Array.from({length:9},(_,i)=>'Clause '+(i+1)+': shipping and buyer returns remain subject to these exact conditions.');
 const source=clauses.join(' ');
 for(const n of [0,1,3]){
  const facts=clauses.map((quote,i)=>({label:'Clause '+(i+1),quote:i<n?'Invented unconditional refund guarantee number '+(i+1):quote,meaning:'As claimed',kind:'other'}));
  const out=validateAnalysis({facts,caution:'low'},normalizeOffer({...offer,terms:source}));
  assert.equal(out.facts.length,8-n);
  assert.equal(out.rejectedClaims,n);
  assert.equal(out.unmatchedClaims,n);
  assert.equal(out.unusableClaims,0);
  assert.equal(out.omittedClaims,1);
  assert.equal(out.caution,n>0?'high':'low');
 }
});
test('short or incomplete citations are unusable, not falsely reported as absent from source',()=>{
 const raw={facts:[{label:'Short exact excerpt',quote:'Ship',meaning:'Shipping term',kind:'delivery'},
   {label:'',quote:'Returns are accepted within 14 days of delivery.',meaning:'A return window exists',kind:'returns'}]};
 const out=validateAnalysis(raw,normalizeOffer(offer));
 assert.equal(out.facts.length,0);
 assert.equal(out.rejectedClaims,2);
 assert.equal(out.unmatchedClaims,0);
 assert.equal(out.unusableClaims,2);
 assert.equal(out.omittedClaims,0);
});
test('invalid money, price fraction, incomplete terms are refused',()=>{
 assert.throws(()=>normalizeOffer({...offer,amountCents:4800.1}),/Amount/);
 assert.throws(()=>normalizeOffer({...offer,amountCents:NaN}),/Amount/);
 assert.throws(()=>normalizeOffer({...offer,terms:'short'}),/terms/);
 assert.equal(digestOffer(normalizeOffer(offer)).length,64);
});
test('no configured AI never fabricates an interpretation',async()=>{
 const app=createApp({env:{PORT:'4178'}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{const response=await fetch(`http://127.0.0.1:${app.server.address().port}/api/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(offer)});assert.equal(response.status,503);assert.match((await response.json()).error,/No actual AI model/)}finally{await new Promise(resolve=>app.server.close(resolve))}
});
test('real HTTP journey: analyze → explicit consent → sandbox order → capture',async(t)=>{
 const ctx=await setup();await close(t,ctx);
 const staticRes=await fetch(ctx.base+'/');assert.equal(staticRes.status,200);assert.match(await staticRes.text(),/<h1 id="context-item"><\/h1>/);
 assert.deepEqual(await (await fetch(ctx.base+'/api/config')).json(),{ai:true,aiTimeoutSeconds:35,reviewMode:'explain',paypal:true,sandbox:true});
 const a=await ctx.post('/api/analyze',offer);assert.equal(a.status,200);assert.equal(a.data.analysis.facts.length,1);
 const invalid=await ctx.post('/api/checkout',{id:a.data.id,digest:a.data.digest,consent:false,reviewedUnknowns:true});assert.equal(invalid.status,409);
 const tampered=await ctx.post('/api/checkout',{id:a.data.id,digest:'evil',consent:true,reviewedUnknowns:true,amountCents:1});assert.equal(tampered.status,409);
 const noOrder=await ctx.post('/api/capture',{id:a.data.id,orderId:'ORDER00001'});assert.equal(noOrder.status,404);
 const stage=await ctx.post('/api/checkout',{id:a.data.id,digest:a.data.digest,consent:true,reviewedUnknowns:true,amountCents:1});assert.equal(stage.status,200);assert.equal(stage.data.orderId,'ORDER00001');
 const replay=await ctx.post('/api/checkout',{id:a.data.id,digest:a.data.digest,consent:true,reviewedUnknowns:true});assert.deepEqual(replay.data,stage.data);
 const returnUrl=new URL(ctx.base+'/?return=1&review='+a.data.id+'&token=ORDER00001');
 const restoredResponse=await fetch(ctx.base+'/api/review?id='+returnUrl.searchParams.get('review'));
 assert.equal(restoredResponse.status,200);
 const restored=await restoredResponse.json();
 assert.equal(restored.order.orderId,stage.data.orderId);
 assert.deepEqual(restored.order,stage.data);
 assert.equal(restored.status,'pending_buyer');
 assert.equal(restored.offer.amountCents,4800);
 assert.equal(restored.offer.terms,terms); // returning to a new tab must recover the original source, not the example offer
 assert.equal(restored.analysis.facts.length,1);
 assert.equal((await fetch(ctx.base+'/api/review?id=bogus')).status,404);
 assert.equal(ctx.calls.filter(c=>c.url.endsWith('/v2/checkout/orders')).length,1);
 const created=JSON.parse(ctx.calls.find(c=>c.url.endsWith('/v2/checkout/orders')).body);
 assert.equal(created.purchase_units[0].amount.value,'48.00');
 const wrong=await ctx.post('/api/capture',{id:a.data.id,orderId:'WRONG00001'});assert.equal(wrong.status,409);
 const captured=await ctx.post('/api/capture',{id:a.data.id,orderId:'ORDER00001'});assert.equal(captured.status,200);assert.equal(captured.data.captureId,'CAPTURE00001');
 const repeat=await ctx.post('/api/capture',{id:a.data.id,orderId:'ORDER00001'});assert.deepEqual(repeat.data,captured.data);
 const afterCapture=await (await fetch(ctx.base+'/api/review?id='+a.data.id)).json();
 assert.equal(afterCapture.status,'captured');
 assert.equal(afterCapture.captureId,'CAPTURE00001');
 assert.equal(ctx.calls.filter(c=>c.url.includes('/capture')).length,1);
 assert.ok(ctx.calls.filter(c=>c.url.includes('paypal.com')).every(c=>c.url.startsWith('https://api-m.sandbox.paypal.com/')));
});
test('wrong PayPal capture amount cannot be reported completed',async(t)=>{
 const ctx=await setup({captureAmount:'49.00'});await close(t,ctx);
 const a=(await ctx.post('/api/analyze',offer)).data;
 await ctx.post('/api/checkout',{id:a.id,digest:a.digest,consent:true,reviewedUnknowns:true});
 const capture=await ctx.post('/api/capture',{id:a.id,orderId:'ORDER00001'});
 assert.equal(capture.status,502);assert.match(capture.data.error,/exact reviewed/);
 assert.equal(ctx.app.sessions.get(a.id).status,'pending_buyer');
});
test('unapproved payment fails visibly and remains pending',async(t)=>{
 const ctx=await setup({failCapture:true});await close(t,ctx);
 const a=(await ctx.post('/api/analyze',offer)).data;
 await ctx.post('/api/checkout',{id:a.id,digest:a.digest,consent:true,reviewedUnknowns:true});
 const capture=await ctx.post('/api/capture',{id:a.id,orderId:'ORDER00001'});
 assert.equal(capture.status,502);assert.equal(ctx.app.sessions.get(a.id).status,'pending_buyer');
});
test('invalid redirect or real PayPal host refused by the client',async()=>{
 const calls=[];
 const c=createPayPalClient({env:{PAYPAL_SANDBOX_CLIENT_ID:'x',PAYPAL_SANDBOX_CLIENT_SECRET:'y'},fetchImpl:async (url,r)=>{
  calls.push(url);return {ok:true,status:200,json:async()=>url.endsWith('/v1/oauth2/token')?{access_token:'test',expires_in:1000}:{id:'ID1234',links:[{rel:'approve',href:'https://www.paypal.com/checkoutnow?token=ID1234'}]}};
 }});
 await assert.rejects(c.createOrder(normalizeOffer(offer),'http://localhost:4000/','id1'),/valid approval link/);
 assert.ok(calls.every(x=>x.includes('sandbox.paypal.com')));
});
test('malicious model endpoint and absent provider fail closed',()=>{
 assert.throws(()=>createModelClient({env:{AI_BASE_URL:'http://evil.example',AI_MODEL:'x'}}),/HTTPS/);
});

test('unsupported reassurance never outranks contradictory source clauses',()=>{
 const terms='This item costs $48.00. Returns are accepted within 30 days. ALL SALES ARE FINAL and no refunds will be given. Shipping takes 60 days. Ask before paying.';
 const raw={summary:'A full refund is guaranteed.',caution:'low',facts:[
  {label:'Return window',quote:'Returns are accepted within 30 days.',meaning:'Allowed',kind:'returns'},
  {label:'Final sale',quote:'ALL SALES ARE FINAL and no refunds will be given.',meaning:'Disallowed',kind:'returns'},
  {label:'Invented guarantee',quote:'Refund absolutely guaranteed.',meaning:'Fake',kind:'returns'}],unknowns:[],questions:[]};
 const out=validateAnalysis(raw,normalizeOffer({...offer,terms}));
 assert.equal(out.facts.length,2);
 assert.equal(out.rejectedClaims,1);
 assert.match(out.summary,/conflict/i);
 assert.doesNotMatch(out.summary,/guaranteed/i);
 assert.match(out.unknowns[0],/Potential conflict/i);
 assert.equal(out.caution,'high');
});
test('no arbitrary model summary can become a source-grounded overview',()=>{
 const out=validateAnalysis({...modelReply,summary:'Full refund and free lifetime support guaranteed.'},normalizeOffer(offer));
 assert.match(out.summary,/source-matched passage/);
 assert.doesNotMatch(out.summary,/lifetime|guaranteed/i);
});
test('versioned localhost model URL works and unsafe HTTP model endpoint fails',async()=>{
 let called='';
 const c=createModelClient({env:{AI_BASE_URL:'http://127.0.0.1:5198/v1/',AI_MODEL:'fixture'},fetchImpl:async url=>{
  called=url;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(modelReply)}}]})};
 }});
 const out=await c.analyze(normalizeOffer(offer));
 assert.equal(called,'http://127.0.0.1:5198/v1/chat/completions');
 assert.equal(out.facts.length,1);
 assert.throws(()=>createModelClient({env:{AI_BASE_URL:'http://otherhost:5198/v1',AI_MODEL:'x'}}),/HTTPS/);
 assert.throws(()=>createModelClient({env:{AI_BASE_URL:'https://name:password@example.com/v1',AI_MODEL:'x'}}),/HTTPS/);
});


test('verbatim multiline merchant clauses remain clickable evidence without rewriting their whitespace',()=>{
 const terms='Payment is due at checkout. Shipping is free and normally takes five business days.\nReturns require unused packaging\nand a dated receipt. The seller may charge return postage.';
 const quote='Returns require unused packaging\nand a dated receipt.';
 const result=validateAnalysis({facts:[{label:'Returns evidence',quote,meaning:'An unused product and dated receipt are required',kind:'returns'}],unknowns:[],questions:[]},normalizeOffer({...offer,terms}));
 assert.equal(result.facts.length,1);assert.equal(result.rejectedClaims,0);
 assert.equal(result.facts[0].quote,quote);
 const range=findQuoteRange(terms,result.facts[0].quote);
 assert.equal(terms.slice(range.start,range.end),quote);
});
test('long model quotations cannot be truncated into believable supporting excerpts',()=>{
 const supported='A'.repeat(280);
 const terms=supported+' The merchant may change terms after purchase and does not guarantee delivery.';
 const quote=supported+' INVENTED BUYER PROTECTION';
 const result=validateAnalysis({facts:[{label:'Fake guarantee',quote,meaning:'Buyer is protected',kind:'other'}],unknowns:[],questions:[]},normalizeOffer({...offer,terms}));
 assert.equal(result.facts.length,0);assert.equal(result.rejectedClaims,1);
});


test('a real HTTP Sandbox checkout resumes with identical reviewed source after app restart, never auto-captures',async(t)=>{
 const dir=await mkdtemp(path.join(tmpdir(),'consentcart-resume-'));
 const stateFile=path.join(dir,'private','reviews.json');
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const upstream=mockUpstream();
 const fixed=Date.now();
 async function start(){
   const app=createApp({fetchImpl:upstream.fetchImpl,env:{...env,PORT:'4178'},now:()=>fixed,stateFile});
   await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
   const base='http://127.0.0.1:'+app.server.address().port;
   return {app,base,post:async(route,body)=>{
     const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
     return {status:response.status,data:await response.json()};
   },close:()=>new Promise(resolve=>app.server.close(resolve))};
 }
 const first=await start();t.after(()=>first.app.server.listening?first.close():undefined);
 const analyzed=await first.post('/api/analyze',offer);
 assert.equal(analyzed.status,200);
 const {id,digest}=analyzed.data;
 const questions=[{text:'Does the fee apply to this return?',reason:'Non-defective returns have a 10% restocking fee.',reply:'Support: the fee applies unless the item is defective.',included:false}];
 assert.equal((await first.post('/api/checkout',{id,digest,consent:true,reviewedUnknowns:true,buyerQuestions:[{text:'Question',reason:'',reply:'x'.repeat(24001)}]})).status,422);
 assert.equal(upstream.calls.filter(c=>c.url.endsWith('/v2/checkout/orders')).length,0);
 const order=await first.post('/api/checkout',{id,digest,consent:true,reviewedUnknowns:true,buyerQuestions:questions});
 assert.equal(order.status,200);
 const before=await (await fetch(first.base+'/api/review?id='+id)).json();
 const saved=JSON.parse(await readFile(stateFile,'utf8'));
 assert.equal(saved.version,1);
 assert.equal(saved.sessions.length,1);
 assert.equal(saved.sessions[0][1].offer.terms,terms);assert.deepEqual(saved.sessions[0][1].buyerQuestions,questions);
 assert.equal(JSON.stringify(saved).includes('test-secret'),false);
 if(process.platform!=='win32')assert.equal((await stat(stateFile)).mode&0o077,0);
 await first.close();
 const resumed=await start();t.after(()=>resumed.app.server.listening?resumed.close():undefined);
 const response=await fetch(resumed.base+'/api/review?id='+id);
 assert.equal(response.status,200);
 const after=await response.json();
 assert.deepEqual(after,before);
 assert.equal(upstream.calls.filter(c=>c.url.endsWith('/capture')).length,0);
 const retryQuestions=[{...questions[0],reply:'Updated reply recorded before retrying the same checkout.'}];
 const replay=await resumed.post('/api/checkout',{id,digest,consent:true,reviewedUnknowns:true,buyerQuestions:retryQuestions});
 assert.deepEqual((await(await fetch(resumed.base+'/api/review?id='+id)).json()).buyerQuestions,retryQuestions);
 assert.deepEqual(replay.data,order.data);
 assert.equal(upstream.calls.filter(c=>c.url.endsWith('/v2/checkout/orders')).length,1);
 const finalQuestions=[{...questions[0],reply:'Support follow-up: retain the packaging until the return is accepted.'}];
 assert.equal((await resumed.post('/api/capture',{id,orderId:order.data.orderId,digest:'another offer',buyerQuestions:finalQuestions})).status,409);
 assert.equal(upstream.calls.filter(c=>c.url.endsWith('/capture')).length,0);
 const captured=await resumed.post('/api/capture',{id,orderId:order.data.orderId,digest,buyerQuestions:finalQuestions});
 assert.equal(captured.status,200);
 assert.equal(captured.data.captureId,'CAPTURE00001');
 await resumed.close();
 const third=await start();t.after(()=>third.app.server.listening?third.close():undefined);
 const recovered=await (await fetch(third.base+'/api/review?id='+id)).json();assert.equal(recovered.status,'captured');assert.deepEqual(recovered.buyerQuestions,finalQuestions);
 const {readSavedOffer}=await import('../web/saved-review.js');const html=await(await fetch(third.base+'/api/review-record?id='+id)).text();assert.deepEqual(readSavedOffer(html).buyerQuestions,finalQuestions);
 const repeated=await third.post('/api/capture',{id,orderId:order.data.orderId});
 assert.deepEqual(repeated.data,captured.data);
 assert.equal(upstream.calls.filter(c=>c.url.endsWith('/capture')).length,1);
 await third.close();
});

test('corrupt state cannot silently discard an unknown sandbox checkout',async(t)=>{
 const dir=await mkdtemp(path.join(tmpdir(),'consentcart-corrupt-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'reviews.json');
 await writeFile(file,'{"version":1,"sessions":[', {mode:0o600});
 assert.throws(()=>createApp({stateFile:file}),/Cannot safely recover/);
 assert.equal(await readFile(file,'utf8'),'{"version":1,"sessions":[');
});

test('expired persisted reviews cannot be captured or resurrected',async(t)=>{
 const dir=await mkdtemp(path.join(tmpdir(),'consentcart-expired-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const stateFile=path.join(dir,'reviews.json'),initial=Date.now();
 const upstream=mockUpstream();
 const options={fetchImpl:upstream.fetchImpl,env,now:()=>initial,stateFile};
 const first=createApp(options);
 await new Promise(resolve=>first.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+first.server.address().port;
 const response=await fetch(base+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(offer)});
 const analyzed=await response.json();
 assert.equal(response.status,200);
 await new Promise(resolve=>first.server.close(resolve));
 const later=createApp({...options,now:()=>initial+46*60_000});
 await new Promise(resolve=>later.server.listen(0,'127.0.0.1',resolve));
 try{
   const url='http://127.0.0.1:'+later.server.address().port;
   assert.equal((await fetch(url+'/api/review?id='+analyzed.id)).status,404);
   const capture=await fetch(url+'/api/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:analyzed.id,orderId:'ORDER00001'})});
   assert.equal(capture.status,404);
 }finally{await new Promise(resolve=>later.server.close(resolve))}
});

test('portable review follows original reviewed source and observed Sandbox state without bearer links',async(t)=>{
 const ctx=await setup();await close(t,ctx);
 const a=(await ctx.post('/api/analyze',offer)).data;
 const url=ctx.base+'/api/review-record?id='+a.id;
 const record=async()=>{const r=await fetch(url);assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/attachment/);assert.equal(r.headers.get('cache-control'),'no-store');return r.text()};
 const initial=await record();
 assert.match(initial,/Review only — no Sandbox order created/);
 assert.ok(initial.includes(terms));assert.match(initial,/48.00 USD/);
 assert.match(initial,/unverified/);assert.match(initial,/No refunds processing time provided/);
 assert.ok(!initial.includes(a.id));assert.ok(!initial.includes(a.digest));
 const callsBefore=ctx.calls.length;await record();assert.equal(ctx.calls.length,callsBefore,'Saving must never contact model or PayPal');
 ctx.app.sessions.get(a.id).busy=true;
 assert.equal((await fetch(url)).status,409);
 ctx.app.sessions.get(a.id).busy=false;
 await ctx.post('/api/checkout',{id:a.id,digest:a.digest,consent:true,reviewedUnknowns:true});
 const pending=await record();
 assert.match(pending,/capture is not confirmed/);assert.match(pending,/ORDER00001/);
 assert.doesNotMatch(pending,/checkoutnow|TEST_ACCESS_TOKEN|test-secret/);
 await ctx.post('/api/capture',{id:a.id,orderId:'ORDER00001'});
 const complete=await record();
 assert.match(complete,/Sandbox capture confirmed/);assert.match(complete,/CAPTURE00001/);
 assert.match(complete,/unsigned local snapshot/);assert.match(complete,/no real money/);
 assert.equal((await fetch(ctx.base+'/api/review-record?id=missing')).status,404);
});
test('portable review preserves potentially hostile source as inert text',async()=>{
 const {renderReviewRecord}=await import('../review-record.mjs');
 const hostile='<script>alert(1)</script><img src="https://outside.invalid/track"> & "<buyer>"';
 const html=renderReviewRecord({created:0,offer:{...offer,merchant:hostile,terms:hostile},analysis:{summary:hostile,facts:[{label:hostile,quote:hostile,meaning:hostile}],unknowns:[hostile],questions:[hostile]},status:'review'},1);
 assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
 assert.match(html,/default-src &#39;none&#39;/);assert.match(html,/style-src &#39;unsafe-inline&#39;/);
});


test('local model wait is explicit and bounded; invalid configuration fails early',()=>{
  assert.equal(createModelClient({env:{}}).timeoutMs,35000);
  assert.equal(createModelClient({env:{AI_TIMEOUT_MS:'120000'}}).timeoutMs,120000);
  for(const value of ['NaN','Infinity','0','999','180001','1200.5']){
    assert.throws(()=>createModelClient({env:{AI_TIMEOUT_MS:value}}),/AI_TIMEOUT_MS/);
  }
});
test('a timed-out model request never becomes a review',async t=>{
  const app=createApp({env:{AI_BASE_URL:'https://model.localhost/v1',AI_MODEL:'test-model',AI_TIMEOUT_MS:'1000'},
    fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
  const res=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(offer)});
  assert.equal(res.status,504);assert.match((await res.json()).error,/timed out/);assert.equal(app.sessions.size,0);
});

test('completed unapproved review survives restart without inference or implicit consent',async(t)=>{
 const dir=await mkdtemp(path.join(tmpdir(),'consentcart-review-resume-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const stateFile=path.join(dir,'reviews.json'),initial=Date.now(),upstream=mockUpstream();
 async function start(){
   const app=createApp({fetchImpl:upstream.fetchImpl,env,now:()=>initial,stateFile});
   await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
   const base='http://127.0.0.1:'+app.server.address().port;
   const post=async(route,body)=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()}};
   return {app,base,post,close:()=>new Promise(r=>app.server.close(r))};
 }
 const first=await start();t.after(()=>first.app.server.listening?first.close():undefined);
 const analyzed=await first.post('/api/analyze',offer);
 assert.equal(analyzed.status,200);
 const before=await (await fetch(first.base+'/api/review?id='+analyzed.data.id)).json();
 assert.equal(before.order,null);assert.equal(before.status,'review');
 assert.equal(before.expiresAt,initial+45*60_000);
 const disk=JSON.parse(await readFile(stateFile,'utf8'));
 assert.equal(disk.sessions.length,1);assert.equal(disk.sessions[0][1].offer.terms,terms);
 if(process.platform!=='win32')assert.equal((await stat(stateFile)).mode&0o077,0);
 await first.close();
 const second=await start();t.after(()=>second.app.server.listening?second.close():undefined);
 const restoredResponse=await fetch(second.base+'/api/review?id='+analyzed.data.id);
 assert.equal(restoredResponse.status,200);assert.equal(restoredResponse.headers.get('cache-control'),'no-store');
 assert.deepEqual(await restoredResponse.json(),before);
 const record=await fetch(second.base+'/api/review-record?id='+analyzed.data.id);
 assert.equal(record.status,200);assert.ok((await record.text()).includes(terms));
 assert.equal(upstream.calls.length,1,'Recovery and saved copy must not call any provider');
 const refused=await second.post('/api/checkout',{id:before.id,digest:before.digest,consent:false,reviewedUnknowns:true});
 assert.equal(refused.status,409);assert.equal(upstream.calls.length,1);
 const accepted=await second.post('/api/checkout',{id:before.id,digest:before.digest,consent:true,reviewedUnknowns:true});
 assert.equal(accepted.status,200);assert.equal(accepted.data.orderId,'ORDER00001');
 assert.equal(upstream.calls.filter(c=>c.url.includes('/capture')).length,0);
 await second.close();
});

test('failed durable write cannot return a recoverable review or retain an unpublished session',async(t)=>{
 const dir=await mkdtemp(path.join(tmpdir(),'consentcart-review-write-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const blocked=path.join(dir,'blocked');
 await writeFile(blocked,'not a directory');
 const upstream=mockUpstream();
 const app=createApp({fetchImpl:upstream.fetchImpl,env,stateFile:path.join(dir,'reviews.json')});
 // Replace the parent after startup to force an actual disk-write failure.
 await rm(dir,{recursive:true,force:true});await writeFile(dir,'not a directory');
 t.after(()=>rm(dir,{force:true}));
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
 const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(offer)});
 assert.equal(response.status,500);assert.equal(app.sessions.size,0);
});

test('issued checkout survives a long approval and restart without creating another order',async(t)=>{
 const dir=await mkdtemp(path.join(tmpdir(),'consentcart-issued-retain-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const stateFile=path.join(dir,'reviews.json'),initial=Date.now(),upstream=mockUpstream();
 let clock=initial;
 async function start(){
  const app=createApp({fetchImpl:upstream.fetchImpl,env,now:()=>clock,stateFile});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  return {app,base,post:async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()}},close:()=>new Promise(r=>app.server.close(r))};
 }
 const first=await start();t.after(()=>first.app.server.listening?first.close():undefined);
 const reviewed=(await first.post('/api/source-review',offer)).data;
 const consent={id:reviewed.id,digest:reviewed.digest,consent:true,reviewedUnknowns:true};
 const order=(await first.post('/api/checkout',consent)).data;
 const other=(await first.post('/api/source-review',offer)).data;
 clock=initial+46*60_000;
 const retained=await(await fetch(first.base+'/api/review?id='+reviewed.id)).json();
 assert.equal(retained.order.orderId,order.orderId);assert.equal(retained.expiresAt,null);
 assert.equal((await fetch(first.base+'/api/review?id='+other.id)).status,404);
 await first.close();clock=initial+7*24*60*60_000;
 const resumed=await start();t.after(()=>resumed.app.server.listening?resumed.close():undefined);
 const restored=await(await fetch(resumed.base+'/api/review?id='+reviewed.id)).json();
 assert.deepEqual(restored,retained);
 assert.equal((await resumed.post('/api/checkout',{...consent,consent:false})).status,409);
 assert.equal((await resumed.post('/api/checkout',{...consent,digest:'different'})).status,409);
 assert.deepEqual((await resumed.post('/api/checkout',consent)).data,order);
 assert.equal(upstream.calls.filter(c=>c.url.endsWith('/v2/checkout/orders')).length,1);
 assert.equal(upstream.calls.filter(c=>c.url.endsWith('/capture')).length,0);
});

test('saving a review without checkout retains validated questions across restart and explicit clearing',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'consentcart-review-save-')),stateFile=path.join(dir,'reviews.json');let app,calls=0;
 const start=async()=>{app=createApp({env:{},stateFile,fetchImpl:async()=>{calls++;throw Error('No provider request belongs to review saving')}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.server.address().port};
 const stop=()=>new Promise(r=>app.server.close(r));
 t.after(async()=>{if(app?.server.listening)await stop();await rm(dir,{recursive:true,force:true})});
 let base=await start();
 const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const reviewed=await(await post('/api/source-review',offer)).json();
 const buyerQuestions=[{text:'Does the refund include delivery?',reason:'Buyer question',reply:'Buyer-recorded reply, unverified.'}];
 assert.equal((await post('/api/review-record',{id:reviewed.id,digest:reviewed.digest,retain:true,buyerQuestions})).status,200);
 await stop();base=await start();
 let restored=await(await fetch(base+'/api/review?id='+reviewed.id)).json();
 assert.deepEqual(restored.buyerQuestions,buyerQuestions);assert.equal(restored.order,null);
 assert.equal((await post('/api/review-record',{id:reviewed.id,digest:'wrong-offer',buyerQuestions:[]})).status,409);
 assert.deepEqual((await(await fetch(base+'/api/review?id='+reviewed.id)).json()).buyerQuestions,buyerQuestions);
 assert.equal((await post('/api/review-record',{id:reviewed.id,digest:reviewed.digest,retain:true,buyerQuestions:[]})).status,200);
 await stop();base=await start();
 restored=await(await fetch(base+'/api/review?id='+reviewed.id)).json();assert.deepEqual(restored.buyerQuestions,[]);assert.equal(calls,0);
});
