import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyTermHeadline} from '../web/term-qualifications.js';
const row=(id,value,text)=>({id,label:id,value,detail:'',caution:false,passages:[{text,start:0,end:text.length}]});
test('conditional seller-paid postage retains its exact qualification without an unconditional headline',()=>{
 for(const source of [
  'The seller pays return shipping for defective items only.',
  'The merchant pays return postage if the product arrives damaged.',
  'The seller pays return shipping unless the product was personalized.',
  'Free returns apply to damaged items only.'
 ]){
  const input=row('postage','seller pays',source),result=qualifyTermHeadline(input);
  assert.equal(result.value,'Read terms');assert.equal(result.detail,source);assert.equal(result.caution,true);
  assert.deepEqual(result.passages,input.passages);assert.equal(input.value,'seller pays');
 }
});
test('trial fee waivers and subscription requirements do not become No subscription',()=>{
 for(const source of [
  'No subscription fees are charged during the trial.',
  'No subscription costs apply for the first 3 months.',
  'No subscription is required to buy this product.',
  'The plan does not automatically renew unless you choose to continue.'
 ]){
  const result=qualifyTermHeadline(row('renewal','No subscription',source));
  assert.equal(result.value,'Read terms');assert.equal(result.detail,source);assert.equal(result.caution,true);
 }
});
test('unqualified source metrics and existing ambiguity remain available',()=>{
 assert.equal(qualifyTermHeadline(row('postage','seller pays','The seller pays return shipping.')).value,'seller pays');
 assert.equal(qualifyTermHeadline(row('renewal','No subscription','No subscription is included with this product.')).value,'No subscription');
 assert.equal(qualifyTermHeadline(row('renewal','every month','The plan renews every month.')).value,'every month');
 const ambiguous=row('postage','2 clauses','Seller pays only for defects.');ambiguous.caution=true;
 assert.equal(qualifyTermHeadline(ambiguous).value,'2 clauses');
});
