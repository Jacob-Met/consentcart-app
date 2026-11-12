import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayPalClient} from '../engine.mjs';
const standard={PAYPAL_CLIENT_ID:'standard-id',PAYPAL_CLIENT_SECRET:'standard-secret',PAYPAL_BASE_URL:'https://api-m.sandbox.paypal.com'};
test('maintained credentials require the exact sandbox base and a complete pair',()=>{
 assert.equal(createPayPalClient({env:standard}).configured,true);
 for(const PAYPAL_BASE_URL of ['',undefined,'https://api-m.paypal.com','https://api-m.sandbox.paypal.com.evil.invalid','http://api-m.sandbox.paypal.com','https://api-m.sandbox.paypal.com/']){
  assert.equal(createPayPalClient({env:{...standard,PAYPAL_BASE_URL}}).configured,false);
 }
 assert.equal(createPayPalClient({env:{...standard,PAYPAL_CLIENT_SECRET:''}}).configured,false);
 assert.equal(createPayPalClient({env:{...standard,PAYPAL_CLIENT_ID:''}}).configured,false);
});
test('explicit sandbox credentials never mix with a maintained pair',async()=>{
 assert.equal(createPayPalClient({env:{...standard,PAYPAL_SANDBOX_CLIENT_ID:'explicit'}}).configured,false);
 assert.equal(createPayPalClient({env:{...standard,PAYPAL_SANDBOX_CLIENT_SECRET:'explicit'}}).configured,false);
 const calls=[];
 const client=createPayPalClient({env:{...standard,PAYPAL_SANDBOX_CLIENT_ID:'explicit-id',PAYPAL_SANDBOX_CLIENT_SECRET:'explicit-secret'},fetchImpl:async(url,request)=>{
  calls.push({url,request});
  return {ok:true,json:async()=>url.endsWith('/token')?{access_token:'fixture-token',expires_in:300}:{id:'ORDER1234'}};
 }});
 await client.getOrder('ORDER1234');
 assert.equal(calls[0].request.headers.Authorization,'Basic '+Buffer.from('explicit-id:explicit-secret').toString('base64'));
 assert.ok(calls.every(c=>c.url.startsWith('https://api-m.sandbox.paypal.com/')));
});
test('maintained configuration makes only hardcoded sandbox requests',async()=>{
 const calls=[];
 const client=createPayPalClient({env:standard,fetchImpl:async(url,request)=>{
  calls.push({url,request});
  return {ok:true,json:async()=>url.endsWith('/token')?{access_token:'fixture-token',expires_in:300}:{id:'ORDER1234'}};
 }});
 await client.getOrder('ORDER1234');
 assert.equal(calls[0].request.headers.Authorization,'Basic '+Buffer.from('standard-id:standard-secret').toString('base64'));
 assert.deepEqual(calls.map(c=>c.url),['https://api-m.sandbox.paypal.com/v1/oauth2/token','https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER1234']);
});
