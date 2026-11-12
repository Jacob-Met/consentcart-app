const context=document.getElementById('review-context');
const rail=document.querySelector('.review-wayfinding');
const nav=document.querySelector('.steps');
export function showReviewScreen(screen,{focus=false}={}){
 document.body.dataset.screen=screen;
 for(const link of nav.querySelectorAll('a')){const active=link.id==='step-'+screen;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','step');else link.removeAttribute('aria-current');}
 if(focus){const target=document.getElementById(screen==='read'?'offer-head':screen==='approve'?'terms-facts-title':'analysis-head');target.tabIndex=-1;target.focus({preventScroll:true});if(screen==='approve')target.scrollIntoView({block:'start',behavior:'instant'});else window.scrollTo({top:0,behavior:'instant'});}
}
export function updateReviewNavigation(offer){
 const merchant=document.getElementById('merchant'),item=document.getElementById('item'),price=document.getElementById('amount');
 const value=offer||{merchant:merchant.value,itemName:item.value,amountCents:Math.round(Number(price.value)*100)};
 document.getElementById('context-merchant').textContent=(value.merchant||'New purchase')+(document.body.dataset.example==='true'?' · Example':'');
 document.getElementById('context-item').textContent=value.itemName||'Your item';
 const hasPrice=Number.isSafeInteger(value.amountCents)&&value.amountCents>0&&(!!offer||price.value.trim()!==''&&price.validity.valid);
 document.getElementById('context-price').textContent=hasPrice?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value.amountCents/100)+' USD':'—';

}
for(const link of nav.querySelectorAll('a'))link.addEventListener('click',event=>{event.preventDefault();document.dispatchEvent(new CustomEvent('purchase-screen',{detail:link.id.replace('step-','')}));});
new ResizeObserver(()=>document.documentElement.style.setProperty('--review-nav-height',Math.ceil(rail.getBoundingClientRect().height)+'px')).observe(rail);
