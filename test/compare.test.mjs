import test from 'node:test';
import assert from 'node:assert/strict';
import {compareTerms, compareOffer} from '../web/compare.js';

test('added and removed refund obligations stay source-exact',()=>{
  const before='Returns within 30 days. Shipping is included. Contact support.';
  const after='ALL SALES ARE FINAL. Shipping is included. Contact support.';
  assert.deepEqual(compareTerms(before,after),{
    removed:['Returns within 30 days.'],added:['ALL SALES ARE FINAL.']
  });
});
test('repeated identical passages are counted rather than erased',()=>{
  assert.deepEqual(compareTerms('No refunds. No refunds.', 'No refunds.'),{
    removed:['No refunds.'],added:[]
  });
});
test('field changes cannot hide behind unchanged merchant prose',()=>{
  const base={merchant:'A',itemName:'Journal',amountCents:4800,terms:'No refunds.'};
  const diff=compareOffer(base,{...base,amountCents:6800,itemName:'Notebook'});
  assert.equal(diff.changed,true);
  assert.deepEqual(diff.fields.map(f=>f.key),['itemName','amountCents']);
});
test('unchanged source and fields do not announce an imaginary revision',()=>{
  const base={merchant:'A',itemName:'Journal',amountCents:4800,terms:'No refunds.'};
  assert.equal(compareOffer(base,{...base}).changed,false);
});
test('untrusted text is kept as plain data with no HTML markup rendering',()=>{
  const diff=compareTerms('Refunds allowed.', '<img src=x onerror=alert(1)>');
  assert.equal(diff.added[0],'<img src=x onerror=alert(1)>');
});
