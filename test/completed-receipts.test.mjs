import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {normalizeOffer,digestOffer} from '../engine.mjs';

test('completed receipt survives expiry, export and restart without provider writes',async(t)=>{
 const dir=await mkdtemp(path.join(tmpdir(),'consentcart-completed-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const stateFile=path.join(dir,'reviews.json'),created=Date.now()-8*24*60*60_000;
 const id='eaa12345-1234-1234-1234-123456789abc';
 const offer=normalizeOffer({merchant:'Declared receipt fixture',itemName:'Journal',amountCents:100,terms:'This journal costs $1.00 once. There is no subscription. Returns are accepted within fourteen days.'});
 const record={created,offer,digest:digestOffer(offer),analysis:{mode:'source',facts:[],unknowns:[],questions:[]},status:'captured',captureId:'CAPTURETEST123',order:{id:'ORDERTEST123',approval:'https://www.sandbox.paypal.com/checkoutnow?token=ORDERTEST123'}};
 await writeFile(stateFile,JSON.stringify({version:1,sessions:[[id,record]]}),{mode:0o600});
 let calls=0;
 async function start(){
  const app=createApp({stateFile,env:{},fetchImpl:async()=>{calls++;throw Error('Receipt must not call provider')}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(()=>app.server.listening?new Promise(r=>app.server.close(r)):undefined);
  const base='http://127.0.0.1:'+app.server.address().port;
  return {app,base,post:async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}}};
 }
 const first=await start();
 const recovered=await(await fetch(first.base+'/api/review?id='+id)).json();
 assert.equal(recovered.status,'captured');assert.equal(recovered.captureId,record.captureId);
 assert.deepEqual(recovered.offer,{...offer,currency:'USD'});assert.equal(recovered.expiresAt,null);
 const exported=await fetch(first.base+'/api/review-record?id='+id);
 assert.equal(exported.status,200);
 const html=await exported.text();assert.ok(html.includes(record.captureId));assert.ok(html.replace(/<[^>]*>/g,'').includes(offer.terms));
 assert.equal((await first.post('/api/capture',{id,orderId:'WRONGORDER123'})).status,409);
 assert.equal((await first.post('/api/checkout',{id,digest:'changed',consent:true,reviewedUnknowns:true})).status,409);
 assert.equal((await first.post('/api/capture',{id,orderId:record.order.id})).data.captureId,record.captureId);
 assert.equal(first.app.sessions.get(id).created,created);
 await new Promise(r=>first.app.server.close(r));
 const second=await start();
 const again=await(await fetch(second.base+'/api/review?id='+id)).json();
 assert.deepEqual(again,recovered);
 assert.equal((await fetch(second.base+'/api/review-record?id='+id)).status,200);
 assert.equal(JSON.parse(await readFile(stateFile,'utf8')).sessions[0][1].created,created);
 assert.equal(calls,0);
});

test('a checked refund replaces the completed view and survives restart without another capture',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'consentcart-refunded-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const stateFile=path.join(dir,'reviews.json'),id='eaa12345-1234-1234-1234-123456789abc';
 const offer=normalizeOffer({merchant:'Declared refund fixture',itemName:'Journal',amountCents:4200,terms:'This journal costs $42 once. There is no subscription. Unused journals may be returned within fourteen days.'});
 const created=Date.now()-86400000;
 await writeFile(stateFile,JSON.stringify({version:1,sessions:[[id,{created,offer,digest:digestOffer(offer),analysis:{mode:'source',reviewMethod:'manual',facts:[]},status:'captured',captureId:'CAPTURETEST123',order:{id:'ORDERTEST123',approval:'https://www.sandbox.paypal.com/checkoutnow?token=ORDERTEST123'}}]]}),{mode:0o600});
 let app,base,reads=0,writes=0,fail=false,providerState='PARTIALLY_REFUNDED';
 const fetchImpl=async(url,req={})=>{
  if(url.endsWith('/token'))return {ok:true,json:async()=>({access_token:'TEST',expires_in:300})};
  if(req.method!=='GET'){writes++;throw Error('No payment writes allowed')}
  reads++;if(fail)throw Error('Authored unavailable status');
  return {ok:true,json:async()=>({id:'ORDERTEST123',intent:'CAPTURE',status:'COMPLETED',purchase_units:[{reference_id:'CONSENTCART',amount:{currency_code:'USD',value:'42.00'},payments:{captures:[{id:'CAPTURETEST123',status:providerState,amount:{currency_code:'USD',value:'42.00'}}]}}]})};
 };
 async function start(){app=createApp({stateFile,fetchImpl,env:{PAYPAL_SANDBOX_CLIENT_ID:'TEST',PAYPAL_SANDBOX_CLIENT_SECRET:'TEST'}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port}
 async function post(route){const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,orderId:'ORDERTEST123'})});return {status:r.status,body:await r.json()}}
 await start();t.after(()=>app.server.listening?new Promise(r=>app.server.close(r)):undefined);
 for(const [provider,status,copy] of [['PARTIALLY_REFUNDED','partially_refunded','partial refund'],['REFUNDED','refunded','as refunded']]){
  providerState=provider;const checked=await post('/api/payment-status');assert.equal(checked.body.status,status);
  const returned=await(await fetch(base+'/api/review?id='+id)).json();assert.equal(returned.status,status);assert.equal(returned.captureId,'CAPTURETEST123');assert.equal(returned.offer.terms,offer.terms);
  const html=await(await fetch(base+'/api/review-record?id='+id)).text();assert.ok(html.includes(copy));assert.ok(html.includes('Purchase receipt'));assert.ok(html.includes('CAPTURETEST123'));assert.ok(html.replace(/<[^>]*>/g,'').includes(offer.terms));assert.ok(!html.includes('capture confirmed'));
  assert.equal((await post('/api/capture')).status,409);
  await new Promise(r=>app.server.close(r));await start();
  const reopened=await(await fetch(base+'/api/review?id='+id)).json();assert.equal(reopened.status,status);assert.equal(reopened.order.observedAt,checked.body.observedAt);
 }
 fail=true;assert.equal((await post('/api/payment-status')).status,500);
 const kept=await(await fetch(base+'/api/review?id='+id)).json();assert.equal(kept.status,'refunded');assert.equal(kept.created,undefined);assert.equal(kept.expiresAt,null);
 assert.equal(reads,3);assert.equal(writes,0);
});
