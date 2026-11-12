const storageKey='consentcart.recent-reviews.v1';
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const amount=cents=>'$'+(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' USD';
function element(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n}

/** Keep only opaque review references here; the server supplies the current record. */
export function createReviewContinuity({before,onOpen,snapshot,onIdsChange}){
  const box=element('details','recent-reviews hidden');box.id='recent-reviews';
  const summary=element('summary',null,'Continue a recent review');
  const help=element('p','recent-review-help','Reviews stay available for 45 minutes. Existing Sandbox checkouts stay saved on this computer.');
  const list=element('ul','recent-review-list');list.id='recent-review-list';
  const message=element('p','recent-review-status');message.id='recent-review-status';message.setAttribute('role','status');
  const actions=element('div','recent-review-actions');
  const retry=element('button','ghost-button','Refresh recent reviews');retry.type='button';
  const forget=element('button','ghost-button','Clear recent list');forget.type='button';
  actions.append(retry,forget);box.append(summary,help,list,message,actions);before.before(box);
  let ids=[],storageAvailable=true,refreshVersion=0,openVersion=0;
  const records=new Map();
  try{
    const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');
    if(Array.isArray(saved))ids=[...new Set(saved.filter(validId))].slice(0,5);
  }catch{storageAvailable=false}
  function save(){
    try{if(ids.length)localStorage.setItem(storageKey,JSON.stringify(ids));else localStorage.removeItem(storageKey)}
    catch{storageAvailable=false}
  }
  function status(text){message.textContent=text}
  function render(){
    list.replaceChildren();
    for(const id of ids){
      const record=records.get(id);if(!record)continue;
      const row=element('li','recent-review-row');
      const button=element('button','recent-review-open');button.type='button';button.dataset.reviewId=id;
      const details=element('span','recent-review-identity');
      details.append(element('strong',null,record.offer.itemName),element('span',null,record.offer.merchant));
      const total=element('span','recent-review-total',amount(record.offer.amountCents));
      const action=element('span','recent-review-action','Open review →');
      button.append(details,total,action);
      button.setAttribute('aria-label','Open review for '+record.offer.itemName+' from '+record.offer.merchant+', '+amount(record.offer.amountCents));
      button.addEventListener('click',()=>open(id,button));
      row.append(button);list.append(row);
    }
    forget.disabled=!ids.length;retry.disabled=!ids.length;
    box.classList.toggle('hidden',!ids.length&&!message.textContent);
    if(!storageAvailable)help.textContent='Recent reviews are available in this tab only. Save a review to keep a readable copy.';
  }
  async function fetchRecord(id){
    const response=await fetch('/api/review?id='+encodeURIComponent(id),{cache:'no-store'});
    const record=await response.json();
    if(!response.ok){const error=new Error(record.error||'The review could not be opened.');error.status=response.status;throw error}
    if(record.id!==id||!record.offer||!record.analysis||typeof record.offer.terms!=='string')throw Error('The saved review could not be read. Refresh and try again.');
    return record;
  }
  async function open(id,button){
    const requestVersion=++openVersion,original=snapshot();
    button.disabled=true;status('Opening the reviewed purchase…');
    try{
      const record=await fetchRecord(id);
      if(requestVersion!==openVersion)return;
      if(original!==snapshot()){status('Your offer changed while this review was loading. Open it again when you are ready to replace the displayed offer.');return}
      const opened=await onOpen(record);
      if(requestVersion!==openVersion)return;
      if(opened===false){status('Your current offer has been kept.');return}
      status(record.order?'Existing Sandbox checkout reopened. Check its payment status before continuing.':'Review reopened. Both payment acknowledgments are unchecked.');
      box.open=false;
    }catch(error){
      if(requestVersion!==openVersion)return;
      if(error.status===404){ids=ids.filter(value=>value!==id);records.delete(id);save();onIdsChange?.([...ids]);render();status('This review has expired. Open a saved copy or review the current offer again.');box.classList.remove('hidden')}
      else status(error.message||'Could not open this review. Try again.');
    }finally{if(button.isConnected)button.disabled=false}
  }
  async function refresh(){
    const version=++refreshVersion,requested=[...ids];if(!requested.length){render();return}
    box.classList.remove('hidden');status('Finding your recent reviews…');
    const outcomes=await Promise.all(requested.map(async id=>{try{return {id,record:await fetchRecord(id)}}catch(error){return {id,error}}}));
    if(version!==refreshVersion)return;
    let expired=0,unavailable=0;
    for(const {id,record,error} of outcomes){
      if(!ids.includes(id))continue;
      if(record)records.set(id,record);
      else if(error?.status===404){ids=ids.filter(value=>value!==id);records.delete(id);expired++}
      else unavailable++;
    }
    save();onIdsChange?.([...ids]);
    status(unavailable?'Some recent reviews could not be loaded. Refresh to try again.':expired?'Expired reviews were removed. Open a saved copy to review an older offer.':'');
    render();
    if(records.size||message.textContent)box.open=true;
  }
  function remember(record){
    if(!validId(record?.id)||!record.offer)return;
    refreshVersion++;
    ids=[record.id,...ids.filter(id=>id!==record.id)].slice(0,5);
    records.set(record.id,record);save();onIdsChange?.([...ids]);status('');render();
  }
  retry.addEventListener('click',refresh);
  forget.addEventListener('click',()=>{openVersion++;refreshVersion++;ids=[];records.clear();save();onIdsChange?.([]);status('Recent list cleared. Your displayed review is still open.');render()});
  return {remember,refresh};
}
