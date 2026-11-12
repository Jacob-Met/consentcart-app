import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createApp} from '../server.mjs';
import {readSavedOffer} from '../web/saved-review.js';
import {serializeOfferDraft,readOfferDraft} from '../web/offer-draft.js';
import {writeComparisonDraft,readComparisonDraft} from '../web/comparison-draft.js';
import {compareOriginalTerms} from '../web/offer-comparison.js';
const tail=' Personalized covers cannot be returned unless defective.';
const terms='原本の購入条件。'.repeat(18000)+tail;
const offer={merchant:'Moss & Field',itemName:'Field notebook',amountCents:4117,terms};
test('long Unicode policy survives manual review, saved HTML, restart, draft and paired return without model calls',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'long-policy-'));let app,calls=0;
 const open=async()=>{app=createApp({env:{},stateFile:path.join(dir,'reviews.json'),fetchImpl:async()=>{calls++;throw Error('Unexpected provider call')}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.server.address().port};
 const post=async(base,url,value)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});return {status:r.status,data:await r.json()}};
 try{
  let base=await open();const response=await post(base,'/api/source-review',offer);
  assert.equal(response.status,200);assert.equal(response.data.offer.terms,terms);
  const exported=await(await fetch(base+'/api/review-record?id='+response.data.id)).text();
  assert.equal(readSavedOffer(exported).terms,terms);
  const draft={merchant:offer.merchant,itemName:offer.itemName,amount:'41.17',terms};
  assert.deepEqual(readOfferDraft(serializeOfferDraft(draft)),draft);
  let raw;const storage={setItem:(k,v)=>raw=v,getItem:()=>raw};
  const a={offer,buyerQuestions:[{text:'Does the final exclusion apply?',reason:tail}]},b={...a,offer:{...offer,terms:terms.replace('unless defective','even if defective')}};
  assert.equal(writeComparisonDraft(storage,a,b),true);
  assert.equal(readComparisonDraft(storage).saved.offer.terms,terms);
  assert.deepEqual(readComparisonDraft(storage).current.buyerQuestions,b.buyerQuestions);
  assert.equal((await post(base,'/api/analyze',offer)).status,422);assert.equal(calls,0);
  assert.equal((await post(base,'/api/source-review',{...offer,terms:'x'.repeat(150000)})).status,200);
  assert.equal((await post(base,'/api/source-review',{...offer,terms:'x'.repeat(150001)})).status,422);
  await new Promise(r=>app.server.close(r));base=await open();
  const restored=await(await fetch(base+'/api/review?id='+response.data.id)).json();
  assert.equal(restored.offer.terms,terms);assert.equal(restored.digest,response.data.digest);assert.equal(restored.order,null);
  assert.equal(calls,0);
 }finally{if(app?.server.listening)await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true})}
});
test('many-sentence comparison retains every character and remote exception with bounded alignment',()=>{
 const left='A condition. '.repeat(2500)+tail,right='A condition. '.repeat(2500)+' Personalized covers are accepted.';
 const rows=compareOriginalTerms(left,right);
 assert.equal(rows.map(r=>r.kept).join(''),left);assert.equal(rows.map(r=>r.current).join(''),right);
 assert.equal(rows.some(r=>r.changed),true);assert.equal(rows.some(r=>r.coarse),true);
 assert.equal(compareOriginalTerms(left,left).some(r=>r.changed),false);
});
