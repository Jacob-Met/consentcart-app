import {sourcePageAt} from './source-links.js';
// The reader and server share one exact, case-insensitive source lookup.
// No fuzzy matching: an AI quote cannot be presented as sourced if this lookup fails.
export function findQuoteRange(source,quote){
  if(typeof source!=='string'||typeof quote!=='string'||quote.length<8)return null;
  const start=source.toLocaleLowerCase().indexOf(quote.toLocaleLowerCase());
  return start<0?null:{start,end:start+quote.length};
}


// Prefer the server-provided exact interval so repeated wording navigates to
// the occurrence actually selected. Older saved reviews retain quote lookup.
export function factSourceRange(source,fact){
  const quote=fact?.quote;
  if(typeof quote!=='string'||quote.length<8)return null;
  const range=fact.sourceRange;
  if(range&&Number.isInteger(range.start)&&Number.isInteger(range.end)
    &&range.start>=0&&range.end<=source.length&&range.end>range.start
    &&source.slice(range.start,range.end)===quote)return {start:range.start,end:range.end};
  return findQuoteRange(source,quote);
}

// Intl can split after abbreviations before a capitalized example, even inside
// parentheses. Keep that original sentence together, including all qualifiers.
// Returned segments preserve every character and its original interval.
export function sourceSentences(source){
  const result=[];
  const openGroups=text=>[...text].reduce((n,c)=>n+(c==='('||c==='['?1:c===')'||c===']'?-1:0),0)>0;
  const abbreviation=/(?:\b(?:e\.g|i\.e|vs|Mr|Mrs|Ms|Dr|Prof|Inc|Corp|Ltd)|\b[A-Z])\.\s*$/i;
  for(const {segment,index} of new Intl.Segmenter('en',{granularity:'sentence'}).segment(source)){
    const previous=result.at(-1);
    const paragraphBreak=previous&&/\n\s*\n\s*$/.test(previous.segment);
    if(previous&&!paragraphBreak&&(abbreviation.test(previous.segment)||openGroups(previous.segment))){
      previous.segment+=segment;previous.end=index+segment.length;
    }else result.push({segment,index,end:index+segment.length});
  }
  return result;
}

// Presentation boundaries only: joining the returned chunks recovers every
// original character. No clause is dropped, rewritten or summarized.
export function readingPassages(quote){
  const chunks=[];let current='';
  for(const {segment} of sourceSentences(quote)){
    if(current.length>=240 && current.length+segment.length>480){chunks.push(current);current=''}
    current+=segment;
  }
  if(current)chunks.push(current);
  return chunks;
}

// Keep every supplied character in reading order. Highlighting records only
// which exact text the model selected; it is not a materiality/completeness score.
export function sourceReadingBlocks(source,facts=[],{keepRanges=[]}={}){
  const ranges=[];
  for(const [index,fact] of facts.entries()){
    const range=factSourceRange(source,fact);
    if(range)ranges.push({...range,index});
  }
  // A saved source link to a bounded paragraph must land in one readable block.
  // Preserve every byte while avoiding an artificial split inside that context.
  const chunks=[];let offset=0;
  for(const text of readingPassages(source)){
    if(chunks.length&&keepRanges.some(r=>r.start<offset&&r.end>offset))chunks[chunks.length-1]+=text;
    else chunks.push(text);
    offset+=text.length;
  }
  let position=0;
  return chunks.map(text=>{
    const start=position,end=start+text.length;position=end;
    const stops=[...new Set([start,end,...ranges.flatMap(r=>[r.start,r.end]).filter(n=>n>start&&n<end)])].sort((a,b)=>a-b);
    const parts=stops.slice(0,-1).map((a,i)=>{
      const b=stops[i+1],factIndexes=ranges.filter(r=>r.start<=a&&r.end>=b).map(r=>r.index);
      return {start:a,end:b,text:source.slice(a,b),selected:factIndexes.length>0,factIndexes};
    });
    return {start,end,text,parts};
  });
}


