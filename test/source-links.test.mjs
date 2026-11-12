import test from 'node:test';import assert from 'node:assert/strict';
import {sourceLinkParts,sourceTextHtml} from '../web/source-links.js';
test('source references retain exact visible text and only ordinary web destinations',()=>{
 const text='Read https://example.org/terms?a=1&b=2. Then https://example.org/Policy_(EU).';
 const parts=sourceLinkParts(text);assert.equal(parts.map(x=>x.text).join(''),text);
 assert.equal(parts.filter(x=>x.href).length,2);assert.equal(parts[1].href,'https://example.org/terms?a=1&b=2');
 assert.ok(sourceTextHtml(text).includes('a=1&amp;b=2'));
 assert.equal(sourceLinkParts('https://user:pass@example.org/private').some(x=>x.href),false);
 assert.equal(sourceLinkParts('file:///private javascript:void(0)').some(x=>x.href),false);
});
test('source markup remains inert while valid reference links are escaped',()=>{
 const html=sourceTextHtml('<img src=x> https://example.org/?q=<x> & original');
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('rel="noopener noreferrer"'));
});

import {termsFactRows} from '../web/terms-facts.js';
test('copied reference metadata does not become an extra merchant condition',()=>{const original='Returns within 30 days.';const withLink=original+'\n\nLinks in copied terms:\nRefund policy — https://example.org/refunds';assert.deepEqual(termsFactRows(withLink),termsFactRows(original));});
