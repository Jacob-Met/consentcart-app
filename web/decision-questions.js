import {currentBuyerQuestions,buyerSituationDetails,sourceGlance,selectedConditionGlances} from './clarification.js';
import {replyAssessmentLabel} from './saved-review.js';
import {showReviewScreen} from './review-navigation.js';
const controls=document.getElementById('checkout-controls');
const composer=document.getElementById('merchant-message');
const payment=document.getElementById('order-result');
const panel=document.createElement('section');panel.className='decision-questions';panel.hidden=true;
const title=document.createElement('h3');title.textContent='Questions you drafted';
const list=document.createElement('ul');
const review=document.createElement('button');review.type='button';review.className='ghost-button';review.textContent='Review questions';review.id='review-decision-questions';
panel.append(title,list,review);controls.before(panel);
function render(){
 const questions=currentBuyerQuestions();const add=document.getElementById('review-only-questions');if(add)add.hidden=questions.length>0;panel.hidden=!questions.length||(controls.hidden&&!['review','approval','approved','check','uncertain'].includes(payment.dataset.paymentState));
 list.replaceChildren(...questions.map(q=>{
  const item=document.createElement('li'),situation=buyerSituationDetails(q);
  if(situation!==null){
   item.className='buyer-case-row';
   const label=document.createElement('strong');label.textContent='Your situation — as entered';
   const facts=document.createElement('p');facts.className='buyer-case-facts';facts.textContent=situation;
   const prompt=document.createElement('p');prompt.className='buyer-case-prompt';prompt.textContent=q.text;
   item.append(label,facts,prompt);
  }else{
   item.textContent=q.text;
   if(q.reason){
    const glances=selectedConditionGlances(q.reason,q.text,document.getElementById('terms').value);
    if(glances.length>1){
     const wrap=document.createElement('div');wrap.className='buyer-terms-comparison';
     const heading=document.createElement('p');heading.className='buyer-terms-comparison-heading';
     heading.textContent='Compare '+glances.length+' selected conditions — ask the merchant which governs your purchase';
     wrap.append(heading);
     for(const [index,glance] of glances.slice(0,4).entries()){
      const condition=document.createElement('section');condition.className='buyer-condition-excerpt';
      const name=document.createElement('strong');name.textContent='Condition '+(index+1)+(glance.heading?' · '+glance.heading:'');
      const excerpt=document.createElement('p');excerpt.textContent=glance.text;
      condition.append(name,excerpt);
      if(glance.range){
       const jump=document.createElement('button');jump.type='button';jump.className='decision-source-jump';
       jump.textContent='Read this condition in original terms';
       jump.setAttribute('aria-label','Read condition '+(index+1)+' in the original merchant terms');
       jump.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('decision-source-jump',{detail:{range:glance.range,from:jump}})));
       condition.append(jump);
      }
      wrap.append(condition);
     }
     if(glances.length>4){
      const more=document.createElement('p');more.className='buyer-source-more';
      more.textContent=(glances.length-4)+' more selected conditions in the full context below';
      wrap.append(more);
     }
     item.append(wrap);
    }else{
     const glance=sourceGlance(q.reason,q.text);
     if(glance){
      const excerpt=document.createElement('p');excerpt.className='buyer-source-glance';excerpt.textContent=glance;
      item.append(excerpt);
     }
    }
    const details=document.createElement('details');details.className='question-context';
    const summary=document.createElement('summary');summary.textContent='Read complete selected context';
    const context=document.createElement('p');context.textContent=q.reason;
    details.append(summary,context);item.append(details);
   }
  }
  if(q.reply){
   const assessment=document.createElement('p');assessment.className='buyer-reply-assessment';
   assessment.textContent=replyAssessmentLabel(q)+' · Merchant identity not verified';
   const details=document.createElement('details');details.className='question-context recorded-reply';
   const summary=document.createElement('summary');summary.textContent='Reply you recorded';
   const text=document.createElement('p');text.textContent=q.reply;
   details.append(summary,text);item.append(assessment,details);
  }
  return item;
 }));
}
review.addEventListener('click',()=>{showReviewScreen('understand');const editor=document.getElementById('clarification-panel');editor.open=true;editor.scrollIntoView({block:'start',behavior:'instant'});document.getElementById('merchant-extra-question')?.focus({preventScroll:true});});
composer.addEventListener('input',render);composer.addEventListener('change',render);
document.getElementById('questions').addEventListener('input',render);document.getElementById('questions').addEventListener('change',render);
new MutationObserver(render).observe(composer,{childList:true});
new MutationObserver(render).observe(controls,{attributes:true,attributeFilter:['hidden']});
render();

new MutationObserver(render).observe(payment,{attributes:true,attributeFilter:['data-payment-state']});
