import test from 'node:test';
import assert from 'node:assert/strict';
import {readingPassages} from '../web/source.js';
test('reading layout retains every original character and every condition',()=>{
 const quote='If you do not need forwarding, we will refund the last payment.\nYou must first finish downloading your data and changing logins. '.repeat(7)+'Refunds cover remaining whole months only.\n\nExceptions: tax refunds retain the address.';
 const parts=readingPassages(quote);
 assert.ok(parts.length>1);
 assert.equal(parts.join(''),quote);
 assert.ok(parts.every(p=>p.length>0));
});
test('reading layout preserves short, unpunctuated and non-Latin source',()=>{
 for(const quote of ['', 'No returns.','条件：返金は30日以内。\n送料はお客様負担です。','Return'.repeat(300),'A\tB\r\nC'])
  assert.equal(readingPassages(quote).join(''),quote);
});
