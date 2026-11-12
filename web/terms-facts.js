import {sourceSentences,sourceNumberedClauseRanges,sourceParagraphRange,sourceListRanges,sourceSectionHeadings,sourceHeadingLocations,sourceHeadingRange,sourceHeadingContext,sourceHeadingLabel} from './source.js';
import {isRefundTiming} from './refund-timing.js';
import {policyTextBeforeCopiedLinks,sourcePageAt,sourcePageRanges} from './source-links.js';
import {qualifyTermHeadline} from './term-qualifications.js';
// A literal index into the supplied terms. Values and conditions stay attached
// to their exact source sentences; ambiguous groups never become a single rule.
// Match the source wording without converting written numbers into a promise.
const numberWord='(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)';
const quantity='(?:\\d+(?:\\.\\d+)?|'+numberWord+'(?:[ -]+(?:'+numberWord+'|and))*|a|an)';
const time = new RegExp('\\b'+quantity+'(?:\\s*(?:[–-]|to)\\s*'+quantity+')?\\s+(?:(?:business|calendar)\\s+)?(?:hours?|days?|weeks?|months?|years?)\\b','gi');
const percent = /\b\d+(?:\.\d+)?\s*%/g;
const exchange = /\b(?:exchanges?|exchanged|exchanging)\b/i;
const exchangeWording=text=>exchange.test(text)&&!/\b(?:exchange[ -]+rates?|(?:currency|foreign|stock)[ -]+exchange)\b/i.test(text);
// Returning or destroying copied website material is an intellectual-property
// obligation, not a merchandise return. Remove only that explicit phrase from
// topic detection; a separate refund/return promise in the sentence still counts.
// Withdrawal from a purchase is a cancellation condition, unlike withdrawal
// of cash or privacy consent. Its complete paragraph retains the buyer scope.
const purchaseWithdrawal=text=>/\bwithdraw(?:al|ing|n|s)?\b/i.test(text)
 && /\b(?:purchase|sales? contract|order|subscription)\b/i.test(text)
 && !/\bwithdraw(?:al|ing|n|s)?\s+(?:(?:your|the|any)\s+)?(?:consent|cash|funds|money)\b|\b(?:cash|bank|funds?) withdrawal\b/i.test(text);

