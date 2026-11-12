import test from 'node:test';
import assert from 'node:assert/strict';
import {readRecovery,writeRecovery,recoveryKey} from '../web/draft-recovery.js';
const memory=()=>{const rows=new Map();return {getItem:k=>rows.get(k),setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)}};
test('recovery keeps incomplete literal inputs and discards authority fields',()=>{
 const storage=memory(),draft={merchant:'Moss & Field',itemName:'',amount:'',terms:'Literal <reply> & source'};
 assert.equal(writeRecovery(storage,{...draft,orderId:'OTHER',consent:true}),true);
 assert.deepEqual(readRecovery(storage),draft);
 assert.equal(storage.getItem(recoveryKey).includes('orderId'),false);
});
test('storage failure or invalid new input keeps the last recoverable draft',()=>{
 const storage=memory(),draft={merchant:'',itemName:'',amount:'',terms:'Original'};
 writeRecovery(storage,draft);assert.equal(writeRecovery(storage,{...draft,terms:'x'.repeat(150001)}),false);
 assert.deepEqual(readRecovery(storage),draft);assert.equal(writeRecovery(undefined,draft),false);assert.equal(readRecovery(undefined),null);
 writeRecovery(storage,{merchant:'',itemName:'',amount:'',terms:''});assert.equal(readRecovery(storage),null);
});
