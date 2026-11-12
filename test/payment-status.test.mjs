import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {inspectPayPalOrder,createPayPalClient} from '../engine.mjs';
const orderId='ORDER90001';
const amount={currency_code:'USD',value:'42.00'};
const completed=()=>({id:orderId,intent:'CAPTURE',status:'COMPLETED',purchase_units:[{reference_id:'CONSENTCART',amount,payments:{captures:[{id:'CAPTURE90001',status:'COMPLETED',amount}]}}]});
test('payment observation rejects wrong identity, amount, intent and multiple captures',()=>{
 for(const change of [
  r=>r.id='OTHER90001',r=>r.intent='AUTHORIZE',r=>r.purchase_units[0].reference_id='OTHER',
  r=>r.purchase_units[0].amount={...amount,value:'43.00'},
  r=>r.purchase_units[0].payments.captures[0].amount={...amount,value:'4.20'},
  r=>r.purchase_units.push(r.purchase_units[0]),
  r=>r.purchase_units[0].payments.captures.push({...r.purchase_units[0].payments.captures[0],id:'CAPTURE90002'}),
 ]){const r=completed();change(r);assert.throws(()=>inspectPayPalOrder(r,orderId,4200))}
});
test('read-only pending, approved, refunded and voided observations never masquerade as completion',()=>{
 for(const state of ['PENDING','DECLINED','FAILED','REFUNDED','PARTIALLY_REFUNDED']){
  const r=completed();r.purchase_units[0].payments.captures[0].status=state;
  const out=inspectPayPalOrder(r,orderId,4200);assert.equal(out.status,({REFUNDED:'refunded',PARTIALLY_REFUNDED:'partially_refunded'})[state]||'pending_buyer');assert.equal(out.canCapture,false);
 }
 for(const state of ['CREATED','APPROVED','VOIDED','PAYER_ACTION_REQUIRED']){
  const r=completed();r.status=state;delete r.purchase_units[0].payments;
  const out=inspectPayPalOrder(r,orderId,4200);assert.equal(out.canCapture,state==='APPROVED');assert.equal(out.status,'pending_buyer');
 }
});
test('a lost capture response recovers by GET after restart without another capture',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'consentcart-status-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const calls=[];let providerCaptured=false;
 const fetchImpl=async(url,request={})=>{
  calls.push({url,method:request.method,body:request.body});
  if(url.endsWith('/chat/completions'))return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({facts:[],unknowns:[],questions:[],caution:'high'})}}]})};
  if(url.endsWith('/oauth2/token'))return {ok:true,json:async()=>({access_token:'AUTHORED_TEST_TOKEN',expires_in:300})};
  if(url.endsWith('/orders')&&request.method==='POST')return {ok:true,json:async()=>({id:orderId,links:[{rel:'approve',href:'https://www.sandbox.paypal.com/checkoutnow?token='+orderId}]})};
  if(url.endsWith('/capture')){providerCaptured=true;throw new TypeError('Authored lost response after provider capture')}
  if(url.endsWith('/orders/'+orderId)&&request.method==='GET'){assert.equal(providerCaptured,true);return {ok:true,json:async()=>completed()}}
  throw new Error('Unexpected authored request');
 };
 const env={AI_BASE_URL:'http://localhost:41000/v1',AI_MODEL:'AUTHORED_FIXTURE',PAYPAL_SANDBOX_CLIENT_ID:'AUTHORED_ID',PAYPAL_SANDBOX_CLIENT_SECRET:'AUTHORED_SECRET'};
 const stateFile=path.join(directory,'reviews.json');
 let app,base;
 async function start(){app=createApp({env,fetchImpl,stateFile});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port}
 async function post(route,body){const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
 await start();
 const review=(await post('/api/analyze',{merchant:'Authored merchant',itemName:'Repair part',amountCents:4200,terms:'Repair part costs forty-two dollars. It is sold as described. Delivery and refund conditions must be reviewed before checkout.'})).body;
 await post('/api/checkout',{id:review.id,digest:review.digest,consent:true,reviewedUnknowns:true});
 assert.equal((await post('/api/capture',{id:review.id,orderId})).status,500);
 await new Promise(r=>app.server.close(r));
 await start();t.after(()=>new Promise(r=>app.server.close(r)));
 const observed=await post('/api/payment-status',{id:review.id,orderId});
 assert.equal(observed.status,200);assert.equal(observed.body.status,'captured');assert.equal(observed.body.captureId,'CAPTURE90001');
 const repeat=await post('/api/capture',{id:review.id,orderId});assert.equal(repeat.status,200);
 assert.equal(calls.filter(c=>c.url.endsWith('/capture')).length,1);
 assert.equal(calls.filter(c=>c.url.endsWith('/orders')).length,1);
 const reads=calls.filter(c=>c.url.endsWith('/orders/'+orderId));assert.equal(reads.length,1);assert.equal(reads[0].method,'GET');assert.equal(reads[0].body,undefined);
 const denied=await post('/api/payment-status',{id:review.id,orderId:'OTHER90001'});assert.equal(denied.status,409);assert.equal(calls.filter(c=>c.method==='GET').length,1);
 const restored=await(await fetch(base+'/api/review?id='+review.id)).json();assert.equal(restored.status,'captured');
});

