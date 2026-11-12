// Embedded mode (/?embed=1): the page runs inside the ConsentCart browser-extension drawer.
// It receives the seller's terms from the parent page and fills the same inputs a shopper would paste into.
document.body.classList.add('embed');
const css=document.createElement('link');css.rel='stylesheet';css.href='/embed.css';document.head.append(css);
const $=id=>document.getElementById(id);
const parentWin=window.parent!==window?window.parent:null;
let filled=false;
const returning=new URLSearchParams(location.search).has('return');
async function resumable(terms){
  if(!terms)return null;
  let ids=[];try{ids=JSON.parse(localStorage.getItem('consentcart.recent-reviews.v1')||'[]')}catch{}
  for(const id of Array.isArray(ids)?ids:[]){
    try{
      const r=await fetch('/api/review?id='+encodeURIComponent(id),{cache:'no-store'});if(!r.ok)continue;
      const rec=await r.json();
      if(rec?.order&&String(rec.offer?.terms||'').replace(/\s+/g,' ').trim()===terms)return id;
    }catch{}
  }
  return null;
}
// After resuming, run the existing check once so an approved order shows its Pay button.
if(returning)(async()=>{
  for(let i=0;i<40;i++){
    await new Promise(done=>setTimeout(done,150));
    const st=$('order-result')?.dataset.paymentState,b=$('check-payment');
    if(st&&b){if((st==='approval'||st==='check')&&!b.disabled)b.click();return}
  }
})();
window.addEventListener('message',async event=>{
  const d=event.data;
  if(!parentWin||event.source!==parentWin||!d||d.type!=='consentcart:terms')return;
  const terms=typeof d.terms==='string'?d.terms.slice(0,60000):'';
  // Reopening the drawer on the same checkout must not throw away a review or an order already in progress
  // (for example after coming back from PayPal). Give the app a moment to restore its saved state first.
  const norm=t=>String(t||'').replace(/\s+/g,' ').trim();
  if(returning){filled=true;document.body.dataset.embedFilled='true';return} // resumed review: keep what was restored
  // The app only restores a pending order from the PayPal return URL, and a fresh drawer has none (for example when
  // the same tab went to PayPal and back). If this browser has a saved review with an order for these same terms, resume it.
  const resumeId=await resumable(norm(terms));
  if(resumeId){location.replace('/?embed=1&return=1&review='+encodeURIComponent(resumeId));return}
  await new Promise(done=>setTimeout(done,300));
  if($('order-result')?.dataset.paymentState||(norm($('terms')?.value)&&norm($('terms').value)===norm(terms))){filled=true;document.body.dataset.embedFilled='true';return}
  const set=(id,v)=>{const el=$(id);el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}))};
  document.body.dataset.example='false';
  if(typeof d.title==='string'&&d.title.trim())set('item',d.title.trim().slice(0,100));
  const price=String(d.price??'').replace(/[^0-9.]/g,'');
  if(price&&Number.isFinite(Number(price)))set('amount',Number(price).toFixed(2));
  if(typeof d.merchant==='string'&&d.merchant.trim())set('merchant',d.merchant.trim().slice(0,100));
  if(terms.trim())set('terms',terms.trim());
  filled=true;document.body.dataset.embedFilled='true';
});
// Tell the parent we are ready to receive terms.
parentWin?.postMessage({type:'consentcart:ready'},'*');
// When the shopper comes back from the PayPal tab, pick the result up with the existing "Check payment" button.
const recheck=()=>{if(document.visibilityState==='hidden')return;const b=$('check-payment');if(b&&!b.disabled&&$('order-result')?.dataset.paymentState==='approval')b.click()};
window.addEventListener('focus',recheck);document.addEventListener('visibilitychange',recheck);
