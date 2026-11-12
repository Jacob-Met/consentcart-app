import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceSelectionRequest,validateSourceSelection,sourcePassages} from '../source-selection.mjs';
import {renderReviewRecord} from '../review-record.mjs';
const offer={merchant:'Example seller',itemName:'Annual service',amountCents:9900,currency:'USD',terms:'Refund eligibility requires ending account access and forwarding. Refunds cover whole unused months. The address is then recycled. Future invoices stop after cancellation.'};
test('schema selection preserves adjacent conditions and never emits generated implications',()=>{
 const request=sourceSelectionRequest(offer);
 const result=validateSourceSelection({passageIds:[2],meaning:'Unconditional refunds guaranteed',questions:['Invented question']},offer,request);
 assert.equal(result.facts.length,1);
 assert.equal(result.facts[0].quote,'Refund eligibility requires ending account access and forwarding. Refunds cover whole unused months. The address is then recycled.');
 assert.equal(result.facts[0].meaning,undefined);assert.deepEqual(result.questions,[]);
 const html=renderReviewRecord({offer,analysis:result,status:'review',created:0});
 assert.match(html,/ending account access and forwarding/);
 assert.doesNotMatch(html,/Unconditional refunds guaranteed|AI interpretation|Invented question|Questions for the merchant/);
});
test('overlapping context merges without inventing text; invalid and repeated IDs cannot add claims',()=>{
 const request=sourceSelectionRequest(offer);
 const result=validateSourceSelection({passageIds:[2,3,3,999,'2']},offer,request);
 assert.equal(result.facts.length,1);assert.equal(result.facts[0].quote,offer.terms);
 assert.equal(result.selectedPassages,2);assert.equal(result.rejectedClaims,2);
});
test('structured response limits choices to original eligible source locations',()=>{
 const request=sourceSelectionRequest(offer),schema=request.body.response_format.json_schema.schema;
 assert.equal(request.body.response_format.type,'json_schema');
 assert.equal(schema.properties.passageIds.maxItems,8);
 assert.deepEqual(schema.properties.passageIds.items.enum,request.ids);
 assert.ok(request.passages.every(p=>p.text===offer.terms.slice(p.start,p.end)));
 assert.throws(()=>validateSourceSelection({facts:[]},offer,request),/source selections/);
});
test('long source clauses are split exactly with no dropped nonwhitespace characters',()=>{
 const source='The following conditions govern this purchase: '+('individual condition '.repeat(60));
 const parts=sourcePassages(source);
 assert.ok(parts.every(p=>p.text.length<=360&&p.text===source.slice(p.start,p.end)));
 assert.equal(parts.map(p=>p.text).join('').replace(/\s/g,''),source.replace(/\s/g,''));
});