test('timed-out status lookup says unknown and does not capture',async()=>{
 const calls=[];
 const client=createPayPalClient({env:{PAYPAL_SANDBOX_CLIENT_ID:'AUTHORED_ID',PAYPAL_SANDBOX_CLIENT_SECRET:'AUTHORED_SECRET'},fetchImpl:async(url,req)=>{
  calls.push({url,method:req.method});assert.ok(req.signal);
  if(url.endsWith('/oauth2/token'))return {ok:true,json:async()=>({access_token:'AUTHORED_TOKEN',expires_in:300})};
  throw new DOMException('authored timeout','TimeoutError');
 }});
 await assert.rejects(client.getOrder(orderId),e=>e.status===504&&/remains unknown/.test(e.message));
 assert.equal(calls.at(-1).method,'GET');assert.equal(calls.some(c=>c.url.endsWith('/capture')),false);
});

test('validated noncaptured observations survive restart and failed refresh without another payment',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'consentcart-observation-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const stateFile=path.join(directory,'reviews.json');let app,base,failRead=false,reads=0,creates=0,clock=Date.now();
 const env={PAYPAL_SANDBOX_CLIENT_ID:'AUTHORED_ID',PAYPAL_SANDBOX_CLIENT_SECRET:'AUTHORED_SECRET'};
 const fetchImpl=async(url,request={})=>{
  if(url.endsWith('/oauth2/token'))return {ok:true,json:async()=>({access_token:'AUTHORED_TOKEN',expires_in:300})};
  if(url.endsWith('/orders')&&request.method==='POST'){creates++;return {ok:true,json:async()=>({id:orderId,links:[{rel:'approve',href:'https://www.sandbox.paypal.com/checkoutnow?token='+orderId}]})};}
  if(url.endsWith('/orders/'+orderId)&&request.method==='GET'){
   reads++;if(failRead)throw new Error('Authored provider outage');
   return {ok:true,json:async()=>({id:orderId,intent:'CAPTURE',status:'VOIDED',purchase_units:[{reference_id:'CONSENTCART',amount}]})};
  }
  throw Error('No capture or other provider request allowed');
 };
 async function start(){app=createApp({env,fetchImpl,stateFile,now:()=>clock});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}
 async function post(route,body){const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
 await start();
 const review=(await post('/api/source-review',{merchant:'Authored merchant',itemName:'Repair part',amountCents:4200,terms:'This repair part costs forty-two dollars including delivery. The customer can return an unused part within thirty days and pays return postage.'})).body;
 await post('/api/checkout',{id:review.id,digest:review.digest,consent:true,reviewedUnknowns:true});
 const checked=await post('/api/payment-status',{id:review.id,orderId});assert.equal(checked.body.paypalStatus,'VOIDED');assert.equal(checked.body.canCapture,false);assert.equal(checked.body.observedAt,clock);
 await new Promise(r=>app.server.close(r));clock+=60*60_000;await start();t.after(()=>new Promise(r=>app.server.close(r)));
 const returned=await(await fetch(base+'/api/review?id='+review.id)).json();
 assert.equal(returned.order.paypalStatus,'VOIDED');assert.equal(returned.order.observedAt,checked.body.observedAt);assert.equal(returned.order.canCapture,false);
 assert.equal(returned.offer.terms,review.offer.terms);assert.equal(returned.digest,review.digest);assert.equal(creates,1);assert.equal(reads,1);
 failRead=true;assert.equal((await post('/api/payment-status',{id:review.id,orderId})).status,500);
 const after=await(await fetch(base+'/api/review?id='+review.id)).json();assert.deepEqual(after.order,returned.order);assert.equal(creates,1);assert.equal(reads,2);
});

