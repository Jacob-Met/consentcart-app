import test from 'node:test';import assert from 'node:assert/strict';import {comparedSourceQuestion,selectedConditionGlances,selectedConditionRange} from '../web/clarification.js';
const first='Cancellation occurs immediately.',second='Your subscription will cancel at the end of your current billing period — you will not be charged again.';
const source=first+'\n\nAdditional source: https://merchant.example/help\n\n'+second+'\n\nLinks in copied terms:\nOriginal merchant page — https://merchant.example/terms\nOriginal merchant page — https://merchant.example/help';
const range=text=>({start:source.indexOf(text),end:source.indexOf(text)+text.length,text});
test('one question carries both distinct original conditions without asserting a resolution',()=>{
 const q=comparedSourceQuestion(source,[range(first),range(second)],'Cancellation');
 assert.ok(q.text.includes('when cancellation takes effect'));assert.ok(q.text.includes('which of the attached original conditions apply'));
 for(const text of [first,second,'Source page: https://merchant.example/terms','Source page: https://merchant.example/help'])assert.ok(q.reason.includes(text));
 assert.ok(!q.text.includes('immediately')&&!q.text.includes('billing period'));
});
test('a stale or misleading selected interval cannot enter the question',()=>{
 assert.equal(comparedSourceQuestion(source,[{...range(first),text:second}],'Cancellation'),null);
 assert.equal(comparedSourceQuestion(source,[{...range(first),start:-1}],'Cancellation'),null);
 assert.equal(comparedSourceQuestion(source,[],'Cancellation'),null);
});
test('duplicate selection is deduplicated while original distinct source occurrences remain',()=>{
 const q=comparedSourceQuestion(source,[range(first),range(first),range(second)],'Cancellation');
 assert.equal(q.reason.split(first).length-1,1);assert.equal(q.reason.split('Additional selected condition:').length-1,1);
});

test('all independently sourced conditions remain visible beside their page and plan headings',()=>{
 const q=comparedSourceQuestion(source,[range(first),range(second)],'Cancellation');
 const visible=selectedConditionGlances(q.reason);
 assert.equal(visible.length,2);
 assert.ok(visible[0].text.includes('Cancellation occurs immediately.')||visible[0].text.includes(first));
 assert.ok(visible[1].text.includes('subscription will cancel at the end of your current billing period')||visible[1].text===second);
 assert.ok(visible[0].heading==='');
 assert.ok(visible[1].heading==='');
 const more=selectedConditionGlances('Source heading: Annual\n\nNo refund.\n\nAdditional selected condition:\nSource heading: Monthly\n\nRefund within 14 days.');
 assert.deepEqual(more.map(r=>r.heading),['Annual','Monthly']);
 assert.deepEqual(more.map(r=>r.text),['No refund.','Refund within 14 days.']);
});

test('each comparison points at its exact original source occurrence',()=>{
 const q=comparedSourceQuestion(source,[range(first),range(second)],'Cancellation');
 assert.deepEqual(selectedConditionGlances(q.reason,q.text,source).map(x=>x.range),[range(first),range(second)].map(({start,end})=>({start,end})));
 const repeated='No refunds.\n\nNo refunds.';
 assert.deepEqual(selectedConditionRange(repeated,'Source occurrence: 2 of 2\n\nNo refunds.'),{start:13,end:24});
 assert.equal(selectedConditionRange(repeated,'No refunds.'),null);
 assert.equal(selectedConditionRange(source,'Source page: https://merchant.example/help\n\n'+first),null);
 assert.equal(selectedConditionRange(source,'This source text was not in the original'),null);
});
