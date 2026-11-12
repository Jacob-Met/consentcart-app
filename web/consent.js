// Spending rules, consent step and history. Added on top of the existing page: no existing element is changed or removed.
import {fmtMoney,tileFor} from '/spend-rules.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(path,body)=>{
  const r=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(j.error||'Something went wrong.'),{status:r.status});return j;
};
let rulesChanged=false,rules=[],checkoutAsk=null,sampleAsk=null,pollTimer=null,tab='rules',filter='all';

const EXAMPLES=['never over fifty dollars without asking me','no subscriptions','groceries are fine up to a hundred a week'];
const SAMPLES=[
  {label:'Journal, $48',item:'Traveler’s leather journal',merchant:'Northstar Supply Co.',amountCents:4800,terms:'Returns accepted within 14 days. A 10% restocking fee applies to non-defective returns. No subscription is included.',items:[{name:'Traveler’s leather journal',qty:1,priceCents:4800}]},
  {label:'Weekender bag, $120',item:'Leather weekender bag',merchant:'Northstar Supply Co.',amountCents:12000,terms:'Returns accepted within 30 days. Monogrammed bags are final sale.',items:[{name:'Leather weekender bag',qty:1,priceCents:12000}]},
  {label:'Pantry box, $62',item:'Weekly pantry box',merchant:'Greenfield Market',amountCents:6200,terms:'Perishable groceries. Refunds for spoiled items within 48 hours.',items:[{name:'Olive oil',qty:1,priceCents:2400},{name:'Pasta',qty:3,priceCents:600},{name:'Coffee beans',qty:1,priceCents:2000}]},
  {label:'Annual membership, $59',item:'Reader club membership',merchant:'Paperleaf',amountCents:5900,terms:'The membership renews automatically every year at $59 until you cancel.',items:[{name:'Reader club membership',qty:1,priceCents:5900}]},
];

