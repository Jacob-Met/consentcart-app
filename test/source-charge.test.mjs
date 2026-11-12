import test from 'node:test';import assert from 'node:assert/strict';
import {calculateSourceCharge,sourceChargeQuestion,sourcePercentages} from '../web/source-charge.js';
test('remaining obligation and full commitment stay different explicit bases',()=>{
 const remaining=calculateSourceCharge({amount:'19.99',count:'8',percent:'50',base:'remaining'});
 assert.equal(remaining.totalCents,15992);assert.equal(remaining.chargeCents,7996);
 const annual=calculateSourceCharge({amount:'19.99',count:'12',percent:'30',base:'commitment'});
 assert.equal(annual.totalCents,23988);assert.equal(annual.chargeCents,7196);
 assert.match(sourceChargeQuestion(remaining),/8 remaining payments/);
 assert.match(sourceChargeQuestion(annual),/12 payments in the full commitment/);
 assert.match(sourceChargeQuestion(annual),/Does this percentage and base apply/);
});
test('ordinary merchant worked example is calculated from buyer inputs',()=>{
 const example=calculateSourceCharge({amount:'69.99',count:'3',percent:'50',base:'remaining'});
 assert.equal(example.chargeCents,10499);
 assert.equal(calculateSourceCharge({amount:'69.99',count:'0',percent:'50',base:'remaining'}).chargeCents,0);
 assert.equal(calculateSourceCharge({amount:'0.01',count:'1',percent:'50',base:'amount'}).chargeCents,1);
});
test('no implicit percentage, base, amount or remaining period',()=>{
 const valid={amount:'19.99',count:'8',percent:'50',base:'remaining'};
 for(const field of Object.keys(valid))assert.throws(()=>calculateSourceCharge({...valid,[field]:''}));
 for(const count of ['-1','1.5','1e2','1201'])assert.throws(()=>calculateSourceCharge({...valid,count}));
 for(const amount of ['-2','1,000','1e2','0.001','Infinity'])assert.throws(()=>calculateSourceCharge({...valid,amount}));
 for(const percent of ['101','-1','50.001'])assert.throws(()=>calculateSourceCharge({...valid,percent}));
 assert.throws(()=>calculateSourceCharge({...valid,base:'commitment',count:'0'}));
});
test('source percentage choices do not select applicability or read a topic as evidence',()=>{
 assert.deepEqual(sourcePercentages('50% of remaining obligation. California: 30% of annual commitment. Another 50% reference.'),[50,30]);
 assert.deepEqual(sourcePercentages('Topic to clarify: is the fee 50%?'),[]);
 assert.deepEqual(sourcePercentages('No percentage is provided.'),[]);
});
