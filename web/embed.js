// Embedded mode (/?embed=1): the page runs inside the ConsentCart browser-extension drawer.
// It receives the seller's terms from the parent page and fills the same inputs a shopper would paste into.
document.body.classList.add('embed');
const css=document.createElement('link');css.rel='stylesheet';css.href='/embed.css';document.head.append(css);
const $=id=>document.getElementById(id);
const parentWin=window.parent!==window?window.parent:null;
let filled=false;
window.addEventListener('message',async event=>{
  const d=event.data;
  if(!parentWin||event.source!==parentWin||!d||d.type!=='consentcart:terms')return;
  const terms=typeof d.terms==='string'?d.terms.slice(0,60000):'';
  // Reopening the drawer on the same checkout must not throw away a review or an order already in progress
  // (for example after coming back from PayPal). Give the app a moment to restore its saved state first.
  await new Promise(done=>setTimeout(done,900));
  const norm=t=>String(t||'').replace(/\s+/g,' ').trim();
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
