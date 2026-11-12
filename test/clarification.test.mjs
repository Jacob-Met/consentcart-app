import test from 'node:test';
import assert from 'node:assert/strict';
import {clarificationQuestions,merchantMessage,buyerSituationQuestion,buyerSituationDetails,sourceGlance,writeQuestionDraft,readBuyerSituation} from '../web/clarification.js';

test('a detected return conflict becomes an answerable merchant question even if model asks none',()=>{
 const rows=clarificationQuestions({unknowns:['Potential conflict: the merchant text allows returns/refunds and also states a final-sale or no-refund restriction. Ask which policy controls.'],questions:[]});
 assert.equal(rows.length,1);assert.match(rows[0].text,/Which return policy applies/);
 assert.match(rows[0].text,/return window.*final-sale restriction/);
 assert.match(rows[0].reason,/Potential conflict/);
});

test('refund timing and delivery gaps become distinct concrete questions, retaining original uncertainty',()=>{
 const rows=clarificationQuestions({unknowns:['No refunds processing time provided','Delivery date missing'],questions:[]});
 assert.equal(rows.length,2);assert.match(rows[0].text,/when will you issue it/);
 assert.equal(rows[0].reason,'No refunds processing time provided');
 assert.match(rows[1].text,/dispatched and delivered/);
});

test('unsupported topics stay questions and suggestions are deduplicated without inventing an answer',()=>{
 const rows=clarificationQuestions({unknowns:['Environmental certification is not stated'],questions:['Is packaging recyclable?','  Is packaging recyclable?  ']});
 assert.equal(rows.length,2);
 assert.equal(rows[0].text,'Please clarify this point for this item: Environmental certification is not stated');
 assert.equal(rows[1].origin,'ai');
 assert.deepEqual(clarificationQuestions({unknowns:[],questions:[]}),[]);
});

test('message preserves selected text and exact offer while excluding payment and review handles',()=>{
 const offer={merchant:'Ridge & Field',itemName:'Trail camera',amountCents:12940,currency:'USD',terms:'Line one\nLine two <script>literal source</script>',id:'DO-NOT-EXPORT',approval:'SECRET-LINK'};
 const message=merchantMessage(offer,['Where do I send a return?','  ','My edited question']);
 assert.match(message,/Trail camera.*129.40 USD/);
 assert.match(message,/1\. Where do I send a return\?\n2\. My edited question/);
 assert.ok(message.endsWith(offer.terms));assert.doesNotMatch(message,/DO-NOT-EXPORT|SECRET-LINK/);
 assert.match(message,/does not place or change an order/);assert.equal(merchantMessage(offer,[]),'');
});

test('unfamiliar custom-panel review avoids duplicate dispatch and clips while separating damage eligibility from replacement',()=>{
 const unknowns=['Which dispatch promise applies to these custom colors?','Are the pictured installation clips included?','Whether a panel damaged in delivery is exempt from final-sale language.'];
 const questions=['When will these custom-color panels dispatch?','Are installation clips included in the $186.40 total?','How do I obtain a replacement for transit damage?'];
 const rows=clarificationQuestions({unknowns,questions});
 assert.equal(rows.length,4);
 assert.equal(rows[0].text,questions[0]);assert.equal(rows[0].reason,unknowns[0]);
 assert.equal(rows[1].text,questions[1]);assert.equal(rows[1].reason,unknowns[1]);
 assert.match(rows[2].text,/final-sale restriction apply/);assert.equal(rows[2].reason,unknowns[2]);
 assert.equal(rows[3].text,questions[2]);
});

test('refund timing can use a specific model question without merging an eligibility question',()=>{
 const rows=clarificationQuestions({unknowns:['No refund-processing time provided','Return eligibility for opened goods is unspecified'],questions:['How long will a refund take?','Are opened items eligible for a return?']});
 assert.equal(rows.length,2);assert.equal(rows[0].text,'How long will a refund take?');
 assert.equal(rows[1].text,'Are opened items eligible for a return?');
 assert.match(rows[1].reason,/eligibility/);
});

test('a matched question retains the exact deadline uncertainty in the outgoing message',()=>{
 const reason='Which return deadline applies to custom items?';
 const rows=clarificationQuestions({unknowns:[reason],questions:['Can I return damaged custom items after installation?']});
 const message=merchantMessage({merchant:'Maker',itemName:'Panel',amountCents:1000,terms:'Exact source'},rows);
 assert.match(message,/Please also address this point from my review: Which return deadline applies to custom items/);
 assert.match(message,/Can I return damaged custom items after installation/);
});

test('a shorter timing suggestion cannot remove an expired-card condition from the outgoing message',()=>{
 const reason='How long does a refund take when the original payment card has expired?';
 const rows=clarificationQuestions({unknowns:[reason],questions:['How long does a refund take?']});
 const message=merchantMessage({merchant:'Maker',itemName:'Panel',amountCents:1000,terms:'Exact source'},rows);
 assert.ok(message.includes(reason));
 assert.match(message,/1. How long does a refund take/);
});

test('buyer-specific circumstance travels with exact terms without asserting eligibility',()=>{
 const offer={merchant:'Moss & Field',itemName:'Field notebook',amountCents:4117,currency:'USD',terms:'Returns within 30 days. Personalized items are excluded unless defective.'};
 const facts='Bought through a reseller on 1 November. The personalized cover arrived damaged on 6 November.';
 const question=buyerSituationQuestion(facts);
 assert.match(question.reason,/not independently verified/);
 assert.equal(buyerSituationDetails(question),facts);
 assert.equal(buyerSituationDetails({text:question.text,reason:'Original conditions: '+facts}),null);
 assert.equal(buyerSituationDetails({text:'Unrelated question',reason:question.reason}),null);
 const message=merchantMessage(offer,[question,{text:'Does the exception cover a damaged cover?',reason:offer.terms}]);
 assert.match(message,/reseller on 1 November/);
 assert.match(message,/My situation \(as I reported it, not independently verified\):/);
 assert.match(message,/which of the original conditions applies to my situation/);
 assert.match(message,/unless defective/);
 assert.ok(message.endsWith(offer.terms));
 assert.doesNotMatch(message,/I am entitled|a refund is owed/);
 assert.equal(buyerSituationQuestion('   '),null);
});
test('buyer situation draft is tied to this exact offer and rejects oversized details',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const a='a'.repeat(64),b='b'.repeat(64);
 assert.equal(writeQuestionDraft(storage,a,'',[],[],'','Bought direct on 4 November'),true);
 assert.equal(readBuyerSituation(storage,a),'Bought direct on 4 November');
 assert.equal(readBuyerSituation(storage,b),'');
 assert.equal(writeQuestionDraft(storage,a,'',[],[],'','x'.repeat(3001)),false);
 assert.equal(readBuyerSituation(storage,a),'Bought direct on 4 November');
});

test('an adjacent source condition stays readable as a quote, not an eligibility verdict',()=>{
 const selected='Source page: merchant terms\n\nReturns within 30 days of delivery. Personalized covers are excluded unless defective.';
 const glance=sourceGlance(selected);
 assert.match(glance,/Provided terms · Returns within 30 days/);
 assert.match(glance,/excluded unless defective/);
 assert.doesNotMatch(glance,/approved|entitled|eligible/);
});
