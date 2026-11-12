// Phone approval page: opened from the QR code on the checkout screen. It shows the cart item by item and sends one answer back.
import {fmtMoney,tileFor} from '/spend-rules.js';
const root=document.getElementById('phone-root');
const id=location.pathname.split('/').pop(),t=new URLSearchParams(location.search).get('t')||'';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(){
  const r=await fetch(`/api/consent/phone?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`,{cache:'no-store'});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'This approval link is not valid.');return j;
}
function done(a){
  const ok=['approved','allowed'].includes(a.status);
  const msg={approved:['✓','Approved','Your computer has been told. You can close this page.'],declined:['✕','Declined','Nothing will be bought. You can close this page.'],
    expired:['⏱','This request expired','Ask again from the checkout on your computer.'],allowed:['✓','Already allowed by your rules','Nothing is needed from you.'],blocked:['✕','Stopped by your rules','Nothing will be bought.']}[a.status]||['•',a.status,''];
  root.innerHTML=`<div class="p-done"><div class="p-big ${ok?'p-ok':'p-no'}" aria-hidden="true">${msg[0]}</div><h1>${msg[1]}</h1><p>${msg[2]}</p></div>`;
}
function show(a){
  if(a.status!=='pending')return done(a);
  root.innerHTML=`<p class="p-brand"><i></i>ConsentCart</p><h1>Approve this purchase?</h1><p class="p-from">${esc(a.merchant||'A seller')} is asking through your computer.</p>
<ul class="p-cart">${a.items.map(i=>{const x=tileFor(i.name);return `<li><span class="p-tile" data-h="${x.hue}" aria-hidden="true">${esc(x.initial)}</span><span class="p-name"><b>${esc(i.name)}</b><small>Qty ${i.qty}</small></span><span class="p-price">${fmtMoney(i.priceCents*i.qty||0)}</span></li>`}).join('')}</ul>
<div class="p-total"><span>Total</span><b>${fmtMoney(a.amountCents)}</b></div><p class="p-reason">${esc(a.reason)}</p><p id="p-err" class="p-err" role="alert"></p>
<div class="p-bar"><button class="p-btn" id="p-no" type="button">Decline</button><button class="p-btn go" id="p-yes" type="button">Approve</button></div>`;
  const send=async decision=>{
    document.querySelectorAll('.p-btn').forEach(b=>b.disabled=true);
    try{
      const r=await fetch('/api/consent/phone/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,t,decision})});
      const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Could not send your answer.');done({status:j.status});
    }catch(e){document.getElementById('p-err').textContent=e.message;document.querySelectorAll('.p-btn').forEach(b=>b.disabled=false)}
  };
  document.getElementById('p-yes').onclick=()=>send('approve');document.getElementById('p-no').onclick=()=>send('decline');
}
load().then(show).catch(e=>{root.innerHTML=`<div class="p-done"><div class="p-big" aria-hidden="true">?</div><h1>Link not valid</h1><p>${esc(e.message)}</p></div>`});

const applyTiles=()=>document.querySelectorAll('[data-h]:not([data-hd])').forEach(e=>{e.style.setProperty('--h',e.dataset.h);e.dataset.hd='1'}); // inline style attributes are blocked by the page's CSP; CSSOM is not
new MutationObserver(applyTiles).observe(document.body,{childList:true,subtree:true});applyTiles();
