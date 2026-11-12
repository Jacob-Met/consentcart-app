import test from 'node:test';import assert from 'node:assert/strict';import {comparisonTopics,pairedConditionGroups} from '../web/comparison-topics.js';
test('paired topics reuse qualified literal rows and exact positions in both sources',()=>{const a='Offer A.\nThe seller pays return postage for defective items only. Returns are accepted for 30 days. Late returns are not accepted.';const b='Offer B.\nThe buyer pays return postage. Returns are accepted for 14 days.';const rows=comparisonTopics(a,b),postage=rows.find(r=>r.id==='postage');assert.equal(postage.kept.value,'Read terms');assert.equal(postage.current.passages.length,1);for(const row of rows)for(const [side,text] of [['kept',a],['current',b]])for(const p of row[side]?.passages||[])assert.equal(text.slice(p.start,p.end).trim(),p.text);assert.equal(rows.find(r=>r.id==='returns').kept.passages.length,2)});
test('topics present on one side are not mistaken for a missing policy on the other',()=>{const rows=comparisonTopics('Returns within 30 days. A restocking fee of 15% applies.','Returns within 14 days.');const fees=rows.find(r=>r.id==='fees');assert.equal(fees.kept.value,'15%');assert.equal(fees.current,null);assert.equal(rows.find(r=>r.id==='renewal').current.passages.length,0)});
test('shared wording keeps every original location and differing qualifications remain separate',()=>{
 const a='Returns within 30 days if unused. Cash payments are excluded from refunds. Cash payments are excluded from refunds. Products may be exchanged within 14 days.';
 const b='Returns within 30 days only if sealed. Cash payments are excluded from refunds. Products may be exchanged within 14 days.';
 const topic=comparisonTopics(a,b).find(row=>row.id==='returns'),groups=pairedConditionGroups(topic);
 assert.equal(groups.kept.length,1);assert.equal(groups.current.length,1);assert.equal(groups.shared.length,2);
 assert.equal(groups.shared.find(entry=>entry.text.startsWith('Cash')).kept.length,2);
 assert.match(groups.kept[0].text,/if unused/);assert.match(groups.current[0].text,/only if sealed/);
 for(const [side,source] of [['kept',a],['current',b]]){
  const locations=[...groups[side].flatMap(entry=>entry.passages),...groups.shared.flatMap(entry=>entry[side])];
  assert.deepEqual(locations.map(p=>p.start).sort((a,b)=>a-b),topic[side].passages.map(p=>p.start).sort((a,b)=>a-b));
  for(const passage of locations)assert.equal(source.slice(passage.start,passage.end).trim(),passage.text);
 }
});
test('literal sharing never equates negation, case or punctuation changes',()=>{
 for(const [a,b] of [['Returns are accepted.','Returns are not accepted.'],['Returns accepted.','Returns Accepted.'],['Returns accepted.','Returns accepted!']]){
  const groups=pairedConditionGroups(comparisonTopics(a,b).find(row=>row.id==='returns'));
  assert.equal(groups.shared.length,0);assert.equal(groups.kept.length,1);assert.equal(groups.current.length,1);
 }
});
