import test from 'node:test';
import assert from 'node:assert/strict';
import {savedOfferMetadata,readSavedOffer} from '../web/saved-review.js';
import {renderReviewRecord} from '../review-record.mjs';
const offer={merchant:'Northline & Pine',itemName:'Made-to-order wool panels',amountCents:18640,currency:'USD',terms:'Custom wool panels in blue cost $186.40. Dispatch within ten days. Custom products are final sale except defects.\nAsk about clips & mounting.'};
const review={created:0,offer,analysis:{summary:'Inspect the source.',facts:[],unknowns:['Are clips included?'],questions:[],caution:'medium'},status:'captured',order:{id:'ORDER123',approval:'https://www.sandbox.paypal.com/private'},captureId:'CAPTURE123'};
test('new saved review reopens only exact offer, never checkout or analysis authority',()=>{
 const html=renderReviewRecord(review,1);
 assert.deepEqual(readSavedOffer(html),offer);
 assert.match(html,/consentcart-offer-v1/);
 assert.equal(readSavedOffer(html).order,undefined);
 assert.equal(readSavedOffer(html).analysis,undefined);
 assert.equal(readSavedOffer(html).consent,undefined);
});
test('already-saved earlier HTML files remain usable without metadata',()=>{
 const old=renderReviewRecord(review,1).replace(/<meta name="consentcart-offer-v1" content="[^"]*">/,'');
 assert.deepEqual(readSavedOffer(old),offer);
});
test('literal hostile text and Unicode round trip without rendering uploaded HTML',()=>{
 const source={...offer,merchant:'Café <img src=x>',terms:offer.terms+' Literal &lt; marker <script>alert(1)</script> — résumé.'};
 const html=renderReviewRecord({...review,offer:source},1);
 assert.deepEqual(readSavedOffer(html),source);
 assert.deepEqual(readSavedOffer(html.replace(/<meta name="consentcart-offer-v1" content="[^"]*">/,'')),source);
});
test('wrong file, incomplete old review and unsupported currency fail without inventing an offer',()=>{
 assert.throws(()=>readSavedOffer('<html>unrelated</html>'),/not a recognized/);
 assert.throws(()=>readSavedOffer('<title>ConsentCart purchase review</title>CONSENTCART / SAVED PURCHASE REVIEW'),/complete original offer/);
 assert.throws(()=>readSavedOffer(savedOfferMetadata({...offer,currency:'EUR'})),/USD/);
 assert.throws(()=>readSavedOffer('<meta name="consentcart-offer-v1" content="aaaa">'),/damaged/);
});

test('a deliberately selected original section survives saving without discarding other source',()=>{
 const terms='Month to month\n\nReturns are final after 14 days.\n\nAnnual contract, billed monthly\n\nCancellation Terms\n\nCancel after 14 days for a 50% charge. California customers pay 30%.';
 const original={...offer,terms},sourceSection={start:terms.indexOf('Annual contract'),heading:'Annual contract, billed monthly'};
 const html=renderReviewRecord({...review,offer:original,analysis:{mode:'source',reviewMethod:'manual',facts:[]},sourceSection},1);
 assert.deepEqual(readSavedOffer(html),{...original,sourceSection});
 assert.match(html,/Selected source section: Annual contract, billed monthly/);
 assert.match(html,/Month to month/);
 assert.throws(()=>savedOfferMetadata(original,[],{...sourceSection,start:sourceSection.start+1}),/reading section/);
 assert.throws(()=>savedOfferMetadata(original,[],{...sourceSection,heading:'Annual contract, prepaid'}),/reading section/);
 assert.equal(readSavedOffer(html).consent,undefined);
});
