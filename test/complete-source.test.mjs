import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceReadingBlocks,factSourceRange,extendSourceRange} from '../web/source.js';
import {sourceSelectionRequest,validateSourceSelection} from '../source-selection.mjs';
import {renderReviewRecord} from '../review-record.mjs';
const terms='Refunds are available within fourteen days. Contact the merchant before returning an order.\n\nGift vouchers cannot be refunded. Digital purchases use the platform refund process. Bank transfers may incur a fee.\n\nKeep the original receipt.';
test('a selected headline cannot remove distant qualifying clauses from the default reading data',()=>{
 const offer={merchant:'Fictional seller',itemName:'Workshop',amountCents:1000,terms};
 const request=sourceSelectionRequest(offer);
 const analysis=validateSourceSelection({passageIds:[1]},offer,request);
 assert.ok(!analysis.facts.some(f=>f.quote.includes('Gift vouchers')));
 const blocks=sourceReadingBlocks(terms,analysis.facts);
 assert.equal(blocks.map(b=>b.parts.map(p=>p.text).join('')).join(''),terms);
 assert.match(blocks.flatMap(b=>b.parts).filter(p=>!p.selected).map(p=>p.text).join(''),/Gift vouchers cannot be refunded/);
 const html=renderReviewRecord({offer,analysis,status:'review',created:0});
 assert.match(html,/All pasted terms/);
 assert.ok(html.indexOf('Gift vouchers cannot be refunded')<html.indexOf('AI-selected original terms'));
});
test('exact source locations distinguish repeated wording without marking an unselected occurrence',()=>{
 const text='Payments are final. Exceptions require approval. Payments are final.';
 const start=text.lastIndexOf('Payments are final.');
 const blocks=sourceReadingBlocks(text,[{quote:'Payments are final.',sourceRange:{start,end:text.length}}]);
 const selected=blocks.flatMap(b=>b.parts).filter(p=>p.selected);
 assert.equal(selected.map(p=>p.text).join(''),'Payments are final.');
 assert.equal(selected[0].start,start);
 assert.deepEqual(factSourceRange(text,{quote:'Payments are final.',sourceRange:{start,end:text.length}}),{start,end:text.length});
});
test('no selections still exposes every supplied character and old records remain readable',()=>{
 const text='  First condition.\n\nSecond condition: retain punctuation, tabs\tand <text>.  ';
 assert.equal(sourceReadingBlocks(text).map(b=>b.text).join(''),text);
 const blocks=sourceReadingBlocks(text,[{quote:'Second condition: retain punctuation, tabs\tand <text>.',sourceRange:{start:0,end:5}}]);
 assert.equal(blocks.flatMap(b=>b.parts).map(p=>p.text).join(''),text);
 assert.ok(blocks.flatMap(b=>b.parts).some(p=>p.selected));
});
test('saved source label links each selected quote to its exact original location',()=>{
 const text='Payments are final. Exceptions require approval. Payments are final.';
 const start=text.lastIndexOf('Payments are final.');
 const html=renderReviewRecord({offer:{merchant:'Example',itemName:'Order',amountCents:100,terms:text},analysis:{mode:'source',facts:[{label:'Payment',quote:'Payments are final.',sourceRange:{start,end:text.length}}]},status:'review',created:0});
 assert.ok(html.includes('href="#source-'+start+'"'));
 assert.ok(html.includes('<mark id="source-'+start+'">Payments are final.</mark>'));
 assert.equal((html.match(/id="source-/g)||[]).length,new Set([...html.matchAll(/id="(source-\d+)"/g)].map(m=>m[1])).size);
});

test('saved bounded context stays in one source block without changing any source byte',()=>{
 const paragraph='Users may request a refund if the content cannot run. '+('The publisher first tries to resolve technical issues. '.repeat(8))+'External keys require cancellation before processing.';
 const source='9. Refunds\n\n'+paragraph+'\n\n10. Other terms\n\nKeep your receipt.';
 const start=source.indexOf(paragraph),end=start+paragraph.length;
 const blocks=sourceReadingBlocks(source,[],{keepRanges:[{start,end}]});
 assert.equal(blocks.map(b=>b.text).join(''),source);
 assert.ok(blocks.some(b=>b.start<=start&&b.end>=end));
 const html=renderReviewRecord({offer:{merchant:'Test publisher',itemName:'Download',amountCents:1999,terms:source},analysis:{facts:[],mode:'source'},status:'review',created:0});
 assert.ok(html.includes('External keys require cancellation before processing.'));
});

test('a reader can explicitly include the next subscription-use prerequisite without changing the source',()=>{
 const rule='If a renewable subscription has not been used during the current billing cycle, you may request a refund within 48 hours of any automatic renewal.';
 const use='Content is considered used if any games within the subscription have been played or benefits have been consumed, modified or transferred.';
 const source='Renewable Subscriptions. '+rule+' '+use+' Cancellation is available separately.';
 const start=source.indexOf(rule),range={start,end:start+rule.length};
 const expanded=extendSourceRange(source,range,'next');
 assert.equal(source.slice(expanded.start,expanded.end),rule+' '+use);
 assert.equal(extendSourceRange(source,{start:0,end:source.length},'next'),null);
 assert.equal(extendSourceRange(source,{start:0,end:source.length},'previous'),null);
 assert.equal(extendSourceRange(source,range,'guess'),null);
 assert.equal(source.slice(range.start,range.end),rule);
});
test('manual previous and next selection retains negation and exact punctuation around a partial quote',()=>{
 const source='Refunds are not guaranteed. Ask the publisher first. Keep the original receipt.';
 const start=source.indexOf('publisher'),range={start,end:start+'publisher'.length};
 const before=extendSourceRange(source,range,'previous');
 const both=extendSourceRange(source,before,'next');
 assert.equal(source.slice(both.start,both.end),'Ask the publisher first.');
 const previous=extendSourceRange(source,both,'previous');
 assert.equal(source.slice(previous.start,previous.end),'Refunds are not guaranteed. Ask the publisher first.');
 assert.equal(extendSourceRange(source,{start:-1,end:5},'next'),null);
});