// ---------- decision card ----------
const STATUS={
  allowed:['ok','Allowed by your rules'],approved:['ok','You approved this'],blocked:['bad','Stopped by your rules'],
  declined:['bad','You declined this'],pending:['ask','Needs your OK'],expired:['bad','Request expired'],
};
function cartHtml(a){
  return `<ul class="cc-cart">${a.items.map(i=>{const t=tileFor(i.name);return `<li><span class="cc-tile" data-h="${t.hue}" aria-hidden="true">${esc(t.initial)}</span><span class="cc-iname"><b>${esc(i.name)}</b><small>Qty ${i.qty}${i.qty>1&&i.priceCents?' · '+fmtMoney(i.priceCents)+' each':''}</small></span><b class="cc-price">${fmtMoney(i.priceCents*i.qty||0)}</b></li>`}).join('')}</ul><div class="cc-total"><span>Total</span><b>${fmtMoney(a.amountCents)}</b></div>`;
}
function byText(a){
  if(a.status==='allowed'||a.status==='blocked')return a.ruleText?`By rule: “${esc(a.ruleText)}”`:'';
  if(a.status==='approved'||a.status==='declined')return `${a.by==='phone'?'Answered on your phone':'Answered on this screen'}${a.ruleText?` · rule that asked: “${esc(a.ruleText)}”`:''}`;
  return a.ruleText?`Rule: “${esc(a.ruleText)}”`:'';
}
export function decisionHtml(a,{optional=false}={}){
  const [tone,label]=STATUS[a.status]||['ask',a.status];
  const phone=a.status==='pending'?`<div class="cc-phone"><img class="cc-qr" alt="QR code to approve on your phone" width="132" height="132" src="/api/consent/qr?id=${esc(a.id)}"><div><b>Approve on your phone</b><p>Scan this with your phone camera. It opens this cart on your local network with Approve and Decline.</p>${a.lan===false?'<p class="cc-warn">No local network address was found, so the link only opens on this computer.</p>':''}<p class="cc-wait"><i></i>Waiting for your phone…</p></div></div>`:'';
  const actions=a.status==='pending'?`<div class="cc-actions"><button type="button" class="cc-btn cc-primary" data-cc="approve">Approve</button><button type="button" class="cc-btn" data-cc="decline">Decline</button></div>`:
    (a.status==='expired'||a.status==='declined')?`<div class="cc-actions"><button type="button" class="cc-btn" data-cc="again">Ask again</button></div>`:'';
  return `<div class="cc-card cc-${tone}" data-status="${esc(a.status)}"><div class="cc-pillrow"><span class="cc-pill">${esc(label)}</span>${optional&&a.status==='pending'?'<span class="cc-opt">optional, no rules are on</span>':''}</div>${cartHtml(a)}<p class="cc-reason">${esc(a.reason)}</p>${(a.reasons||[]).length>1?`<ul class="cc-more">${a.reasons.slice(1).map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`:''}<p class="cc-by">${byText(a)}</p>${actions}${phone}</div>`;
}

function poll(){
  clearTimeout(pollTimer);
  const open=[checkoutAsk,sampleAsk].filter(a=>a&&a.status==='pending');
  if(!open.length)return;
  pollTimer=setTimeout(async()=>{
    for(const a of open){try{const n=await api('/api/consent/ask?id='+a.id);if(n.status!==a.status){if(a===checkoutAsk)checkoutAsk=n;else sampleAsk=n;renderAll()}}catch{}}
    poll();
  },1200);
}
async function answer(a,decision){
  try{const n=await api('/api/consent/answer',{id:a.id,decision});if(a===checkoutAsk)checkoutAsk=n;if(a===sampleAsk)sampleAsk=n;}catch(e){note(e.message)}
  renderAll();if(!$('cc-sheet').hidden&&tab==='history')renderHistory();
}
const note=m=>{const n=$('cc-note');if(n){n.textContent=m;n.hidden=!m}};

// ---------- checkout card ----------
function cartFromPage(){
  const merchant=$('merchant')?.value||'',item=$('item')?.value||'',price=Math.round(Number($('amount')?.value)*100),terms=$('terms')?.value||'';
  const extra=Array.isArray(window.__ccItems)?window.__ccItems:[];
  const items=extra.length?extra.map(i=>({name:i.name,qty:i.qty||1,priceCents:i.priceCents})):[{name:item,qty:1,priceCents:price}];
  return {merchant,item,amountCents:price,terms,items};
}
async function askForCheckout(force){
  const c=cartFromPage();if(!c.item||!(c.amountCents>0))return;
  const sig=JSON.stringify([c.merchant,c.item,c.amountCents]);
  if(!force&&checkoutAsk&&checkoutAsk._sig===sig&&checkoutAsk.status!=='expired')return renderAll();
  try{checkoutAsk=await api('/api/consent/ask',c);checkoutAsk._sig=sig}catch(e){checkoutAsk=null;note(e.message)}
  renderAll();poll();
}
function gated(){
  if(!checkoutAsk||!checkoutAsk.gate)return false;
  return !['allowed','approved'].includes(checkoutAsk.status);
}
function renderCheckout(){
  let host=$('cc-checkout');
  if(!host){
    const anchor=$('checkout-controls');if(!anchor)return;
    host=document.createElement('section');host.id='cc-checkout';host.setAttribute('aria-label','Your approval');host.setAttribute('aria-live','polite');
    anchor.parentNode.insertBefore(host,anchor);
  }
  if(!checkoutAsk){host.innerHTML='';document.body.classList.remove('cc-gated');return}
  host.innerHTML=decisionHtml(checkoutAsk,{optional:!checkoutAsk.gate});
  document.body.classList.toggle('cc-gated',gated());
  const hint=$('status');
  if(hint&&gated())hint.dataset.ccHint='1';
}
// A request that is not yet allowed keeps "Continue with PayPal" from starting (capture phase, before the page's own handler).
document.addEventListener('click',e=>{
  const b=e.target.closest?.('#order');
  if(b&&gated()){e.preventDefault();e.stopImmediatePropagation();note(checkoutAsk.status==='blocked'?'Your rules stop this purchase.':'Approve this purchase above, here or on your phone, before continuing.');$('cc-checkout')?.scrollIntoView({block:'nearest',behavior:'smooth'})}
},true);
document.addEventListener('click',e=>{
  const b=e.target.closest?.('[data-cc]');if(!b)return;
  const host=b.closest('#cc-checkout')?'checkout':'sample',a=host==='checkout'?checkoutAsk:sampleAsk;if(!a)return;
  const act=b.dataset.cc;
  if(act==='approve'||act==='decline')answer(a,act);
  if(act==='again'){if(host==='checkout')askForCheckout(true);else runSample(a._sample)}
});

// ---------- sheet: rules + history ----------
function ruleCard(r){
  return `<li class="cc-rule${r.enabled?'':' off'}" data-id="${esc(r.id)}"><div class="cc-rule-text"><b>“${esc(r.text)}”</b><span>${esc(r.gloss)}</span></div><button type="button" class="cc-switch" role="switch" aria-checked="${r.enabled}" aria-label="Rule on" data-toggle="${esc(r.id)}"><i></i></button><button type="button" class="cc-x" aria-label="Remove rule" data-remove="${esc(r.id)}">&times;</button></li>`;
}
function renderRules(unparsed=[]){
  const el=$('cc-pane');if(!el)return;
  const speech=window.SpeechRecognition||window.webkitSpeechRecognition;
  el.innerHTML=`<h3 class="cc-h">Tell it your rules</h3><p class="cc-sub">Say or type them the way you would to a person. They are read back as cards you can switch off. Before any checkout, a purchase inside your rules goes through; anything outside asks you, with the reason.</p>
<form id="cc-rule-form" class="cc-rule-form"><input id="cc-rule-input" type="text" autocomplete="off" maxlength="200" placeholder="e.g. never over fifty dollars without asking me" aria-label="A spending rule"><button type="button" id="cc-mic" class="cc-btn cc-icon"${speech?'':' hidden'} aria-label="Speak a rule">Speak</button><button type="submit" class="cc-btn cc-primary">Add</button></form>
<div class="cc-chips" aria-label="Examples">${EXAMPLES.map(x=>`<button type="button" class="cc-chip" data-cc-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
${unparsed.length?`<p class="cc-warn" role="status">I could not turn “${esc(unparsed.join('”, “'))}” into a rule. Try a price (“over $50”), a kind of thing (“groceries up to $100 a week”) or something to avoid (“no subscriptions”).</p>`:''}
<ul class="cc-rules" id="cc-rules">${rules.length?rules.map(ruleCard).join(''):'<li class="cc-empty">No rules yet. Tap an example above to start.</li>'}</ul>
<h3 class="cc-h">Try a sample cart</h3><p class="cc-sub">Runs a made-up cart through your rules. Nothing is bought.</p>
<div class="cc-chips">${SAMPLES.map((s,i)=>`<button type="button" class="cc-chip" data-sample="${i}">${esc(s.label)}</button>`).join('')}</div><div id="cc-sample">${sampleAsk?decisionHtml(sampleAsk):''}</div>`;
}
async function addRule(text){
  if(!text.trim())return;
  try{const r=await api('/api/consent/rules',{text});rules=r.rules;rulesChanged=true;renderRules(r.unparsed);renderBar();$('cc-rule-input')?.focus()}catch(e){note(e.message)}
}
async function runSample(s){
  if(!s)return;
  try{sampleAsk=await api('/api/consent/ask',{...s,sample:true});sampleAsk._sample=s}catch(e){note(e.message);return}
  const host=$('cc-sample');if(host)host.innerHTML=decisionHtml(sampleAsk);poll();host?.scrollIntoView({block:'nearest',behavior:'smooth'});
}
const OUT={allowed:'Allowed',approved:'Approved',blocked:'Declined by rule',declined:'Declined',pending:'Waiting',expired:'Expired'};
async function renderHistory(){
  const el=$('cc-pane');if(!el)return;
  let list=[];try{list=(await api('/api/consent/history')).history}catch(e){note(e.message)}
  const f={all:()=>true,ok:a=>['allowed','approved'].includes(a.status),no:a=>['blocked','declined','expired'].includes(a.status),asked:a=>a.verdict==='ask'};
  const shown=list.filter(f[filter]);
  const day=ts=>new Date(ts).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});
  let last='';
  el.innerHTML=`<h3 class="cc-h">What was asked, and who answered</h3><div class="cc-chips" role="tablist">${[['all','Everything'],['ok','Approved'],['no','Declined'],['asked','Asked me']].map(([k,l])=>`<button type="button" class="cc-chip${filter===k?' on':''}" data-filter="${k}" aria-pressed="${filter===k}">${l}</button>`).join('')}</div>
<ol class="cc-hist">${shown.length?shown.map(a=>{
    const d=day(a.at),head=d!==last?`<li class="cc-day">${esc(d)}</li>`:'';last=d;
    const t=tileFor(a.item),time=new Date(a.at).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    const tone=(STATUS[a.status]||['ask'])[0];
    const who=a.status==='allowed'||a.status==='blocked'?(a.ruleText?`By rule: “${esc(a.ruleText)}”`:'By your rules'):a.status==='pending'?'Waiting for you':a.status==='expired'?'Nobody answered in time':`${a.by==='phone'?'You, on your phone':'You, on this screen'}${a.ruleText?` (asked by “${esc(a.ruleText)}”)`:''}`;
    return `${head}<li class="cc-h-item cc-${tone}"><span class="cc-tile" data-h="${t.hue}" aria-hidden="true">${esc(t.initial)}</span><div class="cc-h-body"><b>${esc(a.item)}</b><small>${esc(a.merchant||'Unknown seller')} · ${esc(time)}${a.sample?' · sample cart':''}</small><p>${esc(a.reason)}</p><small class="cc-who">${who}</small></div><div class="cc-h-side"><b>${fmtMoney(a.amountCents)}</b><span class="cc-pill">${OUT[a.status]||a.status}</span></div></li>`}).join(''):'<li class="cc-empty">Nothing here yet. Sample carts and real checkouts show up here.</li>'}</ol>`;
}
function renderPane(){tab==='rules'?renderRules():renderHistory();document.querySelectorAll('.cc-tab').forEach(t=>t.setAttribute('aria-selected',String(t.dataset.tab===tab)))}
function openSheet(which){
  tab=which;note('');const s=$('cc-sheet');s.hidden=false;document.body.classList.add('cc-sheet-open');renderPane();$('cc-close').focus();
}
function closeSheet(){
  $('cc-sheet').hidden=true;document.body.classList.remove('cc-sheet-open');$('cc-bar-rules')?.focus();
  if(rulesChanged){rulesChanged=false;if(document.body.dataset.screen==='approve')askForCheckout(true)}
}
function renderBar(){
  const n=rules.filter(r=>r.enabled).length;
  const r=$('cc-bar-rules');if(r)r.innerHTML=`Spending rules <b>${n} on</b>`;
}
function renderAll(){
  renderCheckout();
  const host=$('cc-sample');if(host&&sampleAsk)host.innerHTML=decisionHtml(sampleAsk);
}

function build(){
  const side=document.querySelector('.purchase-summary');
  const bar=document.createElement('div');bar.id='cc-bar';bar.className='cc-bar';
  bar.innerHTML=`<button type="button" id="cc-bar-rules" class="cc-barbtn">Spending rules</button><button type="button" id="cc-bar-history" class="cc-barbtn">History</button>`;
  (side||document.body).prepend(bar);
  const sheet=document.createElement('div');sheet.id='cc-sheet';sheet.className='cc-sheet';sheet.hidden=true;
  sheet.innerHTML=`<div class="cc-backdrop" data-close></div><section class="cc-panel" role="dialog" aria-modal="true" aria-label="Spending rules and history"><header><div class="cc-tabs" role="tablist"><button type="button" role="tab" class="cc-tab" data-tab="rules">Rules</button><button type="button" role="tab" class="cc-tab" data-tab="history">History</button></div><button type="button" id="cc-close" class="cc-close" aria-label="Close">&times;</button></header><p id="cc-note" class="cc-warn" role="status" hidden></p><div id="cc-pane"></div></section>`;
  document.body.append(sheet);
  $('cc-bar-rules').onclick=()=>openSheet('rules');$('cc-bar-history').onclick=()=>openSheet('history');
  $('cc-close').onclick=closeSheet;
  sheet.addEventListener('click',async e=>{
    const t=e.target;if(t.closest('[data-close]'))return closeSheet();
    const tabBtn=t.closest('.cc-tab');if(tabBtn){tab=tabBtn.dataset.tab;return renderPane()}
    const ex=t.closest('[data-cc-ex]');if(ex)return addRule(ex.dataset.ccEx);
    const tg=t.closest('[data-toggle]');if(tg){const r=rules.find(x=>x.id===tg.dataset.toggle);try{rules=(await api('/api/consent/rules/toggle',{id:r.id,enabled:!r.enabled})).rules;rulesChanged=true}catch(er){note(er.message)}renderRules();renderBar();return}
    const rm=t.closest('[data-remove]');if(rm){try{rules=(await api('/api/consent/rules/remove',{id:rm.dataset.remove})).rules;rulesChanged=true}catch(er){note(er.message)}renderRules();renderBar();return}
    const sm=t.closest('[data-sample]');if(sm)return runSample(SAMPLES[Number(sm.dataset.sample)]);
    const fl=t.closest('[data-filter]');if(fl){filter=fl.dataset.filter;return renderHistory()}
    if(t.closest('#cc-mic'))return listen();
  });
  sheet.addEventListener('submit',e=>{if(e.target.id==='cc-rule-form'){e.preventDefault();const i=$('cc-rule-input');const v=i.value;i.value='';addRule(v)}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)closeSheet()});
}
function listen(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return;
  const rec=new SR();rec.lang=document.documentElement.lang||'en-US';rec.interimResults=false;
  const b=$('cc-mic');b.textContent='Listening…';
  rec.onresult=e=>{const t=e.results[0][0].transcript;$('cc-rule-input').value=t;addRule(t);$('cc-rule-input').value=''};
  rec.onerror=()=>{note('The microphone is not available here. Type the rule instead.')};
  rec.onend=()=>{if(b)b.textContent='Speak'};
  try{rec.start()}catch{note('The microphone is not available here. Type the rule instead.')}
}

async function init(){
  build();
  try{rules=(await api('/api/consent/rules')).rules}catch{}
  renderBar();
  const maybe=()=>{if(document.body.dataset.screen==='approve')askForCheckout(false)};
  new MutationObserver(maybe).observe(document.body,{attributes:true,attributeFilter:['data-screen']});
  window.addEventListener('cc-items',()=>{if(document.body.dataset.screen==='approve')askForCheckout(true)});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poll()});
  maybe();
}
init();

const applyTiles=()=>document.querySelectorAll('[data-h]:not([data-hd])').forEach(e=>{e.style.setProperty('--h',e.dataset.h);e.dataset.hd='1'}); // inline style attributes are blocked by the page's CSP; CSSOM is not
new MutationObserver(applyTiles).observe(document.body,{childList:true,subtree:true});applyTiles();
