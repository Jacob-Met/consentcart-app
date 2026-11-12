import test from 'node:test';
import assert from 'node:assert/strict';
import {addMerchantPage} from '../web/source-import.js';
import {policyTextBeforeCopiedLinks} from '../web/source-links.js';
import {MAX_SOURCE_CHARACTERS} from '../web/offer-limits.js';
const marker='\n\nLinks in copied terms:\n';
const original='Your subscription renews monthly. Export your data before deleting your account.';
const added='The trial requires a card. Full analytics history while subscribed.';
const page={text:added,url:'https://merchant.example/pricing',terms:added+marker+'Original merchant page — https://merchant.example/pricing'};
test('related merchant page preserves both complete source bodies and both original addresses',()=>{
 const first=original+marker+'Original merchant page — https://merchant.example/terms';
 const result=addMerchantPage(first,page),body=policyTextBeforeCopiedLinks(result);
 assert.ok(body.startsWith(original));assert.ok(body.includes(added));assert.ok(body.includes('Additional source: https://merchant.example/pricing'));
 assert.ok(result.includes('Original merchant page — https://merchant.example/terms'));assert.ok(result.includes('Original merchant page — https://merchant.example/pricing'));
 assert.equal(result.split(marker).length,2);
 assert.equal(first,original+marker+'Original merchant page — https://merchant.example/terms');
});
test('adding a related page never cuts arbitrary user text that resembles source metadata',()=>{
 const first=original+marker+'These are my notes, not reference metadata.';
 assert.ok(policyTextBeforeCopiedLinks(addMerchantPage(first,page)).startsWith(first));
});
test('duplicate and over-limit related pages are rejected without partial results',()=>{
 const first=addMerchantPage(original,page);assert.throws(()=>addMerchantPage(first,page),/already/);
 assert.throws(()=>addMerchantPage('x'.repeat(MAX_SOURCE_CHARACTERS-10),page),/exceed/);
});
test('an empty purchase adopts the complete page without an extra source heading',()=>assert.equal(addMerchantPage('',page),page.terms));
