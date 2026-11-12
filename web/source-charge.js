const clean=value=>String(value??'').trim();
const money=cents=>'$'+(cents/100).toFixed(2)+' USD';
const bases=new Set(['remaining','commitment','amount']);
export function sourcePercentages(context){
 if(/^(?:Topic to clarify:|AI suggestion|Review uncertainty)/.test(context||''))return [];
 return [...new Set([...String(context||'').matchAll(/\b(\d{1,3}(?:\.\d{1,2})?)\s*%/g)].map(m=>Number(m[1])).filter(n=>n>=0&&n<=100))];
}
export function calculateSourceCharge({amount,count,percent,base}){
 if(!bases.has(base))throw Error('Choose what the percentage applies to.');
 if(!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(clean(amount)))throw Error('Enter an amount in dollars and cents.');
 if(!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(clean(percent))||Number(percent)>100)throw Error('Choose a percentage from the selected source.');
 const number=base==='amount'?1:Number(count);
 if(!/^(?:0|[1-9]\d{0,3})$/.test(clean(base==='amount'?'1':count))||number>1200||(number===0&&base!=='remaining'))throw Error(base==='remaining'?'Enter remaining payments, from 0 to 1200.':'Enter the number of payments, from 1 to 1200.');
 const cents=BigInt(Math.round(Number(amount)*100)),basisPoints=BigInt(Math.round(Number(percent)*100));
 const total=cents*BigInt(number),charge=(total*basisPoints+5000n)/10000n;
 return {amountCents:Number(cents),count:number,percent:Number(percent),base,totalCents:Number(total),chargeCents:Number(charge)};
}
export function sourceChargeQuestion(value){
 const unit=value.base==='remaining'?'remaining payments':value.base==='commitment'?'payments in the full commitment':'amount';
 const base=value.base==='amount'?money(value.totalCents):money(value.amountCents)+' per payment × '+value.count+' '+unit+' = '+money(value.totalCents);
 return 'Calculation to confirm: using '+base+', '+value.percent+'% gives '+money(value.chargeCents)+' (rounded to cents). Does this percentage and base apply to my purchase, and are there any other charges or adjustments?';
}
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
export function renderSourceCharge({offer,getSource,onAdd,onOpen}){
 const box=node('details','source-charge');box.append(node('summary','','Work out a charge'));
 const fields=node('div','source-charge-fields');
 const rate=node('select','source-charge-percent');rate.setAttribute('aria-label','Percentage from selected source');
 const basis=node('select','source-charge-base');basis.setAttribute('aria-label','Percentage base');
 for(const [value,text] of [['','Choose the percentage base'],['remaining','Remaining payments'],['commitment','Full commitment'],['amount','One amount']]){const o=node('option','',text);o.value=value;basis.append(o)}
 const amount=node('input','source-charge-amount');amount.type='text';amount.inputMode='decimal';amount.placeholder='0.00';amount.setAttribute('aria-label','Amount per payment in USD');
 const count=node('input','source-charge-count');count.type='text';count.inputMode='numeric';count.setAttribute('aria-label','Number of payments');
 const label=(text,control)=>{const l=node('label','');const span=node('span','',text);l.append(span,control);fields.append(l);return {label:l,span}};
 label('Percentage from selected source',rate);label('Percentage base',basis);const amountLabel=label('Amount per payment (USD)',amount),countLabel=label('Number of payments',count);
 const usePrice=node('button','ghost-button source-charge-use-price','Use offer price '+money(offer.amountCents));usePrice.type='button';
 const output=node('output','source-charge-result');output.setAttribute('aria-live','polite');
 const equation=node('p','source-charge-equation');
 const add=node('button','ghost-button source-charge-add','Add calculation to question');add.type='button';add.disabled=true;
 const feedback=node('p','source-charge-feedback');feedback.setAttribute('role','status');
 box.append(fields,usePrice,output,equation,add,feedback);
 let calculation=null;
 function percentages(){
  const previous=rate.value;rate.replaceChildren();const empty=node('option','','Choose a percentage');empty.value='';rate.append(empty);
  for(const n of sourcePercentages(getSource())){const o=node('option','',n+'%');o.value=String(n);rate.append(o)}
  rate.value=[...rate.options].some(o=>o.value===previous)?previous:'';
 }
 function update(){
  calculation=null;feedback.textContent='';output.textContent='';equation.textContent='';add.disabled=true;
  amountLabel.span.textContent=basis.value==='amount'?'Amount (USD)':'Amount per payment (USD)';countLabel.label.hidden=basis.value==='amount';
  countLabel.span.textContent=basis.value==='remaining'?'Payments remaining':basis.value==='commitment'?'Payments in the full commitment':'Number of payments';
  if(!basis.value||!amount.value.trim()||!rate.value||(basis.value!=='amount'&&!count.value.trim()))return;
  try{
   if(!sourcePercentages(getSource()).includes(Number(rate.value)))throw Error('Choose a percentage from the selected source.');
   calculation=calculateSourceCharge({amount:amount.value,count:count.value,percent:rate.value,base:basis.value});
   output.textContent='Calculated amount '+money(calculation.chargeCents);
   equation.textContent=(calculation.base==='amount'?money(calculation.totalCents):money(calculation.amountCents)+' × '+calculation.count+' = '+money(calculation.totalCents))+'; '+calculation.percent+'% of '+money(calculation.totalCents)+' = '+money(calculation.chargeCents)+'.';
   add.disabled=false;
  }catch(error){feedback.textContent=error.message}
 }
 percentages();
 box.addEventListener('toggle',()=>{if(box.open){percentages();update();onOpen?.()}});
 rate.addEventListener('focus',percentages);
 for(const control of [rate,basis,amount,count]){control.addEventListener('input',update);control.addEventListener('change',update)}
 usePrice.addEventListener('click',()=>{amount.value=(offer.amountCents/100).toFixed(2);update()});
 add.addEventListener('click',()=>{
  update();if(!calculation)return;
  const error=onAdd(sourceChargeQuestion(calculation));
  feedback.textContent=error||'Calculation added to your editable question.';
 });
 return box;
}
