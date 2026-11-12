// Spending rules in plain speech. Deterministic: a sentence is matched against fixed patterns, never sent to a model.
// Used by the server (authoritative), the browser (display) and the tests.
const WORDS={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const W='zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand';
const RUN=new RegExp(`\\b(?:a\\s+)?(?:${W})(?:[\\s-]+(?:and\\s+)?(?:${W}))*\\b`,'g');
export function numberWordsToDigits(s){
  return s.replace(RUN,run=>{
    let cur=0,total=0;
    for(const t of run.split(/[\s-]+/)){
      if(t==='a'||t==='and')continue;
      if(t==='hundred')cur=(cur||1)*100;
      else if(t==='thousand'){total+=(cur||1)*1000;cur=0}
      else cur+=WORDS[t];
    }
    return String(total+cur);
  });
}
const NUM='(\\d[\\d,]*(?:\\.\\d+)?)';
export function findMoney(text){
  const s=numberWordsToDigits(String(text).toLowerCase());
  const m=s.match(new RegExp(`\\$\\s*${NUM}`))||s.match(new RegExp(`${NUM}\\s*(?:dollars?|bucks?|usd)`))
    ||s.match(new RegExp(`(?:over|under|above|below|than|up to|upto|to|limit(?: of)?|max(?:imum)?|exceed(?:s|ing)?|within)\\s+\\$?${NUM}`));
  if(!m)return null;
  const v=Number(m[1].replace(/,/g,''));
  return Number.isFinite(v)&&v>0&&v<=1e6?Math.round(v*100):null;
}
export const fmtMoney=c=>{const d=c/100;return '$'+(Number.isInteger(d)?d.toLocaleString('en-US'):d.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))};

// ---- categories ----
export const CATEGORIES={
  groceries:['grocery','groceries','produce','pantry','supermarket','snack','food','milk','bread','vegetable','fruit','coffee beans','cereal','pasta','rice','eggs','cheese','meal kit'],
  electronics:['electronic','laptop','phone','charger','headphone','camera','tablet','cable','speaker','gadget','monitor'],
  clothing:['clothing','clothes','shirt','jacket','shoes','dress','apparel','jeans','sneaker'],
  books:['book','novel','ebook','magazine','textbook'],
  travel:['flight','hotel','airline','travel','booking','rental car','hostel'],
  gifts:['gift','present'],
  software:['software','app ','license','saas','download'],
};
const ALIASES={grocery:'groceries',food:'groceries',electronic:'electronics',gadgets:'electronics',clothes:'clothing',apparel:'clothing',book:'books',gift:'gifts',flights:'travel',hotels:'travel',apps:'software'};
const GENERIC=new Set(['anything','everything','something','me','it','this','that','purchases','purchase','things','stuff','one','any','each','every','all','the','a','an','my','whatever','orders','order','spending']);
const stem=w=>w.replace(/(ies)$/,'y').replace(/s$/,'');
export function canonicalCategory(word){const w=String(word||'').toLowerCase().trim();if(!w||GENERIC.has(w))return null;return ALIASES[w]||(CATEGORIES[w]?w:w)}
export function detectCategory(text){
  const s=' '+String(text||'').toLowerCase()+' ';
  let best=null,bestN=0;
  for(const [cat,keys] of Object.entries(CATEGORIES)){
    let n=0;for(const k of keys)if(s.includes(k.length<5||k.endsWith(' ')?' '+k.trim()+(k.endsWith(' ')?' ':''):k))n++;
    if(n>bestN){best=cat;bestN=n}
  }
  return best;
}
function ruleCategory(s){
  for(const cat of Object.keys(CATEGORIES))if(new RegExp(`\\b${cat}\\b`).test(s))return cat;
  for(const [a,c] of Object.entries(ALIASES))if(new RegExp(`\\b${a}\\b`).test(s))return c;
  const on=s.match(/\b(?:on|for)\s+([a-z]+)\b/);if(on&&!GENERIC.has(on[1])&&!/^(week|month|day|each|every|anything|me|a|the)$/.test(on[1]))return canonicalCategory(on[1]);
  const lead=s.match(/^([a-z]+)\s+(?:are|is)\s+(?:fine|ok|okay|allowed|good|alright)\b/);if(lead&&!GENERIC.has(lead[1]))return canonicalCategory(lead[1]);
  return null;
}

