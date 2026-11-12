import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
const offer={merchant:'Moss & Field',itemName:'Field notebook',amountCents:4117,terms:'Notebook costs $41.17 including delivery. Dispatch takes two business days. Returns within thirty days require the buyer to pay postage. Personalized notebooks cannot be returned.'};
test('source review needs no model, preserves exact terms and payment binding across restart',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'source-review-'));
 const stateFile=path.join(directory,'reviews.json');let calls=0,app;
 const open=async()=>{app=createApp({env:{PORT:'4178'},stateFile,fetchImpl:async()=>{calls++;throw Error('Unexpected provider call')}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.server.address().port};
 const post=async(base,url,data)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()}};
 try{
  let base=await open();
  assert.equal((await post(base,'/api/source-review',{...offer,amountCents:0})).status,422);
  const review=await post(base,'/api/source-review',offer);assert.equal(review.status,200);assert.equal(calls,0);
  assert.deepEqual(review.data.offer,{...offer,currency:'USD'});
  assert.equal(review.data.analysis.reviewMethod,'manual');assert.deepEqual(review.data.analysis.facts,[]);
  const checkout={id:review.data.id,digest:review.data.digest,consent:true,reviewedUnknowns:true};
  assert.equal((await post(base,'/api/checkout',{...checkout,digest:'changed'})).status,409);
  assert.equal((await post(base,'/api/checkout',{...checkout,consent:false})).status,409);
  assert.equal(calls,0);
  await new Promise(r=>app.server.close(r));base=await open();
  const restored=await(await fetch(base+'/api/review?id='+review.data.id)).json();
  assert.equal(restored.digest,review.data.digest);assert.equal(restored.offer.terms,offer.terms);assert.equal(restored.order,null);
  const html=await(await fetch(base+'/api/review-record?id='+review.data.id)).text();
  assert.match(html,/All pasted terms/);assert.doesNotMatch(html,/AI-selected original terms|Excluded claims:|Highlighted text was selected/);
  assert.ok(html.includes('Personalized notebooks cannot be returned.'));
  assert.equal(calls,0);
 }finally{if(app?.server.listening)await new Promise(r=>app.server.close(r));await rm(directory,{recursive:true,force:true})}
});

test('saved source label keeps distinct return eligibility and every repeated source location',async()=>{
 const {renderReviewRecord}=await import('../review-record.mjs');
 const mattress='Mattress purchases may be exchanged for another mattress one time within 90 days.';
 const clauses=['Sealed orders may be returned within 21 days with a receipt.','Opened orders may be returned within 7 days if undamaged.',mattress,'Bring photo ID when exchanging an item.'];
 const terms=clauses.join(' ')+' '+mattress+' Refunds are processed within 30 days.';
 const html=renderReviewRecord({created:Date.now(),offer:{...offer,terms},analysis:{mode:'source',reviewMethod:'manual',facts:[]},status:'reviewed'});
 const label=html.match(/<section class="terms-label"[^>]*>([\s\S]*?)<\/section>/)[1];
 const conditionText=[...label.matchAll(/<span class="term-clause-copy">([\s\S]*?)<\/span>/g)].map(match=>match[1].replace(/<[^>]*>/g,''));
 assert.deepEqual(conditionText,clauses);
 assert.equal((label.match(/Mattress purchases may be exchanged/g)||[]).length,1,'Repeated source wording must stay one readable condition');
 for(const clause of clauses){
  const start=terms.indexOf(clause);
  assert.ok(label.includes('href="#source-'+start+'"'),'Each displayed condition must reach its original sentence');
  assert.ok(html.includes('id="source-'+start+'"'));
 }
 assert.ok(label.includes('href="#source-'+terms.lastIndexOf(mattress)+'"'),'The repeated original location remains reachable');
 const returns=label.match(/<article[^>]*>([\s\S]*?)<\/article>/)[1];
 assert.ok(!returns.includes('Refunds are processed within 30 days.'));
});
