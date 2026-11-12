import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceHeadingLocations,sourceHeadingRange} from '../web/source.js';
test('heading navigation retains repeated exact locations without inventing parent labels',()=>{
 const source='Annual contract, prepaid\n\nSubscription Terms\n\nYour subscription renews annually.\n\nAnnual contract, prepaid\n\nCancellation Terms\n\nYou may cancel at any time.';
 const headings=sourceHeadingLocations(source);
 assert.equal(headings.length,2);
 assert.deepEqual(headings.map(h=>[h.text,h.index,h.count]),[['Annual contract, prepaid',1,2],['Annual contract, prepaid',2,2]]);
 assert.ok(headings[1].start>headings[0].end);
 for(const h of headings)assert.equal(source.slice(h.start,h.end),h.text);
});
test('heading navigation leaves ordinary wrapped prose unlisted',()=>{
 assert.deepEqual(sourceHeadingLocations('Monthly renewal notices\nwill be sent before a charge.\n\nYou may cancel online.'),[]);
});

import {termsFactRowsForSection,termsFactRows} from '../web/terms-facts.js';
test('a deliberate section keeps exact original offsets and neighboring regional conditions',()=>{
 const source='Month to month\n\nAfter 14 days your payment is non-refundable.\n\nAnnual contract, billed monthly\n\nCancel after 14 days and pay 50% of the remaining contract.\n\nFor customers in California the cancellation charge is 30% of the remaining contract.\n\nAnnual contract, prepaid\n\nAfter 14 days no refund is available.';
 const chosen=sourceHeadingLocations(source).find(h=>h.text==='Annual contract, billed monthly');
 const range=sourceHeadingRange(source,chosen.start);
 assert.equal(source.slice(range.start,range.end).includes('California'),true);
 const rows=termsFactRowsForSection(source,chosen.start);
 const cancellation=rows.find(r=>r.id==='cancellation');
 assert.ok(cancellation.contextPassages.some(p=>p.text.includes('50%')));
 assert.ok(cancellation.contextPassages.some(p=>p.text.includes('California')));
 for(const row of rows)for(const passage of row.contextPassages)assert.equal(source.slice(passage.start,passage.end),passage.text);
 assert.equal(rows.some(r=>r.contextPassages.some(p=>p.text.includes('payment is non-refundable'))),false);
 assert.ok(termsFactRows(source).some(r=>r.contextPassages.some(p=>p.text.includes('payment is non-refundable'))));
});
test('an invalid source heading never silently removes other terms',()=>{
 const source='Annual contract, prepaid\n\nAfter 14 days no refund is available.';
 assert.equal(sourceHeadingRange(source,3),null);
 assert.deepEqual(termsFactRowsForSection(source,3),termsFactRows(source));
});

test('a short explicit cancellation subsection keeps a regional qualification beside the refund rule',()=>{
 const source='Annual contract, billed monthly\n\nCancellation Terms\n\nCancel within 14 days for a full refund. After 14 days, the cancellation charge is 50% of the remaining contract.\n\nFor customers in California, cancellation after 14 days costs 30% of the annual commitment.\n\nAnnual contract, prepaid\n\nCancellation Terms\n\nAfter 14 days no refund is available.';
 const h=sourceHeadingLocations(source).find(h=>h.text==='Annual contract, billed monthly');
 const returns=termsFactRowsForSection(source,h.start).find(r=>r.id==='returns');
 assert.equal(returns.conditionClauses.length,1);
 assert.ok(returns.conditionClauses[0].text.includes('California'));
 assert.ok(returns.conditionClauses[0].text.includes('30%'));
 assert.equal(returns.conditionClauses[0].text.includes('no refund is available'),false);
 for(const p of returns.contextPassages)assert.equal(source.slice(p.start,p.end),p.text);
});

import {sourceHeadingContext,sourceHeadingLabel} from '../web/source.js';
test('repeated plan labels retain distinct preceding literal product headings',()=>{
 const source='Creative Cloud for Individuals\n\nMonth to month\n\nYou may cancel online.\n\nAnnual contract, billed monthly\n\nCancellation Terms\n\nCancel after 14 days and pay 50%.\n\nSubstance for teams\nAnnual contract, billed monthly\n\nCancellation Terms\n\nCancel after 14 days and pay 50%.';
 const plans=sourceHeadingLocations(source).filter(h=>h.text==='Annual contract, billed monthly');
 assert.equal(plans.length,2);
 assert.equal(sourceHeadingContext(source,plans[0].start).text,'Creative Cloud for Individuals');
 assert.equal(sourceHeadingContext(source,plans[1].start).text,'Substance for teams');
 assert.match(sourceHeadingLabel(source,plans[1].start),/Substance for teams/);
 for(const h of plans){const c=sourceHeadingContext(source,h.start);assert.equal(source.slice(c.start,c.end),c.text)}
});
test('missing product context stays absent rather than borrowing a plan or following heading',()=>{
 const source='Annual contract, prepaid\n\nSubscription Terms\n\nYou may cancel online.\n\nSubstance for teams';
 assert.equal(sourceHeadingContext(source,0),null);
 assert.equal(sourceHeadingContext(source,5),null);
 assert.equal(sourceHeadingLabel(source,0),'Annual contract, prepaid');
 assert.equal(sourceHeadingLabel(source,source.indexOf('Substance for teams')),'Substance for teams');
});

test('adjacent copied region and product headings stay together without crossing prose',()=>{
 const source='CLOUD for United States\nCreative Cloud for Individuals\nMonth to month\n\nYou may cancel online.\n\nAnnual contract, billed monthly\n\nYou may cancel online.\n\nSubstance for teams\nAnnual contract, billed monthly\n\nYou may cancel online.';
 const plans=sourceHeadingLocations(source).filter(h=>h.text==='Annual contract, billed monthly');
 const first=sourceHeadingContext(source,plans[0].start),second=sourceHeadingContext(source,plans[1].start);
 assert.equal(first.text,'CLOUD for United States\nCreative Cloud for Individuals');
 assert.equal(source.slice(first.start,first.end),first.text);
 assert.equal(second.text,'Substance for teams');
});

import {sourceSectionAt} from '../web/source.js';
test('copied list continuations do not replace the refund section heading',()=>{
 const source='Modifications\n\nWe may revise these Terms to better reflect:\n\nchanges to the law,\n\nnew regulatory requirements, or\n\nimprovements or enhancements made to our Services.\n\nIf you do not agree to the updates, cancel your account. Where applicable, we offer a prorated refund.\n\nAnnual contract, prepaid\n\nYour payment is non-refundable.';
 assert.equal(sourceSectionAt(source,source.indexOf('If you do not agree')).text,'Modifications');
 assert.deepEqual(sourceHeadingLocations(source).map(h=>h.text),['Modifications','Annual contract, prepaid']);
 const range=sourceHeadingRange(source,0);
 assert.ok(source.slice(range.start,range.end).includes('new regulatory requirements, or'));
 assert.ok(source.slice(range.start,range.end).includes('prorated refund'));
});