// ---- what a purchase says about itself ----
const NEG='(?:no|not|never|without|isn.t|is not|does not|doesn.t|cancel any ?time)';
const SUB=/\b(subscriptions?|auto-?renew\w*|renews? (?:automatically|every|each|monthly|annually|yearly)|recurring (?:charge|payment|billing|fee)s?|billed (?:monthly|annually|yearly|every)|per (?:month|year)|\/\s?(?:mo|month|yr|year)|membership fee|free trial)\b/i;
export function purchaseFlags(text){
  const t=String(text||'').replace(/\s+/g,' ');
  const sub=t.replace(new RegExp(`\\b${NEG}\\s+(?:\\w+\\s+){0,2}?(?:subscription|recurring|auto-?renew\\w*|renewal)s?\\b`,'gi'),' ');
  return {
    subscription:SUB.test(sub),
    restocking:/restocking fee/i.test(t)&&!new RegExp(`\\b${NEG}\\s+(?:\\w+\\s+){0,2}?restocking`,'i').test(t),
    finalSale:/\bfinal sale\b|\ball sales (?:are )?final\b/i.test(t)&&!new RegExp(`\\b${NEG}\\s+(?:\\w+\\s+){0,2}?final sale`,'i').test(t),
    nonRefundable:/\bnon-?refundable\b|\bno refunds?\b|\bnot refundable\b/i.test(t),
  };
}
const FLAGS={
  subscription:{re:/\b(subscriptions?|recurring|auto-?renew\w*|memberships?)\b/,label:'subscriptions',noun:'a subscription or recurring charge'},
  restocking:{re:/\brestocking\b/,label:'restocking fees',noun:'a restocking fee'},
  finalSale:{re:/\bfinal[- ]sale\b|\ball sales final\b/,label:'final-sale items',noun:'final-sale items'},
  nonRefundable:{re:/\bnon-?refundable\b|\bno[- ]refunds?\b|\bnot refundable\b/,label:'non-refundable purchases',noun:'a non-refundable purchase'},
};

// ---- parsing ----
const ASK=/\b(ask(?:ing)?|check|confirm|approv\w*|permission|run (?:it )?by|tell|warn|flag|let me know|okay with me|ok with me|my say)\b/;
const NEGATIVE=/\b(no|never|don.?t|do not|not|avoid|block|stop|nothing|without)\b/;
const OVER=/\b(over|above|more than|exceed(?:s|ing)?|greater than|higher than|beyond|larger than|bigger than|costs? more than)\b/;
const UNDER=/\b(under|below|less than|up to|upto|at most|within|max(?:imum)?|limit(?: of)?|fine up to)\b/;
const ALLOWW=/\b(fine|ok|okay|alright|allowed?|good|go ahead|approve automatically|auto-?approve|auto-?allow|without asking|no need to ask|don.?t ask|don.?t need to ask|automatic(?:ally)?|let (?:it|them) through)\b/;
const PERIOD=/\b(?:a|per|each|every|\/)\s*(day|week|month)\b|\b(daily|weekly|monthly)\b/;
const PERIODS={daily:'day',weekly:'week',monthly:'month'};
const clean=t=>String(t||'').replace(/\s+/g,' ').trim();

