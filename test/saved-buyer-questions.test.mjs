import test from 'node:test';import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {buyerSituationQuestion} from '../web/clarification.js';
import {readSavedOffer,savedOfferMetadata,savedBuyerQuestions} from '../web/saved-review.js';
const offer={merchant:'Moss & Field',itemName:'Personalized notebook',amountCents:4117,terms:'Returns within 30 days require the original packaging. Personalized covers cannot be returned unless defective. The buyer pays return postage.'};
const questions=[{text:'Will you cover return postage if the personalization is incorrect?',reason:'Personalized covers cannot be returned unless defective.',reply:'Moss & Field support, 11 November: send photographs first.\nA return label is provided only after approval.',included:false},{text:'Can you confirm <script> is literal text & not an instruction?',reason:'',reply:'Literal <script> & quotation; no purchase approved.'}];
test('downloaded review keeps selected buyer questions with exact offer and rejects a stale review binding',async()=>{
 let calls=0;const app=createApp({env:{},fetchImpl:async()=>{calls++;throw Error('Unexpected provider call')}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const post=(path,data)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
  const review=await(await post('/api/source-review',offer)).json();
  const response=await post('/api/review-record',{id:review.id,digest:review.digest,buyerQuestions:questions});
  assert.equal(response.status,200);const html=await response.text();
  assert.ok(html.includes('Your questions and replies'));assert.ok(html.includes('Reply you recorded'));assert.ok(html.includes('only after approval.'));assert.ok(html.includes('&lt;script&gt;'));
  assert.deepEqual(readSavedOffer(html),{...offer,currency:'USD',buyerQuestions:questions});
  assert.equal(readSavedOffer(html).order,undefined);assert.equal(readSavedOffer(html).consent,undefined);
  assert.equal((await post('/api/review-record',{id:review.id,digest:'different offer',buyerQuestions:questions})).status,409);
  assert.equal((await post('/api/review-record',{id:review.id,digest:review.digest,buyerQuestions:[{text:'x'.repeat(24001),reason:''}]})).status,422);
  assert.equal((await post('/api/review-record',{id:review.id,digest:review.digest,buyerQuestions:[{text:'My question?',reason:'',reply:'x'.repeat(24001)}]})).status,422);
  assert.equal((await post('/api/review-record',{id:review.id,digest:review.digest,buyerQuestions:[{text:'',reason:'',reply:'A reply without its question'}]})).status,422);
  const retained=await(await fetch(base+'/api/review?id='+review.id)).json();
  assert.equal(retained.order,null);assert.equal(retained.buyerQuestions,undefined);assert.deepEqual(retained.offer,{...offer,currency:'USD'});
  const old=await(await fetch(base+'/api/review-record?id='+review.id)).text();assert.deepEqual(readSavedOffer(old),{...offer,currency:'USD'});
  assert.equal(calls,0);
 }finally{await new Promise(r=>app.server.close(r))}
});
test('saved question metadata is bounded and drops imported executable or payment authority',()=>{
 const extra=questions.map(q=>({...q,order:'forged',consent:true}));
 assert.deepEqual(readSavedOffer(savedOfferMetadata({...offer,currency:'USD'},extra)).buyerQuestions,questions);
 assert.throws(()=>savedBuyerQuestions([{text:'',reason:''}]),/invalid/);
 assert.throws(()=>savedBuyerQuestions(Array.from({length:65},()=>questions[0])),/invalid/);
 assert.throws(()=>savedBuyerQuestions(Array.from({length:4},()=>({text:'x'.repeat(20000),reason:''}))),/size/);
});

test('buyer-owned applicability survives downloaded source questions without becoming merchant authority',async()=>{
 let providerCalls=0;
 const app=createApp({env:{},fetchImpl:()=>{providerCalls++;throw Error('Unexpected provider call')}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port;
 const post=(path,data)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const source='Returns are allowed within thirty days for unused items. Annual subscriptions do not qualify for refunds after renewal. To request cancellation, contact the merchant before renewal and include the purchase date.';
 const reviewed={...offer,terms:source};
 const question='Does the 30-day return apply to my annual subscription renewal?';
 const reason='Original conditions: '+source;
 const replies=[
  {text:question,reason,reply:'Support: please send your invoice; I cannot determine your plan.',assessment:'needs-follow-up'},
  {text:'Can I keep access until renewal?',reason:'Source condition: cancellation before renewal.',reply:'Support reply: access lasts until the current end date.',assessment:'answered'}
 ];
 try{
  const review=await (await post('/api/source-review',reviewed)).json();
  const response=await post('/api/review-record',{id:review.id,digest:review.digest,buyerQuestions:replies});
  assert.equal(response.status,200);
  const html=await response.text();
  assert.ok(html.includes('You still need clarification'));
  assert.ok(html.includes('You marked this answered for your purchase'));
  assert.ok(html.includes('Original conditions behind this question'));
  assert.ok(html.includes('not independently confirmed'));
  assert.ok(!html.includes('<script>'));
  assert.deepEqual(readSavedOffer(html).buyerQuestions,replies);
  const invalid=[
   {text:question,reason,reply:'support',assessment:'merchant-confirmed'},
   {text:question,reason,assessment:'answered'},
   {text:question,reason,reply:'',assessment:'needs-follow-up'}
  ];
  for(const q of invalid)assert.equal((await post('/api/review-record',{id:review.id,digest:review.digest,buyerQuestions:[q]})).status,422);
  const old=await (await post('/api/review-record',{id:review.id,digest:review.digest,buyerQuestions:[{text:question,reason,reply:'Support replied.'}]})).text();
  assert.deepEqual(readSavedOffer(old).buyerQuestions,[{text:question,reason,reply:'Support replied.'}]);
  assert.ok(old.includes('Reply recorded, not yet assessed'));
  assert.equal(providerCalls,0);
 }finally{await new Promise(r=>app.server.close(r))}
});

test('saved reading selection persists through the ordinary store and can be cleared',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'consentcart-section-')),stateFile=join(dir,'reviews.json');
 let app=createApp({env:{},stateFile});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 let base='http://127.0.0.1:'+app.server.address().port;
 const post=(path,data)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const terms='Month to month\n\nReturns are final after 14 days.\n\nAnnual contract, billed monthly\n\nCancellation Terms\n\nCancel after 14 days for a 50% charge. California customers pay 30%.';
 const sourceSection={start:terms.indexOf('Annual contract'),heading:'Annual contract, billed monthly'};
 try{
  const review=await(await post('/api/source-review',{...offer,terms})).json();
  const data={id:review.id,digest:review.digest,buyerQuestions:questions,sourceSection,retain:true};
  const response=await post('/api/review-record',data);assert.equal(response.status,200);
  assert.deepEqual(readSavedOffer(await response.text()).sourceSection,sourceSection);
  await new Promise(r=>app.server.close(r));app=createApp({env:{},stateFile});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;
  const restored=await(await fetch(base+'/api/review?id='+review.id)).json();assert.deepEqual(restored.sourceSection,sourceSection);assert.equal(restored.order,null);
  assert.equal((await post('/api/review-record',{...data,sourceSection:{...sourceSection,start:0}})).status,422);
  assert.equal((await post('/api/review-record',{...data,sourceSection:null})).status,200);
  assert.equal((await(await fetch(base+'/api/review?id='+review.id)).json()).sourceSection,null);
 }finally{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true})}
});

test('saved HTML shows the buyer situation plainly without falsely calling it an original merchant term',async()=>{
 const app=createApp({env:{}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 const post=(path,data)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const situation='Ordered through a reseller on 1 November; received damaged cover <script> on 6 November.';
 const caseRow=buyerSituationQuestion(situation);
 try{
  const review=await(await post('/api/source-review',offer)).json();
  const response=await post('/api/review-record',{id:review.id,digest:review.digest,buyerQuestions:[caseRow]});
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html,/Your situation — as entered/);
  assert.match(html,/reseller on 1 November/);
  assert.match(html,/damaged cover &lt;script&gt;/);
  assert.doesNotMatch(html,/Original conditions behind this question/);
  assert.deepEqual(readSavedOffer(html).buyerQuestions,[caseRow]);
  assert.ok(html.includes('not verify merchant identity'));
 }finally{await new Promise(resolve=>app.server.close(resolve))}
});
