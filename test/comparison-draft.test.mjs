import test from 'node:test';import assert from 'node:assert/strict';
import {comparisonDraft,writeComparisonDraft,readComparisonDraft,clearComparisonDraft} from '../web/comparison-draft.js';
const offer={merchant:'A',itemName:'B',amountCents:4117,terms:'All exact original terms.'};
const record={offer,buyerQuestions:[{text:'My question?',reason:'Original uncertainty',reply:'Seller response recorded by the buyer; condition still applies.',included:false}],order:{id:'must-not-survive'},analysis:{mode:'ai',facts:['not current']}};
test('comparison return retains exact offer/questions and strips payment or model authority',()=>{
 let raw;const storage={setItem:(k,v)=>raw=v,getItem:()=>raw,removeItem:()=>raw=null};
 assert.equal(writeComparisonDraft(storage,record,record),true);
 const restored=readComparisonDraft(storage);assert.deepEqual(restored.saved.offer,offer);assert.deepEqual(restored.saved.buyerQuestions,record.buyerQuestions);
 assert.equal(restored.saved.order,undefined);assert.equal(restored.saved.analysis.mode,'source');assert.deepEqual(restored.saved.analysis.facts,[]);
 assert.equal(clearComparisonDraft(storage),true);assert.equal(readComparisonDraft(storage),null);
});
test('invalid or unavailable storage cannot create a resumable purchase',()=>{
 assert.equal(comparisonDraft({version:2,saved:record,current:record}),null);
 assert.equal(comparisonDraft({version:1,saved:{...record,offer:{...offer,terms:'x'.repeat(150001)}},current:record}),null);
 assert.equal(readComparisonDraft({getItem(){throw Error('refused')}}),null);
 assert.equal(writeComparisonDraft({setItem(){throw Error('refused')}},record,record),false);
 assert.equal(clearComparisonDraft({removeItem(){throw Error('refused')}}),false);
});