export function parseRule(raw){
  const text=clean(raw).replace(/^[-*\d.)\s]+(?=\D)/,'').slice(0,200);
  if(text.length<3)return null;
  let s=numberWordsToDigits(text.toLowerCase()).replace(/[.!?]+$/,'');
  s=s.replace(/\b(?:no|not) more than\b/g,'up to').replace(/\b(?:please|ok so|okay so|so|also|and then|i want|i want you to|i'd like|i would like)\b/g,' ').replace(/\s+/g,' ').trim();
  const cents=findMoney(s);
  const ask=ASK.test(s)||/\bwithout asking\b/.test(s)&&!ALLOWW.test(s.replace('without asking',''))&&OVER.test(s);
  // 1. terms the person does not want to agree to
  for(const [flag,f] of Object.entries(FLAGS)){
    if(!f.re.test(s))continue;
    if(cents&&(OVER.test(s)||UNDER.test(s)))continue; // a money rule that merely mentions the word
    if(/\b(fine|ok|okay|allowed?)\b/.test(s)&&!NEGATIVE.test(s))continue;
    const effect=ASK.test(s)?'ask':'block';
    return {kind:'flag',flag,effect,text,gloss:effect==='ask'?`Ask you first when a purchase has ${f.noun}.`:`Decline automatically when a purchase has ${f.noun}.`};
  }
  const category=ruleCategory(s);
  const pm=s.match(PERIOD),period=pm?(PERIODS[pm[2]||pm[1]]||pm[1]||pm[2]):null;
  const where=category?` on ${category}`:'';
  // 2. a ceiling: "never over fifty dollars without asking me"
  if(cents&&OVER.test(s)){
    const effect=ask?'ask':'block';
    return {kind:'over',effect,cents,category,text,gloss:effect==='ask'?`Ask you before any purchase${where} over ${fmtMoney(cents)}.`:`Decline any purchase${where} over ${fmtMoney(cents)}.`};
  }
  // 3. an allowance: "groceries are fine up to a hundred a week"
  if(cents&&(UNDER.test(s)||ALLOWW.test(s))&&!(NEGATIVE.test(s)&&!ALLOWW.test(s))){
    const per=period||'purchase';
    return {kind:'within',effect:'allow',cents,category,period:per,text,
      gloss:`Allow${category?' '+category:' purchases'} without asking up to ${fmtMoney(cents)} ${per==='purchase'?'per purchase':'a '+per}.`};
  }
  if(cents&&ask)return {kind:'over',effect:'ask',cents,category,text,gloss:`Ask you before any purchase${where} over ${fmtMoney(cents)}.`};
  return null;
}
export function parseRules(input){
  const parts=String(input||'').split(/[\n;]+|(?<=[.!?])\s+|,\s*(?=(?:and\s+)?(?:no|never|ask|don.?t|groceries|anything)\b)/i).map(clean).filter(Boolean);
  const rules=[],unparsed=[];
  for(const p of parts){const r=parseRule(p);if(r)rules.push(r);else unparsed.push(p)}
  return {rules,unparsed};
}

// ---- evaluation ----
// purchase: {amountCents, category, flags}; ctx.spent(period, category) -> cents already approved in that period.
const PERIOD_LABEL={day:'today',week:'this week',month:'this month'};
export function evaluate(rules,purchase,ctx={}){
  const on=(rules||[]).filter(r=>r.enabled!==false);
  const amount=purchase.amountCents,cat=purchase.category||null,flags=purchase.flags||{};
  const catMatch=r=>!r.category||r.category===cat||(cat&&stem(r.category)===stem(cat))||(purchase.text&&purchase.text.toLowerCase().includes(stem(r.category)));
  const hit=(r,reason)=>({ruleId:r.id,ruleText:r.text,reason});
  const asks=[];
  for(const r of on.filter(r=>r.kind==='flag'))if(flags[r.flag]){
    const h=hit(r,r.effect==='block'?`You said no ${FLAGS[r.flag].label}, and this purchase has ${FLAGS[r.flag].noun}.`:`This purchase has ${FLAGS[r.flag].noun}, and you asked to be asked.`);
    if(r.effect==='block')return {verdict:'block',...h,reasons:[h.reason],gate:true};
    asks.push(h);
  }
  for(const r of on.filter(r=>r.kind==='over'))if(amount>r.cents&&catMatch(r)){
    const h=hit(r,`${fmtMoney(amount)} is over your ${fmtMoney(r.cents)} limit${r.category?' on '+r.category:''}.`);
    if(r.effect==='block')return {verdict:'block',...h,reasons:[h.reason],gate:true};
    asks.push({...h,generic:!r.category});
  }
  const gate=on.length>0;
  let capped=null,fit=null;
  for(const r of on.filter(r=>r.kind==='within'&&catMatch(r))){
    if(r.period==='purchase'){
      if(amount<=r.cents){fit=fit||hit(r,`${fmtMoney(amount)} fits your rule: ${r.gloss.replace(/\.$/,'').toLowerCase()}.`)}
      else capped=capped||hit(r,`${fmtMoney(amount)} is more than the ${fmtMoney(r.cents)} you allow${r.category?' for '+r.category:''}.`);
    }else{
      const spent=ctx.spent?ctx.spent(r.period,r.category):0;
      if(spent+amount<=r.cents)fit=fit||hit(r,`${r.category?r.category[0].toUpperCase()+r.category.slice(1):'Purchases'} are fine up to ${fmtMoney(r.cents)} a ${r.period}: ${fmtMoney(spent)} used ${PERIOD_LABEL[r.period]}, ${fmtMoney(amount)} more stays within it.`);
      else capped=capped||hit(r,`${fmtMoney(spent)} already used ${PERIOD_LABEL[r.period]} plus ${fmtMoney(amount)} is over your ${fmtMoney(r.cents)} a ${r.period}${r.category?' for '+r.category:''}.`);
    }
  }
  // a specific allowance ("groceries up to $100 a week") outranks a general ceiling ("ask over $50"), never a fee or subscription rule
  if(fit&&asks.every(a=>a.generic))return {verdict:'allow',...fit,reasons:[],gate};
  if(asks.length)return {verdict:'ask',...asks[0],reasons:asks.map(a=>a.reason),gate};
  if(fit)return {verdict:'allow',...fit,reasons:[],gate};
  if(capped)return {verdict:'ask',...capped,reasons:[capped.reason],gate};
  const ceil=on.find(r=>r.kind==='over'&&r.effect==='ask'&&!r.category);
  if(ceil)return {verdict:'allow',...hit(ceil,`${fmtMoney(amount)} is within your ${fmtMoney(ceil.cents)} limit and has nothing you asked to be told about.`),reasons:[],gate};
  if(!on.length)return {verdict:'ask',ruleId:null,ruleText:null,reason:'You have no spending rules yet, so this one is yours to decide.',reasons:[],gate:false};
  return {verdict:'ask',ruleId:null,ruleText:null,reason:'None of your rules cover this purchase, so it needs your OK.',reasons:[],gate};
}

// A soft picture for an item: a tinted tile with its initial, so the cart is shown item by item without remote images.
export function tileFor(name){
  let h=0;for(const c of String(name||'?'))h=(h*31+c.charCodeAt(0))%360;
  return {hue:h,initial:(String(name||'?').trim()[0]||'?').toUpperCase()};
}