// Literal search across every supplied passage. Results retain complete reading
// context and exact source offsets; neither ranking nor a result cap omits matches.
export function searchSourcePassages(source,query){
  if(typeof source!=='string'||typeof query!=='string'||query.trim().length<2)return [];
  const pattern=new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
  let offset=0;
  const blocks=readingPassages(source).map(text=>{const start=offset;offset+=text.length;return {start,end:offset,text}});
  const results=[];
  for(let i=0;i<blocks.length;i++){
    pattern.lastIndex=0;
    const hit=pattern.exec(blocks[i].text);
    if(hit){
      const start=blocks[Math.max(0,i-1)].start,end=blocks[Math.min(blocks.length-1,i+1)].end;
      const matchStart=blocks[i].start+hit.index;
      results.push({start,end,text:source.slice(start,end),matchStart,matchEnd:matchStart+hit[0].length});
    }
  }
  return results;
}

// Collapse overlapping context windows without dropping any exact occurrence.
// The complete source remains in its original order and is always available.
export function groupedSourceSearch(source,query){
  const hits=searchSourcePassages(source,query),groups=[];
  for(const hit of hits){
    const last=groups.at(-1);
    if(last&&hit.start<=last.end){last.end=Math.max(last.end,hit.end);last.text=source.slice(last.start,last.end);}
    else groups.push({...hit});
  }
  if(!groups.length)return groups;
  const escaped=query.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  for(const group of groups){
    const pattern=new RegExp(escaped,'giu');group.matchRanges=[];
    for(const hit of group.text.matchAll(pattern))group.matchRanges.push({start:group.start+hit.index,end:group.start+hit.index+hit[0].length});
    group.matchStart=group.matchRanges[0].start;group.matchEnd=group.matchRanges[0].end;
  }
  return groups;
}

// Use explicit paragraph boundaries for nearby conditions. A flattened long policy
// is not one enormous card, and sentence offsets are never guessed or rewritten.

export function sourceNumberedClauseRanges(source){
 if(typeof source!=='string')return [];
 const labels=[...source.matchAll(/^[ \t]*(\d+(?:\.\d+)+)\.?[ \t]+(?=\S)/gm)];
 if(labels.length<2)return [];
 const major=[...source.matchAll(/^[ \t]*\d+[.)][ \t]+[A-Z][^\n]{1,90}$/gm)];
 return labels.map((label,i)=>{
  const start=label.index,page=sourcePageAt(source,start);
  let end=Math.min(labels[i+1]?.index??source.length,page?.end??source.length);
  const nextMajor=major.find(h=>h.index>start&&h.index<end);if(nextMajor)end=nextMajor.index;
  while(end>start&&/\s/.test(source[end-1]))end--;
  return {start,end};
 }).filter(r=>r.end>r.start);
}

