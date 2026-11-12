import test from 'node:test';
import assert from 'node:assert/strict';
import {searchSourcePassages,sourceReadingBlocks} from '../web/source.js';
import {readQuestionDraft,writeQuestionDraft,merchantMessage} from '../web/clarification.js';
test('favorable model selection cannot remove the neighboring refund exclusion from source search',()=>{
 const source='Refunds are available within 30 days. However, cryptocurrency payments are nonrefundable. Purchases made through Apple must be refunded through Apple, not this merchant.';
 const blocks=sourceReadingBlocks(source,[{quote:'Refunds are available within 30 days.'}]);
 assert.equal(blocks.flatMap(b=>b.parts.map(p=>p.text)).join(''),source);
 const result=searchSourcePassages(source,'refund');
 assert.equal(result.length,1);assert.equal(result[0].text,source);
 assert.ok(result[0].text.includes('cryptocurrency payments are nonrefundable'));
 assert.equal(source.slice(result[0].start,result[0].end),source);
 assert.equal(searchSourcePassages(source,'guaranteed').length,0);
});
test('literal source navigation retains later matches beyond eight results and treats metacharacters literally',()=>{
 const source=Array.from({length:14},(_,i)=>'Condition '+i+': refund [special] applies only to this channel. '+'Other context remains available. '.repeat(15)).join('\n');
 const results=searchSourcePassages(source,'[special]');
 assert.ok(results.length>8);assert.ok(results.some(r=>r.text.includes('Condition 13:')));
 for(const r of results)assert.equal(source.slice(r.start,r.end),r.text);
 assert.equal(searchSourcePassages(source,'.*').length,0);
});
test('case-insensitive search offsets preserve original unicode',()=>{
 const source='İstanbul purchases have a separate rule. REFUND conditions apply after review.';
 const result=searchSourcePassages(source,'refund')[0];
 assert.equal(source.slice(result.start,result.end),result.text);assert.equal(result.text,source);
 assert.equal(source.slice(result.matchStart,result.matchEnd),'REFUND');
});
test('buyer draft returns only for its exact purchase digest and handles storage refusal',()=>{
 const values=new Map();const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 const a='a'.repeat(64),b='b'.repeat(64);
 assert.equal(writeQuestionDraft(storage,a,'Does this cryptocurrency exclusion apply to this purchase?'),true);
 assert.equal(readQuestionDraft(storage,a),'Does this cryptocurrency exclusion apply to this purchase?');
 assert.equal(readQuestionDraft(storage,b),'');
 assert.equal(writeQuestionDraft(storage,b,'Different price and source'),true);
 assert.equal(readQuestionDraft(storage,a),'Does this cryptocurrency exclusion apply to this purchase?');
 assert.equal(writeQuestionDraft(storage,a,''),true);assert.equal(readQuestionDraft(storage,a),'');
 const denied={getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}};
 assert.equal(readQuestionDraft(denied,b),'');assert.equal(writeQuestionDraft(denied,b,'text'),false);
});
test('merchant question keeps adverse wording and complete source without asserting eligibility',()=>{
 const terms='Refunds within 30 days. Cryptocurrency payments are excluded.';
 const question='Please clarify how this condition applies to this purchase:\n“'+terms+'”';
 const message=merchantMessage({merchant:'Example',itemName:'Membership',amountCents:1900,currency:'USD',terms},[question]);
 assert.ok(message.includes(question));assert.ok(message.endsWith(terms));
 assert.ok(message.includes('19.00 USD'));assert.ok(message.includes('does not place or change an order'));
});

test('a neighboring adverse qualification across a reading boundary travels with the matched condition',()=>{
 const first='Refunds may be requested within 30 days '+('after carefully reviewing the purchase details '.repeat(12))+'. ';
 const source=first+'However, payments through a reseller must be requested from that reseller, and cryptocurrency is excluded.';
 const result=searchSourcePassages(source,'Refunds')[0];
 assert.ok(result.text.includes('cryptocurrency is excluded'));
 assert.ok(result.text.includes('reseller must be requested'));
 assert.equal(source.slice(result.start,result.end),result.text);
});

test('the search marker points at the literal word inside a long reading passage',()=>{const source='A favorable promise. '.repeat(8)+'Cryptocurrency payments are excluded.';const [hit]=searchSourcePassages(source,'crypto');assert.equal(source.slice(hit.matchStart,hit.matchStart+6),'Crypto');});

test('a search after unrelated text highlights the literal match rather than the context start',()=>{
 const source='Field notebook costs $41.17 including delivery. Returns are accepted within 30 days. Refund processing time is not specified.';
 const hit=searchSourcePassages(source,'refund')[0];
 assert.equal(source.slice(hit.matchStart,hit.matchEnd),'Refund');
 assert.equal(hit.matchStart,source.indexOf('Refund'));
 assert.equal(source.slice(hit.start,hit.end),hit.text);
 const literal=searchSourcePassages('A policy [special] condition applies.','[special]')[0];
 assert.equal('A policy [special] condition applies.'.slice(literal.matchStart,literal.matchEnd),'[special]');
});
