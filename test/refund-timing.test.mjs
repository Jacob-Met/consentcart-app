import test from 'node:test';
import assert from 'node:assert/strict';
import {termsFactRows} from '../web/terms-facts.js';
// One exact sentence from Steam's refund policy, inspected on 11 November 2026.
// https://store.steampowered.com/steam_refunds/ — surrounding contrasts are authored.
const settlement='You will be issued a full refund of your purchase within a week of approval.';
test('refund arrival is not presented as the period for requesting it',()=>{
 const source='You may request a refund within 48 hours of renewal if unused. '+settlement;
 const rows=termsFactRows(source),returns=rows.find(r=>r.id==='returns'),timing=rows.find(r=>r.id==='refund-time');
 assert.equal(returns.value,'48 hours');assert.equal(returns.passages.length,1);
 assert.equal(timing.value,'a week');assert.equal(timing.detail,settlement);
 assert.equal(source.slice(timing.passages[0].start,timing.passages[0].end).trim(),settlement);
});
test('request deadlines do not become refund arrival times',()=>{
 for(const source of ['The seller will issue a refund if your request is made within 14 days.', 'Within the applicable time frame and process identified in the hardware refund policy, you may request a refund.', 'Request your refund within 14 days.','Refund requests must arrive within 7 days.','You may receive a refund if you request it within 30 days.']){
  assert.equal(termsFactRows(source).some(r=>r.id==='refund-time'),false,source);
 }
});
test('explicit settlement variants keep their source qualification',()=>{
 for(const source of ['Refunds are processed within five business days.','You will receive your refund within 10 days after approval.','Refunds will be credited within 3 days.','Our refund-processing time is not specified.']){
  const row=termsFactRows(source).find(r=>r.id==='refund-time');assert.ok(row,source);assert.equal(row.detail,source);
 }
});

test('the browser can load the refund timing dependency',async()=>{
 const {createApp}=await import('../server.mjs');const app=createApp({env:{}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/refund-timing.js');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);assert.match(await response.text(),/export function isRefundTiming/)}finally{await new Promise(r=>app.server.close(r))}
});