export function sourceParagraphRange(source,range,{maxCharacters=1800}={}){
  if(typeof source!=='string'||!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)
    ||range.start<0||range.end>source.length||range.end<=range.start)return null;
  const numbered=sourceNumberedClauseRanges(source).find(r=>r.start<=range.start&&r.end>=range.end);
  if(numbered&&numbered.end-numbered.start<=maxCharacters)return numbered;
  // Some copied policies keep authored paragraphs as single lines without blank
  // lines. A short, complete multi-sentence line after a complete statement
  // is a bounded source unit; ordinary wrapped fragments are not.
  const completeLine=()=>{
    let start=source.lastIndexOf('\n',range.start-1)+1,end=source.indexOf('\n',range.end);
    if(start===0||end<0)return null;
    const raw=source.slice(start,end),text=raw.trim();start+=raw.indexOf(text);end=start+text.length;
    if(start>range.start||end<range.end||!text||text.length>maxCharacters||!/[.!?][”"']?$/.test(text)||sourceSentences(text).length<2)return null;
    const before=source.slice(0,Math.max(0,start)).trimEnd();
    if(before&&!/[.!?][”"']?$/.test(before))return null;
    return {start,end};
  };
  const breaks=[...source.matchAll(/\r?\n[ \t]*\r?\n+/g)];
  if(!breaks.length)return completeLine();
  let start=0,end=source.length;
  for(const gap of breaks){
    if(gap.index+gap[0].length<=range.start)start=gap.index+gap[0].length;
    else if(gap.index>=range.end){end=gap.index;break;}
    else if(gap.index<range.end&&gap.index+gap[0].length>range.start)return null;
  }
  // Copied policies sometimes put a numbered heading after only one newline.
  // Respect that explicit section boundary even inside a blank-line paragraph.
  for(const heading of source.matchAll(/^[ \t]*\d+[.)]\s+[^\n]{2,90}[ \t]*$/gm)){
    const a=heading.index,b=a+heading[0].length;
    if(b<=range.start&&b>start)start=b;
    else if(a>=range.end&&a<end)end=a;
  }
  // Respect other recognized copied headings inside a paragraph as well.
  for(const heading of sourceSectionHeadings(source)){
    if(heading.end<=range.start&&heading.end>start)start=heading.end;
    else if(heading.start>=range.end&&heading.start<end)end=heading.start;
  }
  // Preserve explicit inline subsection labels such as “Termination by Users.”
  // when copied text separates those authored paragraphs with single newlines.
  for(const label of source.matchAll(/^[ \t]*[A-Z][\p{L}\p{N} ’'/-]{0,70}\.[ \t]+(?=[A-Z])/gmu)){
    if(label.index<=range.start&&label.index>start)start=label.index;
    else if(label.index>=range.end&&label.index<end)end=label.index;
  }
  // A copied list can lose its bullet markers while keeping one complete
  // labelled item per line. When the whole list is too long for nearby context,
  // retain the complete matched line, not just its first matching sentence.
  // Multiple sibling labels establish the layout; a lone colon is not a list.
  if(end-start>maxCharacters){
    const labels=[...source.slice(start,end).matchAll(/^[ \t]*([A-Z][\p{L}\p{N} ,’'/-]{0,70}):[ \t]+(?=[A-Z0-9])/gmu)]
      .filter(m=>!/^(?:Note|Important|Exception|Exceptions|Condition|Conditions|Requirement|Requirements|Warning|For example)$/i.test(m[1]));
    if(labels.length>=2){
      const label=labels.findLast(m=>start+m.index<=range.start);
      if(label){
        const lineStart=start+label.index;
        const newline=source.indexOf('\n',lineStart);
        const lineEnd=newline<0?end:Math.min(end,newline);
        if(lineStart<=range.start&&lineEnd>=range.end&&lineEnd-lineStart<=maxCharacters){
          start=lineStart;end=lineEnd;
        }
      }
    }
  }
  const raw=source.slice(start,end),text=raw.trim();start+=raw.indexOf(text);end=start+text.length;
  return text&&text.length<=maxCharacters&&start<=range.start&&end>=range.end?{start,end}:completeLine();
}


// Extend only at the reader's explicit request; no relevance or eligibility is inferred.
export function extendSourceRange(source,range,direction){
 if(typeof source!=='string'||!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)
   ||range.start<0||range.end>source.length||range.end<=range.start||!['previous','next'].includes(direction))return null;
 const sentences=sourceSentences(source).map(({segment,index})=>{
  const text=segment.trim(),start=index+segment.indexOf(text);return {start,end:start+text.length,text};
 }).filter(p=>p.text);
 if(direction==='previous'){
  const previous=sentences.findLast(p=>p.start<range.start);
  return previous?{start:previous.start,end:range.end}:null;
 }
 const next=sentences.find(p=>p.end>range.end);
 return next?{start:range.start,end:next.end}:null;
}


// Keep literal document labels as context; they do not determine applicability.
export function sourceSectionHeadings(source){
 if(typeof source!=='string')return [];
 const headings=[];
 const helpHeading=/^(?:Cancel your subscription|How to cancel your subscription|What happens when you cancel|Delete your account|Data we instantly delete|Data we keep|How do I cancel my account or trial\\?)$/i;
 const generic=/^(?:free trial|subscription|cancellation|refunds?|returns?|renewal)(?: (?:terms|conditions|policy))?$/i;
 for(const m of source.matchAll(/^[ \t]*(\d+[.)]\s+[^\n]{2,90})[ \t]*$/gm))
  headings.push({text:m[1].trim(),start:m.index+m[0].indexOf(m[1]),end:m.index+m[0].indexOf(m[1])+m[1].trim().length,plan:false,generic:false,numbered:true});
 for(const m of source.matchAll(/^[ \t]*([^\n]{2,160}?)[ \t]*(?=\n|(?![\s\S]))/gm)){
  const text=m[1].trim();
  if(!text||/^Search help\s+Browse help articles(?:\s|$)/i.test(text)||(!helpHeading.test(text)&&/[.!?;:]/.test(text))||text.split(/\s+/).length>22||/^\d+[.)]/.test(text))continue;
  // Copied list continuations are prose even when extraction adds blank lines.
  if(/,(?:\s+(?:and|or))?$/i.test(text))continue;
  if(!generic.test(text)&&!helpHeading.test(text)&&/\b(?:you|your|we|our|they|their|it|must|shall|may|can|cannot|will|are|is|was|were|has|have|be|being|do|does|requires?|includes?|applies?|renews?|accepted|permitted|allowed|refunded|returned|charged)\b/i.test(text))continue;
  const start=m.index+m[0].indexOf(text);
  headings.push({text,start,end:start+text.length,generic:generic.test(text),plan:!generic.test(text)&&/\b(?:plans?|contracts?|prepaid|billed|month[- ]to[- ]month|annual|monthly|yearly)\b/i.test(text)});
 }
 const candidates=headings.sort((a,b)=>a.start-b.start).filter((h,i,a)=>!i||h.start!==a[i-1].start);
 const kept=[];
 // Browser copies can put adjacent heading levels on consecutive lines.
 // A wrapped prose fragment is not a heading unless the chain reaches a
 // paragraph boundary; finite-sentence lines were excluded above.
 for(const heading of candidates.toReversed()){
  const tail=source.slice(heading.end),next=kept.at(-1);
  // Copied heading-to-list boundaries can have one newline. Require an explicit
  // policy-scope noun and a complete following statement, not wrapped prose.
  const nextLine=tail.replace(/^[ \t]*\r?\n/,'').split(/\r?\n/,1)[0].trim();
  const policyScope=/\b(?:polic(?:y|ies)|information|requirements|conditions|exceptions|guidelines|instructions)$/i.test(heading.text);
  const statement=/^[A-Z]/.test(nextLine)&&/[.!?][\s\u00a0]*$/.test(nextLine)&&/\b(?:must|shall|may|can|cannot|will|are|is|have|has|should)\b/i.test(nextLine);
  if(heading.numbered||(policyScope&&statement)||/^[ \t]*\n[ \t]*\n/.test(tail)||/^[ \t]*$/.test(tail)
    ||(next&&/^[ \t]*\n[ \t]*$/.test(source.slice(heading.end,next.start))))kept.push(heading);
 }
 const ordered=kept.reverse();
 return ordered;
}
export function sourceSectionAt(source,position){
 const page=sourcePageAt(source,position);
 const headings=sourceSectionHeadings(source).filter(h=>!page||(h.start>=page.contentStart&&h.start<page.end)),at=headings.findLastIndex(h=>h.end<=position);
 const heading=headings[at];
 if(heading?.generic){const prior=headings.slice(0,at).findLast(h=>!h.generic);if(prior?.plan)return prior;}
 return heading||null;
}

export function sourceOccurrence(source,range){
 if(typeof source!=='string'||!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end>source.length||range.end<=range.start)return null;
 const quote=source.slice(range.start,range.end);let count=0,index=0,position=-1;
 while((position=source.indexOf(quote,position+1))!==-1){count++;if(position===range.start)index=count;}
 return count>1&&index?{index,count}:null;
}


export function sourceHeadingLocations(source){
 const headings=sourceSectionHeadings(source).filter(h=>!h.generic);
 const totals=new Map(),seen=new Map();
 for(const h of headings)totals.set(h.text,(totals.get(h.text)||0)+1);
 return headings.map(h=>{const index=(seen.get(h.text)||0)+1;seen.set(h.text,index);return {...h,index,count:totals.get(h.text)};});
}


export function sourceHeadingRange(source,start){
 if(typeof source!=='string'||!Number.isInteger(start))return null;
 const headings=sourceHeadingLocations(source),index=headings.findIndex(h=>h.start===start);
 if(index<0)return null;
 const heading=headings[index];
 const page=sourcePageAt(source,start);
 return {start:heading.start,end:Math.min(headings[index+1]?.start??source.length,page?.end??source.length),heading};
}

// This is the preceding literal heading, not an inferred parent or a claim
// that its product or region applies to the buyer.
export function sourceHeadingContext(source,start){
 const headings=sourceHeadingLocations(source),index=headings.findIndex(h=>h.start===start);
 if(index<0||!headings[index].plan)return null;
 const page=sourcePageAt(source,start);
 const preceding=headings.slice(0,index).filter(h=>!page||h.start>=page.contentStart),last=preceding.findLastIndex(h=>!h.plan);
 if(last<0)return null;
 let first=last;
 while(first>0&&!preceding[first-1].plan&&/^[ \t]*\n[ \t]*$/.test(source.slice(preceding[first-1].end,preceding[first].start)))first--;
 const contextStart=preceding[first].start,end=preceding[last].end;
 return {...preceding[last],start:contextStart,end,text:source.slice(contextStart,end)};
}
export function sourceHeadingLabel(source,start){
 const h=sourceHeadingLocations(source).find(h=>h.start===start);
 if(!h)return '';
 const context=sourceHeadingContext(source,start);
 return h.text+(context?' · '+context.text:'')+(h.count>1?' · '+h.index+' of '+h.count:'');
}

// A colon-led copied list and its explicitly marked footnote are one literal
// condition. This does not infer a list from nearby prose or a product heading.
export function sourceListRanges(source,{maxCharacters=1800}={}){
 if(typeof source!=='string')return [];
 const blocks=[];let cursor=0;
 for(const gap of source.matchAll(/\r?\n[ \t]*\r?\n+/g)){
  const raw=source.slice(cursor,gap.index),text=raw.trim();
  if(text)blocks.push({text,start:cursor+raw.indexOf(text),end:cursor+raw.indexOf(text)+text.length});
  cursor=gap.index+gap[0].length;
 }
 const raw=source.slice(cursor),text=raw.trim();
 if(text)blocks.push({text,start:cursor+raw.indexOf(text),end:cursor+raw.indexOf(text)+text.length});
 const ranges=[];
 for(let i=0;i<blocks.length-1;i++){
  const lead=blocks[i],list=blocks[i+1];
  if(!/:$/.test(lead.text))continue;
  const lines=list.text.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);
  if(lines.length<2||lines.some(t=>t.length>250||/[.!?]$/.test(t)))continue;
  let end=list.end;
  // A star in an item must have its original adjacent star note retained.
  const note=blocks[i+2];
  if(lines.some(t=>/\*$/.test(t))&&note&&/^\*/.test(note.text))end=note.end;
  if(end-lead.start<=maxCharacters)ranges.push({start:lead.start,end});
 }
 return ranges;
}

export function sourceNumberedReferences(source){
 const clauses=sourceNumberedClauseRanges(source),out=[];
 for(const match of source.matchAll(/\bSections?[ \t]+(\d+(?:\.\d+)+)(?!\d|\.\d|\()/g)){
  const start=match.index,end=start+match[0].length,page=sourcePageAt(source,start);
  const after=source.slice(end,end+100);
  if(/^[ \t]+(?:of|in|under)[ \t]+(?:another|a different|the separate)\b/i.test(after))continue;
  const targets=clauses.filter(r=>{
   const targetPage=sourcePageAt(source,r.start);
   if((page?.start??0)!==(targetPage?.start??0))return false;
   return new RegExp('^\\s*'+match[1].replaceAll('.','\\.')+'\\.?[ \\t]+').test(source.slice(r.start,r.end));
  });
  if(targets.length!==1||targets[0].end-targets[0].start>1800)continue;
  const target=targets[0];if(target.start<=start&&end<=target.end)continue;
  const origin=clauses.find(r=>r.start<=start&&r.end>=end);
  out.push({start,end,label:match[0],target:{...target},origin:origin&&origin.end-origin.start<=1800?{...origin}:null,number:match[1]});
 }
 return out;
}

export function sourceDefinedReferences(source){
 const clauses=sourceNumberedClauseRanges(source),definitions=[];
 for(const clause of clauses){
  const text=source.slice(clause.start,clause.end);
  const match=/^\s*\d+(?:\.\d+)+\.?[ \t]+[“"]([\p{L}\p{N}][\p{L}\p{N} -]{2,78})[”"][ \t]+means\b/u.exec(text);
  if(match&&match[1].trim().split(/\s+/).length>=2&&clause.end-clause.start<=1800)
   definitions.push({term:match[1],target:clause,pageStart:sourcePageAt(source,clause.start)?.start??0});
 }
 // Merchant pages also use a simple numbered or unnumbered quoted definition.
 // Reuse a complete bounded source paragraph; never link a guessed definition.
 for(const match of source.matchAll(/^[ \t]*(?:\d+[.)][ \t]+)?[“"]([\p{L}\p{N}][\p{L}\p{N} -]{2,78})[”"][ \t]+means\b/gmu)){
  if(match[1].trim().split(/\s+/).length<2)continue;
  const target=sourceParagraphRange(source,{start:match.index,end:match.index+match[0].length});
  if(!target||target.start!==match.index||definitions.some(d=>d.target.start===target.start&&d.target.end===target.end))continue;
  const page=sourcePageAt(source,target.start);
  if(page&&target.end>page.end)continue;
  definitions.push({term:match[1],target,pageStart:page?.start??0});
 }
 const out=[],seen=new Set();
 for(const definition of definitions){
  if(definitions.filter(d=>d.term===definition.term&&d.pageStart===definition.pageStart).length!==1)continue;
  let at=-1;
  while((at=source.indexOf(definition.term,at+1))>=0){
   const end=at+definition.term.length;
   if(/[\p{L}\p{N}_]/u.test(source[at-1]||'')||/[\p{L}\p{N}_]/u.test(source[end]||''))continue;
   if((sourcePageAt(source,at)?.start??0)!==definition.pageStart)continue;
   if(definition.target.start<=at&&end<=definition.target.end)continue;
   const key=at+':'+end;if(seen.has(key))continue;seen.add(key);
   const origin=clauses.find(r=>r.start<=at&&r.end>=end)||sourceParagraphRange(source,{start:at,end});
   out.push({start:at,end,label:definition.term,target:{...definition.target},origin:origin&&origin.end-origin.start<=1800?{...origin}:null,term:definition.term});
  }
 }
 return out.sort((a,b)=>a.start-b.start);
}
