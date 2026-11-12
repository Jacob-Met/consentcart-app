import test from 'node:test';import assert from 'node:assert/strict';import {combinedSourceContext} from '../web/clarification.js';
test('combining exact selected conditions retains distinct headings and all qualifiers',()=>{
 const general='Source heading: Returns\n\nOpened goods may be returned within 180 days with proof of purchase.';
 const exception='Source heading: Mattresses\n\nOne exchange within 90 days; no refund.';
 const joined=combinedSourceContext(general,exception);
 assert.ok(joined.startsWith(general));assert.ok(joined.endsWith(exception));assert.equal(combinedSourceContext(joined,exception),joined);
 assert.equal(combinedSourceContext(general,general),general);
});
test('same text from different source sections remains distinct',()=>{
 const a='Source heading: Annual prepaid\n\nNo refund after 14 days.';
 const b='Source heading: Monthly\n\nNo refund after 14 days.';
 assert.ok(combinedSourceContext(a,b).includes(a));assert.ok(combinedSourceContext(a,b).includes(b));
});
