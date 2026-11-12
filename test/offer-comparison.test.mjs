import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonSnapshot,priceDifference,compareOriginalTerms} from '../web/offer-comparison.js';
test('kept offer detaches text and contains no checkout identifiers',()=>{
 const original={id:'bearer',digest:'digest',order:{approval:'private'},offer:{merchant:'Moss',itemName:'Journal',amountCents:4117,terms:'Original'},analysis:{facts:[{quote:'Original'}],unknowns:[],questions:[]}};
 const kept=comparisonSnapshot(original);original.offer.terms='Changed';original.analysis.facts[0].quote='Changed';
 assert.equal(kept.offer.terms,'Original');assert.equal(kept.analysis.facts[0].quote,'Original');assert.equal(kept.id,undefined);assert.equal(kept.order,undefined);
 assert.equal(priceDifference(kept,{offer:{amountCents:3503}}),-614);
});

test('complete comparison retains unselected exceptions and every source character',()=>{
 const a='Delivery takes 3 days. Returns within 30 days. Cash payments are excluded.\nThe buyer pays return postage.';
 const b='Delivery takes 3 days. Returns within 14 days. Cash payments are excluded.\nThe seller pays return postage.';
 const rows=compareOriginalTerms(a,b);
 assert.equal(rows.map(r=>r.kept).join(''),a);assert.equal(rows.map(r=>r.current).join(''),b);
 assert.equal(rows.filter(r=>r.changed).length,2);
 assert.ok(rows.some(r=>!r.changed&&r.kept.includes('Cash payments')));
});
test('repeated and reordered conditions are preserved on both sides',()=>{
 for(const [a,b] of [['A condition. A condition. Final exception.','A condition. Final exception. A condition.'],['','Only one source.'],['Same terms.\n','Same terms. '],['A <script>word</script>.','Changed <script>word</script>.']]){
  const rows=compareOriginalTerms(a,b);assert.equal(rows.map(r=>r.kept).join(''),a);assert.equal(rows.map(r=>r.current).join(''),b);
 }
});

test('incomplete and invalid prices never become a claimed saving',()=>{
 for(const amountCents of [0,-1,NaN,Infinity,undefined,1000001,1.5]){
  const invalid={offer:{amountCents}},valid={offer:{amountCents:3503}};
  assert.equal(priceDifference(invalid,valid),null);assert.equal(priceDifference(valid,invalid),null);
 }
 assert.equal(priceDifference({offer:{amountCents:3503}},{offer:{amountCents:3503}}),0);
});

test('kept question edits and unresolved reasons stay with their own detached offer',()=>{
 const questions=[{text:'Will return postage be covered?',reason:'Return address and postage are unstated'}];
 const original={offer:{merchant:'A',itemName:'Notebook',amountCents:4117,terms:'Original terms'},analysis:{facts:[],unknowns:[],questions:[]}};
 const kept=comparisonSnapshot(original,questions);
 questions[0].text='Question for a different merchant';
 assert.equal(kept.buyerQuestions[0].text,'Will return postage be covered?');
 assert.equal(kept.buyerQuestions[0].reason,'Return address and postage are unstated');
 assert.equal(comparisonSnapshot(kept).buyerQuestions[0].text,'Will return postage be covered?');
});

test('same complete source compares the deliberately chosen plan sections and keeps full offsets',async()=>{
 const {comparisonTopics,pairedConditionGroups}=await import('../web/comparison-topics.js');
 const {comparisonDraft}=await import('../web/comparison-draft.js');
 const terms='Month to month\n\nCancellation Terms\n\nCancel after 14 days and payments are non-refundable.\n\nAnnual contract, billed monthly\n\nCancellation Terms\n\nCancel after 14 days for a 50% charge. California customers pay 30%.';
 const section=heading=>({start:terms.indexOf(heading),heading}),annual=section('Annual contract, billed monthly'),monthly=section('Month to month');
 const offer={merchant:'Adobe',itemName:'Annual plan',amountCents:1999,terms};
 const left=comparisonSnapshot({offer,sourceSection:annual,analysis:{mode:'source'}});
 const right=comparisonSnapshot({offer:{...offer,itemName:'Monthly plan'},sourceSection:monthly,analysis:{mode:'source'}});
 const restored=comparisonDraft({version:1,saved:left,current:right});
 assert.deepEqual(restored.saved.sourceSection,annual);assert.deepEqual(restored.current.sourceSection,monthly);assert.equal(restored.saved.offer.terms,terms);
 const topics=comparisonTopics(terms,terms,annual,monthly),row=topics.find(t=>t.id==='cancellation'),groups=pairedConditionGroups(row);
 assert.ok(groups.kept.some(e=>e.text.includes('California')));assert.ok(groups.current.some(e=>e.text.includes('non-refundable')));assert.equal(groups.shared.length,0);
 for(const side of ['kept','current'])for(const e of groups[side])for(const range of e.passages)assert.equal(terms.slice(range.start,range.end),e.text);
 assert.equal(comparisonDraft({version:1,saved:{...left,sourceSection:{...annual,start:0}},current:right}),null);
});
