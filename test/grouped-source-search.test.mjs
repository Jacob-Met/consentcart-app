import test from 'node:test';
import assert from 'node:assert/strict';
import {searchSourcePassages,groupedSourceSearch} from '../web/source.js';
test('overlapping context reads once with every literal hit and adverse qualifier retained',()=>{
 const source=('Refunds are available for unopened purchases. '+'Only original payment methods qualify. '.repeat(7)+'Opened purchases are not refundable. ').repeat(4);
 const old=searchSourcePassages(source,'refund'),groups=groupedSourceSearch(source,'refund');
 assert.ok(groups.length<old.length);
 assert.ok(groups.reduce((n,x)=>n+x.text.length,0)<old.reduce((n,x)=>n+x.text.length,0));
 for(const hit of old)assert.ok(groups.some(g=>g.start<=hit.start&&g.end>=hit.end));
 assert.equal(groups.flatMap(g=>g.matchRanges).length,[...source.matchAll(/refund/gi)].length);
 for(const group of groups){assert.equal(group.text,source.slice(group.start,group.end));for(const r of group.matchRanges)assert.match(source.slice(r.start,r.end),/^refund$/i);}
});
test('distant conditions remain separate and literal metacharacters stay literal',()=>{
 const source='A [special] refund condition applies. '+('Unrelated delivery text remains available. '.repeat(100))+'A second [special] condition applies.';
 const groups=groupedSourceSearch(source,'[special]');assert.equal(groups.length,2);assert.equal(groups.flatMap(g=>g.matchRanges).length,2);
 assert.deepEqual(groupedSourceSearch(source,'.*'),[]);assert.deepEqual(groupedSourceSearch(source,''),[]);
});