const returnTopic=text=>{
 const topicText=/\b(?:website|copyright|intellectual property|breach|unauthori[sz]ed)\b/i.test(text)
  ?text.replace(/\breturn\s+or\s+destroy\s+(?:(?:any|all|the|such|your)\s+)*(?:copies|materials)\b/gi,'')
  :text;
 return purchaseWithdrawal(topicText)||isRefundTiming(topicText)||/\b(?:return(?:s|ed|ing)?|refund(?:s|ed|ing|able)?)\b/i.test(topicText)||exchangeWording(topicText);
};
// Index literal refusal wording, preserving its full conditions and negation.
const returnRefusal=t=>returnTopic(t)&&/\b(?:do(?:es)? not|don['’]t|doesn['’]t|cannot|can['’]t|unable to)\s+(?:(?:accept|provide|offer|give|issue)\s+)?(?:(?:a|the|your)\s+)?(?:returns?|refunds?|exchange)\b|\b(?:returns?|refunds?|exchanges?)\s+(?:are|is|will be|can be|may be)\s+(?:not\s+(?:accepted|available|allowed|permitted)|refused|excluded)\b/i.test(t);
// Cancelling a redeemable key is a refund prerequisite, not a promise that a
// buyer can cancel the purchase. Keep the full wording in Returns.
const cancellationTopic=text=>{
 const withoutKeys=text.replace(/\bcancel(?:lation|l?ed|l?ing)?\s+(?:of\s+)?(?:(?:the|your|an?)\s+)?(?:(?:external|activation|licen[cs]e|game)\s+)?keys?\b/gi,'')
  .replace(/\b(?:(?:external|activation|licen[cs]e|game)\s+)?keys?\s+(?:(?:must|may|can|will|shall)\s+)?(?:be\s+)?cancel(?:l?ed|lation)\b/gi,'');
 return purchaseWithdrawal(withoutKeys)||/\bcancel(?:lation|l?ed|l?ing|s)?\b/i.test(withoutKeys);
};
const returnExclusion=t=>returnRefusal(t)||/\b(?:ineligible for return|not eligible for return|(?:may not|cannot|can['’]t) be returned)\b/i.test(t);
const contextRows=new Set(['returns','renewal','cancellation','refund-time']);
const timedRows=new Set(['returns','cancellation','dispatch','delivery','refund-time']);
const clauses=text=>{
 const durations=[...text.matchAll(new RegExp(time.source,time.flags))];
 const parts=[];let start=0;
 for(const split of text.matchAll(/;\s*|,\s+|\s+(?:and|but|whereas|while)\s+/gi)){
  // “and” inside “one hundred and two days” belongs to the quantity.
  if(durations.some(m=>split.index>=m.index&&split.index<m.index+m[0].length))continue;
  parts.push(text.slice(start,split.index));start=split.index+split[0].length;
 }
 parts.push(text.slice(start));return parts;
};
const definitions = [
  {id:'returns', label:'Returns', required:true, match:t=>returnTopic(t)&&!isRefundTiming(t)&&!/(return\s+(postage|shipping)|restock|refund[- ]processing|refund processing|processing time)/i.test(t), metric:time},
  // Keep amount qualifications as complete clauses, never a computed refund.
  {id:'refund-amount', label:'Refund amount', match:t=>clauses(t).some(part=>/\brefund(?:s|ed|able)?\b/i.test(part)&&/\b(?:net (?:purchase )?price|deduct(?:ed|ion|ions)?|less (?:the|any))\b/i.test(part)), metric:/(?!)/g},
  {id:'postage', label:'Return postage', match:t=>/return\s+(postage|shipping|freight)|(?:postage|shipping).{0,35}(?:buyer|customer|return)/i.test(t), metric:/\b(?:customers? pay|buyers? pay|paid by the (?:buyer|customer)|seller pays|merchant pays|free returns?|at your expense)\b/gi},
  {id:'fees', label:'Return fee', match:t=>/restock|return fee/i.test(t), metric:percent},
  {id:'exceptions', label:'Exceptions', match:t=>returnExclusion(t)||/final sale|non[- ]?refundable|not refundable|no refunds|no returns|personalized|personalised|lose the right to refund/i.test(t), metric:/\b(?:final sale|non[- ]?refundable|not refundable|no refunds|no returns)\b/gi},
  {id:'renewal', label:'Renewal', required:true, match:t=>/subscri|renew|recurr/i.test(t), metric:/\b(?:no subscription|does not (?:automatically )?renew|will not (?:automatically )?renew|auto[- ]renew(?:s|al)?|automatically renew|monthly|annually|yearly|every (?:month|year|week))\b/gi},
  {id:'cancellation', label:'Cancellation', match:cancellationTopic, metric:time},
  {id:'dispatch', label:'Dispatch', match:t=>/dispatch/i.test(t)&&!/deliver/i.test(t)&&!returnTopic(t), metric:time},
  {id:'delivery', label:'Delivery', match:t=>/deliver|shipping|shipment/i.test(t)&&!returnTopic(t), metric:time},
  {id:'refund-time', label:'Refund timing', match:isRefundTiming, metric:new RegExp('\\b(?:not specified|not stated|not provided)\\b|'+time.source,'gi')}
];

export function termsFactRows(source){
  if(typeof source!=='string')return [];
  const policySource=policyTextBeforeCopiedLinks(source);
  const lists=sourceListRanges(policySource),numbered=sourceNumberedClauseRanges(policySource);
  const headings=sourceSectionHeadings(policySource).filter(h=>!lists.some(r=>h.start>=r.start&&h.end<=r.end));
  // Explicit help-menu and related-article sections are navigation, not terms.
  // Keep their text in the original reader; a following source heading ends
  // the navigation range so that a copied article body remains available.
  const navigationHeading=/^(?:related (?:articles|topics|links)|browse (?:help )?(?:library|topics)|(?:help|support) (?:topics|categories)|quick (?:links|tools))$/i;
  const navigationRanges=headings.filter(h=>navigationHeading.test(h.text)).map(h=>{
    const next=headings.find(n=>n.start>h.start);
    return {start:h.start,end:next?.start??policySource.length};
  });
  // A short explicit cancellation/refund subsection can qualify a rule across
  // paragraphs. Keep that bounded original block together, without inferring
  // hierarchy or joining text across the next source heading.
  const conditionRange=passage=>{
    const clause=numbered.find(r=>r.start<=passage.start&&r.end>=passage.end);if(clause&&clause.end-clause.start<=1800)return clause;
    const list=lists.find(r=>r.start<=passage.start&&r.end>=passage.end);
    if(list)return list;
    const page=sourcePageAt(source,passage.start);
    const within=headings.filter(h=>!page||(h.start>=page.contentStart&&h.start<page.end));
    const at=within.findLastIndex(h=>h.end<=passage.start);
    const heading=within[at];
    if(heading&&(/^(?:cancellation|refunds?|returns?)(?: (?:terms|conditions|policy))?$/i.test(heading.text)||/\breturn policy$/i.test(heading.text)||/^(?:what happens (?:when|after) you cancel(?: your (?:subscription|account))?|delete your account)$/i.test(heading.text))){
      let start=heading.end,end=within[at+1]?.start??page?.end??policySource.length;
      while(start<end&&/\s/.test(policySource[start]))start++;
      while(end>start&&/\s/.test(policySource[end-1]))end--;
      if(start<=passage.start&&end>=passage.end&&end-start<=(heading.generic?1800:900))return {start,end};
    }
    return sourceParagraphRange(policySource,passage);
  };
  // A copied heading is a boundary even when the browser omitted a blank line.
  // Split before sentence indexing so that a following requirement cannot borrow
  // the preceding subsection's label. The complete source and offsets stay intact.
  const boundaries=[...new Set([0,policySource.length,...headings.flatMap(h=>[h.start,h.end]),...numbered.flatMap(r=>[r.start,r.end]),
    ...[...policySource.matchAll(/(?<=\n)(?=[ \t]*\r?\n)/g)].map(m=>m.index)])].sort((a,b)=>a-b);
  const sentences=boundaries.slice(0,-1).flatMap((offset,i)=>
    sourceSentences(policySource.slice(offset,boundaries[i+1])).map(p=>({...p,index:p.index+offset})))
    .map(({segment,index})=>{const text=segment.trim(),start=index+segment.indexOf(text);return {text,start,end:start+text.length}})
    .filter(p=>p.text&&!headings.some(h=>h.start===p.start&&h.end===p.end)&&!/^(?:\d+[.)]?\s*)?(?:returns?|refunds?|exchanges?|subscriptions?|renewals?|cancellations?)[\s:.-]*$/i.test(p.text));
  const sectionAt=position=>{
    const page=sourcePageAt(source,position);
    const within=headings.filter(h=>!page||(h.start>=page.contentStart&&h.start<page.end));
    const at=within.findLastIndex(h=>h.end<=position);let heading=within[at];
    if(heading?.generic){const prior=within.slice(0,at).findLast(h=>!h.generic);if(prior?.plan)heading=prior;}
    return heading?.label||heading?.text||'';
  };
  return definitions.flatMap(def=>{
    const passages=sentences.filter(p=>!navigationRanges.some(r=>p.start>=r.start&&p.end<=r.end)&&def.match(p.text));
    if(!passages.length&&!def.required)return [];
    const metrics=texts=>[...new Set(texts.flatMap(text=>[...text.matchAll(new RegExp(def.metric.source,def.metric.flags))].map(m=>m[0])))];
    const originalValues=metrics(passages.map(p=>p.text));
    // A sentence can discuss several purchase rules. A refund-processing time
    // is not a cancellation deadline merely because both share that sentence.
    const values=timedRows.has(def.id)?metrics(passages.flatMap(p=>clauses(p.text).filter(def.match))):originalValues;
    const unrelatedMetric=originalValues.some(value=>!values.includes(value));
    // Multiple passages are not collapsed into one apparently universal rule.
    // The delivery group can include address/price clauses; its time remains a
    // literal navigation cue, with every matching sentence highlighted together.
    const negation=/\b(?:no|not|never|without|cannot)\b|\b\w+n['’]t\b/i;
    const negatedMetric=passages.some(p=>negation.test(p.text))&&values.some(value=>!negation.test(value));
    const ambiguous=negatedMetric || unrelatedMetric || originalValues.length>1 || (passages.length>1&&def.id!=='delivery');
    const value=def.id==='refund-amount'?passages.length+' '+(passages.length===1?'clause':'clauses'):!passages.length?'Read terms':ambiguous?(passages.length>1?passages.length+' clauses':'Read terms'):values[0]||'Read terms';
    const caution=!passages.length||ambiguous||def.id==='exceptions'||def.id==='fees'||/not (?:specified|stated|provided)/i.test(value);
    let detail='';
    if(passages.length===1&&['returns','fees','exceptions','renewal','cancellation','refund-time'].includes(def.id)){
      const p=passages[0].text;
      if(p.length<=175)detail=p;
    }
    if(def.id==='delivery'){
      const timed=passages.filter(p=>new RegExp(time.source,'i').test(p.text));
      if(timed.length===1&&timed[0].text.length<=175)detail=timed[0].text;
    }
    // A multi-rule return policy needs its actual conditional wording, not
    // only a count. Exact repeated sentences share an entry while all original
    // original locations remain available. No numeric rule is inferred here.
    const conditionClauses=[],additionalClauses=[];
    if((contextRows.has(def.id)&&(passages.length>1||passages.some(p=>{const r=conditionRange(p);return p.text.length>175||r&&(r.start<p.start||r.end>p.end)})))||def.id==='refund-amount'||def.id==='exceptions'){
      const byText=new Map();
      for(const passage of passages){
        const range=contextRows.has(def.id)?conditionRange(passage):def.id==='exceptions'?lists.find(r=>r.start<=passage.start&&r.end>=passage.end)||sourceParagraphRange(policySource,passage):null;
        const context=range?{...range,text:source.slice(range.start,range.end)}:passage;
        const key=context.text;
        const entry=byText.get(key);
        if(entry){
          if(!entry.passages.some(p=>p.start===context.start&&p.end===context.end))entry.passages.push(context);
          entry.matchedPassages.push(passage);
        }else byText.set(key,{text:context.text,passages:[context],matchedPassages:[passage]});
      }
      for(const entry of byText.values())(def.id==='refund-amount'||def.id==='exceptions'||def.id==='renewal'||def.id==='cancellation'||new RegExp(time.source,'i').test(entry.text)?conditionClauses:additionalClauses).push(entry);
      // A policy without a numeric deadline still has usable conditions. Show
      // its exact buyer-facing request/eligibility wording instead of only a count.
      if(def.id==='returns'&&!conditionClauses.length){
        const relevant=additionalClauses.filter(entry=>/\b(?:eligible|eligibility|request|require|cannot|unable|entitle|only|unless)\b/i.test(entry.text));
        const visible=relevant.length?relevant:[...additionalClauses];
        conditionClauses.push(...visible);
        for(const entry of visible)additionalClauses.splice(additionalClauses.indexOf(entry),1);
      }

    }
    if(conditionClauses.length){
      const entries=[...conditionClauses,...additionalClauses];
      const sections=new Set(entries.flatMap(entry=>entry.matchedPassages.map(p=>sectionAt(p.start))).filter(Boolean));
      if(sections.size){
        for(const entry of entries){
          entry.sourceSections=[...new Set(entry.matchedPassages.map(p=>sectionAt(p.start)).filter(Boolean))];
          entry.sourceLocations=entry.passages.map(p=>({...p,heading:sectionAt(p.start)}));
        }
        // Prefer the explicit returns section while retaining remote restrictions
        // and every exact occurrence. A source's own summary follows its full rules.
        const rank=entry=>(entry.sourceSections.some(t=>/^\d+[.)]\s+(?:returns?|refunds?)(?:\s+policy)?[.:]?$/i.test(t))?0:1)+(/^Summary\b/.test(entry.text)?2:0);
        if(def.id==='returns'){
          // A processing duration inside expanded context must not outrank the
          // source's actual return window. Rank literal request/deadline wording.
          const windowRank=entry=>entry.matchedPassages.some(p=>!isRefundTiming(p.text)&&((purchaseWithdrawal(p.text)&&new RegExp(time.source,'i').test(p.text))||/\b(?:return(?:ed|s)?|refund request(?:s)?)\b[\s\S]{0,180}\b(?:within|through|between)\b/i.test(p.text)||/\b(?:within|have)\b[\s\S]{0,90}\b(?:days?|weeks?|months?)\b[\s\S]{0,90}\breturn\b/i.test(p.text)))?0:1;
          entries.sort((a,b)=>windowRank(a)-windowRank(b)||rank(a)-rank(b)||(windowRank(a)===0?a.passages[0].start-b.passages[0].start:0));
        }
        conditionClauses.splice(0,conditionClauses.length,...entries);
        additionalClauses.splice(0);
      }
    }
    if(def.id==='returns'){
      // General introductions to unspecified conditions follow the conditions
      // themselves. Preserve both original grouping and order among actual rules.
      const introduction=entry=>/\b(?:a few|some|certain|following)\s+(?:simple\s+)?(?:conditions|requirements)\b/i.test(entry.text)
        && !new RegExp(time.source,'i').test(entry.text)
        && !/\b(?:must|shall|required|only|unless)\b/i.test(entry.text);
      for(const entries of [conditionClauses,additionalClauses])entries.sort((a,b)=>Number(introduction(a))-Number(introduction(b)));
    }
    if(def.id==='exceptions'&&conditionClauses.length)detail='';
    const label=def.id==='returns'&&passages.some(p=>exchangeWording(p.text))?'Returns & exchanges':def.label;
    const contextPassages=[];
    for(const passage of conditionClauses.length?[...conditionClauses,...additionalClauses].flatMap(entry=>entry.passages):passages){
      if(!contextPassages.some(p=>p.start===passage.start&&p.end===passage.end))contextPassages.push(passage);
    }
    return [qualifyTermHeadline({id:def.id,label,value,detail,caution,passages,contextPassages,conditionClauses,additionalClauses})];
  });
}

export function termClauseParts(text){
 const parts=[];let cursor=0;
 for(const match of text.matchAll(new RegExp(time.source,time.flags))){
  if(match.index>cursor)parts.push({text:text.slice(cursor,match.index),emphasized:false});
  parts.push({text:match[0],emphasized:true});cursor=match.index+match[0].length;
 }
 if(cursor<text.length)parts.push({text:text.slice(cursor),emphasized:false});
 return parts;
}

function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
export function termsFactRowsForSection(source,start){
 const range=sourceHeadingRange(source,start);
 if(!range)return termsFactRows(source);
 const shift=p=>({...p,start:p.start+range.start,end:p.end+range.start});
 return termsFactRows(source.slice(range.start,range.end)).map(row=>({
  ...row,passages:row.passages.map(shift),contextPassages:row.contextPassages.map(shift),
  conditionClauses:row.conditionClauses.map(entry=>({...entry,passages:entry.passages.map(shift),matchedPassages:entry.matchedPassages.map(shift),sourceLocations:entry.sourceLocations?.map(shift)})),
  additionalClauses:row.additionalClauses.map(entry=>({...entry,passages:entry.passages.map(shift),matchedPassages:entry.matchedPassages.map(shift),sourceLocations:entry.sourceLocations?.map(shift)}))
 }));
}

export function termsFactEntryOrigins(source,entry){
 return entry.passages.map(p=>{const page=sourcePageAt(source,p.start);return {start:p.start,end:p.end,url:page?.url||null,...(page?.filename?{filename:page.filename,pageStart:page.start}:{})}});
}
export function termsFactReadingEntries(source,row,{focused=false}={}){
 let entries=termsFactDisplayEntries(row);
 if(row.id==='cancellation'){
  const effect=entry=>entry.matchedPassages.some(p=>/\bcancellation (?:occurs|takes effect)\b|\b(?:will|shall) cancel (?:at|on)\b|\bcancel(?:led|ed)? (?:immediately|at the end)\b/i.test(p.text))?0:entry.matchedPassages.some(p=>/^(?:Cancellation[.:]\s*)?(?:You may|You can|To|If you) cancel\b|^Cancellation[.:]/i.test(p.text))?1:2;
  entries=entries.sort((a,b)=>effect(a)-effect(b));
 }
 if(entries.length||(!focused&&sourcePageRanges(source).length<2))return entries;
 return row.passages.map(p=>({text:p.text,passages:[p],matchedPassages:[p]}));
}
export function renderTermsFacts(host,{source,onSelect,onAsk}){
 host.replaceChildren();
 const sections=sourceHeadingLocations(source).filter(h=>h.plan);
 const prior=host.sourceReadingSection;
 let start=prior?.source===source&&sections.some(h=>h.start===prior.start)?prior.start:null;
 const rowsHost=node('div','terms-fact-section-rows');
 const multiplePages=sourcePageRanges(source).length>1;
 let topic=host.sourceReadingTopic?.source===source?host.sourceReadingTopic.topic:'';
 const topicLabel=node('label','terms-section-label',multiplePages?'Compare a condition across pages':'Read a purchase condition');
 const topicSelect=node('select','terms-section-select terms-topic-select');topicSelect.setAttribute('aria-label',multiplePages?'Compare a purchase condition across original pages':'Read a purchase condition');
 const allTopics=node('option',null,'All purchase conditions');allTopics.value='';topicSelect.append(allTopics);
 for(const row of termsFactRows(source).filter(r=>r.passages.length)){
  const option=node('option',null,row.label);option.value=row.id;topicSelect.append(option);
 }
 if(![...topicSelect.options].some(o=>o.value===topic))topic='';
 topicSelect.value=topic;topicLabel.append(topicSelect);
 const label=node('label','terms-section-label','Read source section');
 const select=node('select','terms-section-select');select.setAttribute('aria-label','Read an original source section');
 const all=node('option',null,'All pasted terms');all.value='';select.append(all);
 for(const h of sections){
  const option=node('option',null,sourceHeadingLabel(source,h.start));option.value=String(h.start);select.append(option);
 }
 select.value=start===null?'':String(start);label.append(select);
 const scope=node('p','terms-section-scope');scope.setAttribute('role','status');
 const reset=node('button','terms-section-reset','Show all pasted terms');reset.type='button';
 const update=()=>{
  host.sourceReadingSection={source,start};host.sourceReadingTopic={source,topic};
  host.closest('.purchase-layout')?.classList.toggle('conditions-comparison',Boolean(multiplePages&&topic));
  const context=start===null?null:sourceHeadingContext(source,start);
  scope.textContent=start===null?'':context?'Preceding source heading: '+context.text:'Selected source section';scope.hidden=start===null;reset.hidden=start===null;
  return renderFactRows(rowsHost,{source,onSelect,onAsk,start,topic});
 };
 topicSelect.addEventListener('change',()=>{topic=topicSelect.value;start=null;select.value='';update()});
 select.addEventListener('change',()=>{start=select.value===''?null:Number(select.value);update()});
 reset.addEventListener('click',()=>{start=null;select.value='';update();select.focus()});
 if(topicSelect.options.length>1)host.append(topicLabel);
 if(sections.length>1)host.append(label,scope,reset);
 else start=null;
 host.append(rowsHost);return update();
}

// Bring an explicit return prerequisite into the initial card alongside its
// windows. Rank only matching source sentences, never an unrelated requirement
// picked up by paragraph expansion. Every original entry remains reachable.
export function termsFactDisplayEntries(row){
 const entries=[...row.conditionClauses,...row.additionalClauses];
 if(row.id==='renewal'){
  const rank=entry=>entry.matchedPassages.some(p=>/\brenew(?:s|ed|ing|al)?\b/i.test(p.text))?0:
   entry.matchedPassages.some(p=>/\brecurr(?:ing|ence)?\b/i.test(p.text))?1:2;
  return entries.sort((a,b)=>rank(a)-rank(b));
 }
 if(row.id!=='returns'||entries.length<=3)return entries;
 const prerequisite=entries.findIndex(entry=>entry.matchedPassages.some(p=>
  returnTopic(p.text)&&/\b(?:must|need(?:s)? to|required|requirement)\b/i.test(p.text)
 ));
 if(prerequisite>=3)entries.splice(2,0,...entries.splice(prerequisite,1));
 return entries;
}

function renderFactRows(host,{source,onSelect,onAsk,start=null,topic=''}){
  host.replaceChildren();
  const rows=start===null?termsFactRows(source):termsFactRowsForSection(source,start);
  for(const row of rows.filter(r=>!topic||r.id===topic)){
    const button=node('button','terms-fact'+(row.caution?' terms-fact-attention':''));
    button.type='button';button.dataset.fact=row.id;button.setAttribute('aria-pressed','false');
    const heading=node('span','terms-fact-heading');
    heading.append(node('span','terms-fact-name',row.label),node('strong','terms-fact-value',row.value));
    button.append(heading);
    if(row.detail&&!row.conditionClauses.length)button.append(node('span','terms-fact-detail',row.detail));
    button.setAttribute('aria-label',row.label+': '+row.value+'. Read the original terms.');
    button.addEventListener('click',()=>{
      for(const other of host.querySelectorAll('button'))other.setAttribute('aria-pressed',String(other===button));
      onSelect({...row,passages:row.contextPassages},button);
    });
    host.append(button);
    const readingEntries=topic||sourcePageRanges(source).length>1?termsFactReadingEntries(source,row,{focused:Boolean(topic)}):termsFactDisplayEntries(row);
    if(readingEntries.length){
      const list=node('div','terms-fact-clauses');
      let extra=null;
      const entries=readingEntries;
      const groups=new Map(),chosen=new Map(),groupPages=Boolean(topic&&sourcePageRanges(source).length>1);
      let ask=null;
      if(topic&&onAsk){
        ask=node('button','terms-compare-ask','Select conditions to draft a question');ask.type='button';ask.disabled=true;
        ask.addEventListener('click',()=>onAsk({label:row.label,passages:[...chosen.values()].flatMap(e=>e.passages.map(p=>({...p,text:source.slice(p.start,p.end)})))},ask));
        host.append(ask);
      }
      if(groupPages)list.classList.add('terms-page-comparison');
      if(topic&&!groupPages){const page=sourcePageRanges(source)[0],url=page?.url;if(page?.filename)list.append(node('p','terms-clause-page','Source file: '+page.filename));if(url){const a=node('a','terms-clause-page',url);a.href=url;a.target='_blank';a.rel='noopener noreferrer';list.append(a)}}
      entries.forEach((entry,index)=>{
        const link=node('button','terms-fact-clause');link.type='button';
        link.dataset.factClause=row.id;link.setAttribute('aria-pressed','false');
        const copy=node('span','terms-clause-copy');
        for(const part of termClauseParts(entry.text))copy.append(part.emphasized?node('strong',null,part.text):document.createTextNode(part.text));
        const arrow=node('span','terms-clause-arrow','↗');arrow.setAttribute('aria-hidden','true');
        if(entry.sourceSections?.length){
          const section=node('span','terms-clause-section',entry.sourceSections[0]);
          copy.prepend(section);
        }
        link.append(copy,arrow);link.setAttribute('aria-label',entry.text+' Read the original terms.');
        link.addEventListener('click',()=>{
          for(const other of host.querySelectorAll('button'))other.setAttribute('aria-pressed',String(other===link));
          onSelect({...row,passages:entry.passages},link);
        });
        const item=node('div','terms-fact-entry');
        const origins=termsFactEntryOrigins(source,entry),urls=[...new Set(origins.map(p=>p.url).filter(Boolean))];
        const filenames=[...new Set(origins.map(p=>p.filename).filter(Boolean))];
        if(filenames.length&&!topic)for(const name of filenames)item.append(node('p','terms-clause-page','Source file: '+name));
        if(urls.length&&(!topic||urls.length>1)){
          const pages=node('div','terms-clause-pages');
          for(const url of urls){const a=node('a','terms-clause-page',url);a.href=url;a.target='_blank';a.rel='noopener noreferrer';pages.append(a)}
          item.append(pages);
        }
        item.append(link);
        if(ask){
          const label=node('label','terms-compare-choice'),check=node('input');check.type='checkbox';check.dataset.conditionStart=String(entry.passages[0].start);
          check.setAttribute('aria-label','Include this condition in a merchant question: '+entry.text);
          label.append(check,node('span',null,'Use in question'));item.append(label);
          check.addEventListener('change',()=>{if(check.checked)chosen.set(index,entry);else chosen.delete(index);ask.disabled=!chosen.size;ask.textContent=chosen.size?'Draft question with '+chosen.size+' '+(chosen.size===1?'condition':'conditions'):'Select conditions to draft a question'});
        }
        if(entry.passages.length>1){
          const locations=node('details','terms-source-locations');
          locations.append(node('summary',null,(entry.passages.length-1)+' other source '+(entry.passages.length===2?'location':'locations')));
          for(const [i,passage] of entry.passages.slice(1).entries()){
            const heading=entry.sourceLocations?.[i+1]?.heading;
            const origin=origins[i+1]?.url||origins[i+1]?.filename;
            const location=node('button','terms-fact-location',[origin,heading].filter(Boolean).join(' — ')||'Source occurrence '+(i+2));
            location.type='button';location.dataset.sourceStart=String(passage.start);location.setAttribute('aria-pressed','false');
            location.setAttribute('aria-label',(heading||'Original wording')+'. Read source occurrence '+(i+2)+'.');
            location.addEventListener('click',()=>{
              for(const other of host.querySelectorAll('button'))other.setAttribute('aria-pressed',String(other===location));
              onSelect({...row,passages:[passage]},location);
            });
            locations.append(location);
          }
          item.append(locations);
        }
        if(groupPages){
          const file=origins.find(p=>p.filename),key=urls[0]||(file?'file:'+file.pageStart:''),label=urls[0]||(file?'Source file: '+file.filename:'Pasted terms');
          let group=groups.get(key);
          if(!group){
            const section=node('section','terms-page-group');
            const title=node('h3','terms-page-title');
            if(urls[0]){const a=node('a',null,label);a.href=urls[0];a.target='_blank';a.rel='noopener noreferrer';title.append(a)}
            else title.textContent=label;
            section.append(title);list.append(section);group={section,count:0,more:null};groups.set(key,group);
          }
          if(group.count===0)group.section.append(item);
          else{
            if(!group.more){group.more=node('details','terms-page-more');group.more.append(node('summary'));group.section.append(group.more)}
            group.more.append(item);group.more.querySelector('summary').textContent=group.count+' more '+(group.count===1?'condition':'conditions')+' from this page';
          }
          group.count++;
        }else if(topic||index<3)list.append(item);
        else{
          if(!extra){extra=node('details','terms-clauses-more');extra.open=entries.length<=5;extra.append(node('summary',null,(entries.length-3)+' other conditions'));list.append(extra)}
          extra.append(item);
        }
      });
      host.append(list);
    }
  }
  return rows;
}
