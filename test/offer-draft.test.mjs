import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeOfferDraft,readOfferDraft} from '../web/offer-draft.js';
test('unfinished offer survives without a completed review or price',()=>{
 const draft={merchant:'Northline & Pine',itemName:'',amount:'',terms:'Ask about blue panels.\nNeed the delivery date.'};
 assert.deepEqual(readOfferDraft(serializeOfferDraft(draft)),draft);
});
test('draft preserves literal input and drops every authority-bearing extra field',()=>{
 const draft={merchant:'Café <buyer>',itemName:'Wool panels',amount:'186.40',terms:'Literal &lt; and <script>example</script> — sample'};
 const record=JSON.parse(serializeOfferDraft({...draft,consent:true,order:{id:'OLD'}}));
 record.review={id:'OLD',digest:'OLD'};record.consent=true;record.draft.orderId='OLD';
 assert.deepEqual(readOfferDraft(JSON.stringify(record)),draft);
 assert.equal(serializeOfferDraft({...draft,consent:true}).includes('consent"'),false);
});
test('unfinished out-of-range numeric input remains editable, not approved',()=>{
 const draft={merchant:'',itemName:'',amount:'-2.50',terms:''};
 assert.deepEqual(readOfferDraft(serializeOfferDraft(draft)),draft);
});
test('unrelated, damaged and oversized draft inputs are rejected',()=>{
 assert.throws(()=>readOfferDraft('{}'),/not a supported/);
 assert.throws(()=>readOfferDraft('{'),/damaged/);
 assert.throws(()=>serializeOfferDraft({merchant:'a'.repeat(101),itemName:'',amount:'',terms:''}),/invalid merchant/);
 assert.throws(()=>serializeOfferDraft({merchant:'',itemName:'',amount:'not a price',terms:''}),/price/);
});
