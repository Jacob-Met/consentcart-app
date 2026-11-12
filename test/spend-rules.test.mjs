import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRule,parseRules,evaluate,purchaseFlags,findMoney} from '../web/spend-rules.js';
import {createConsent} from '../consent.mjs';
import {qrSvg} from '../qr.mjs';

const mk=(text,i=0)=>({id:'r'+i,enabled:true,...parseRule(text)});
test('plain speech becomes rule cards',()=>{
  assert.equal(findMoney('never over fifty dollars'),5000);
  assert.equal(findMoney('up to a hundred a week'),10000);
  assert.equal(findMoney('over twenty-five bucks'),2500);
  const a=parseRule('never over fifty dollars without asking me');
  assert.deepEqual([a.kind,a.effect,a.cents],['over','ask',5000]);
  const b=parseRule('no subscriptions');assert.deepEqual([b.kind,b.flag,b.effect],['flag','subscription','block']);
  const c=parseRule('groceries are fine up to a hundred a week');
  assert.deepEqual([c.kind,c.effect,c.cents,c.category,c.period],['within','allow',10000,'groceries','week']);
  assert.equal(parseRule('never spend over $200').effect,'block');
  assert.equal(parseRule('ask me if there is a restocking fee').flag,'restocking');
  assert.equal(parseRule('the weather is nice'),null);
  const many=parseRules('never over fifty dollars without asking me. No subscriptions; groceries are fine up to $100 a week\nblah');
  assert.equal(many.rules.length,3);assert.deepEqual(many.unparsed,['blah']);
});
test('flags ignore negated mentions',()=>{
  assert.equal(purchaseFlags('No subscription is included with this product.').subscription,false);
  assert.equal(purchaseFlags('The membership renews automatically every year.').subscription,true);
  assert.equal(purchaseFlags('A 10% restocking fee applies.').restocking,true);
});
test('evaluation: allow inside rules, ask outside, with a reason',()=>{
  const rules=['never over fifty dollars without asking me','no subscriptions','groceries are fine up to a hundred a week'].map(mk);
  const p=(amountCents,extra={})=>({amountCents,category:null,flags:{},text:'',...extra});
  const small=evaluate(rules,p(4800));assert.equal(small.verdict,'allow');assert.match(small.reason,/\$48/);
  const big=evaluate(rules,p(12000));assert.equal(big.verdict,'ask');assert.match(big.reason,/over your \$50/);
  const sub=evaluate(rules,p(1000,{flags:{subscription:true}}));assert.equal(sub.verdict,'block');
  const food=evaluate(rules,p(6200,{category:'groceries',text:'pasta'}),{spent:()=>0});assert.equal(food.verdict,'allow');
  const more=evaluate(rules,p(6200,{category:'groceries',text:'pasta'}),{spent:()=>6200});assert.equal(more.verdict,'ask');
  assert.equal(evaluate([],p(100)).gate,false);
  rules[0].enabled=false;assert.equal(evaluate(rules,p(12000)).verdict,'ask'); // nothing covers it
});
test('ask lifecycle: pending, phone answers with its token, history records who',async()=>{
  const c=createConsent({port:1,env:{CONSENTCART_PHONE_HOST:'192.168.1.9'}});
  c.addRules('never over fifty dollars without asking me');
  const a=c.createAsk({merchant:'M',item:'Bag',amountCents:12000,terms:'x'});
  assert.equal(a.status,'pending');assert.match(a.token,/^[0-9a-f]{16}$/);
  const ok=c.createAsk({merchant:'M',item:'Pen',amountCents:900,terms:''});assert.equal(ok.status,'allowed');assert.equal(ok.by,'rule');
  c.answer(c.find(a.id),'approve','phone');assert.equal(c.find(a.id).status,'approved');
  assert.throws(()=>c.answer(c.find(a.id),'decline','desktop'),/already/);
});
test('qr svg renders',()=>{assert.match(qrSvg('http://192.168.1.9:4178/phone/abcdef0123?t=0123456789abcdef'),/^<svg/)});
