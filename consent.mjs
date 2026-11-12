// Consent layer: spending rules, ask records (decided by a rule, the desktop or a phone) and the history of them.
// Kept out of server.mjs; createApp mounts it with a few lines. Nothing here talks to PayPal or to a model.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseRules,evaluate,purchaseFlags,detectCategory,fmtMoney} from './web/spend-rules.js';
import {qrSvg} from './qr.mjs';

const web=path.join(path.dirname(fileURLToPath(import.meta.url)),'web');
const STATIC={'/consent.js':['consent.js','text/javascript; charset=utf-8'],'/consent.css':['consent.css','text/css; charset=utf-8'],'/spend-rules.js':['spend-rules.js','text/javascript; charset=utf-8'],
  '/phone.js':['phone.js','text/javascript; charset=utf-8'],'/phone.css':['phone.css','text/css; charset=utf-8']};
const PHONE_HTML=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Approve a purchase</title><link rel="stylesheet" href="/phone.css"><script type="module" src="/phone.js"></script></head><body><main id="phone-root" aria-live="polite"><p class="phone-loading">Loading the cart…</p></main></body></html>`;
const ttl=15*60_000,weekMs=7*86400_000;
const isLoopback=a=>/^(127\.|::1$|::ffff:127\.)/.test(a||'');
const isPrivate=a=>{a=String(a||'').replace(/^::ffff:/,'');return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|f[cd][0-9a-f]{2}:|fe80:)/i.test(a)||isLoopback(a)};
export const lanPaths=p=>p==='/phone.js'||p==='/phone.css'||p==='/spend-rules.js'||/^\/phone\/[0-9a-f]{10}$/.test(p)||p==='/api/consent/phone'||p==='/api/consent/phone/answer';

export function lanAddress(){
  for(const list of Object.values(os.networkInterfaces()))for(const i of list||[])if(i.family==='IPv4'&&!i.internal&&isPrivate(i.address))return i.address;
  return null;
}
const err=(message,status=400)=>Object.assign(new Error(message),{status,expose:true});

export function createConsent({dir=null,now=()=>Date.now(),port=4178,env=process.env}={}){
  const file=dir?path.join(dir,'consent.json'):null;
  let rules=[],asks=[];
  const ready=(async()=>{
    if(!file)return;
    try{const saved=JSON.parse(await readFile(file,'utf8'));if(Array.isArray(saved.rules))rules=saved.rules.slice(0,60);if(Array.isArray(saved.asks))asks=saved.asks.slice(-300)}catch{}
  })();
  let tail=Promise.resolve();
  const save=()=>{if(!file)return;tail=tail.catch(()=>{}).then(async()=>{
    await mkdir(dir,{recursive:true,mode:0o700});
    const tmp=file+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';
    await writeFile(tmp,JSON.stringify({rules,asks:asks.slice(-300)}),{mode:0o600});await rename(tmp,file)}).catch(()=>{})};
  const spent=(period,category)=>{
    const since=now()-(period==='day'?86400_000:period==='month'?30*86400_000:weekMs);
    return asks.filter(a=>(a.status==='approved'||a.status==='allowed')&&a.at>=since&&(!category||a.category===category)).reduce((n,a)=>n+a.amountCents,0);
  };
  const expire=()=>{for(const a of asks)if(a.status==='pending'&&now()-a.at>ttl){a.status='expired';a.decidedAt=now()}};
  const pub=a=>{const {token,...rest}=a;return rest};
  const phoneUrl=a=>{
    const host=env.CONSENTCART_PHONE_HOST||lanAddress()||'127.0.0.1';
    return `http://${host}:${port}/phone/${a.id}?t=${a.token}`;
  };
  const withPhone=a=>({...pub(a),...(a.status==='pending'?{phoneUrl:phoneUrl(a),lan:!!(env.CONSENTCART_PHONE_HOST||lanAddress())}:{})});

  // A rule change makes earlier unanswered requests out of date; decided ones stay in the history.
  const invalidate=()=>{asks=asks.filter(a=>!(a.status==='pending'&&!a.sample));for(const a of asks)a.stale=true};
  function addRules(text){
    const parsed=parseRules(text);
    for(const r of parsed.rules){
      if(rules.some(x=>x.text.toLowerCase()===r.text.toLowerCase()))continue;
      rules.push({id:crypto.randomBytes(4).toString('hex'),enabled:true,createdAt:now(),...r});
    }
    rules=rules.slice(-60);if(parsed.rules.length)invalidate();save();
    return {rules,unparsed:parsed.unparsed,added:parsed.rules.length};
  }
  function createAsk(input){
    const amountCents=Math.round(Number(input.amountCents));
    if(!Number.isFinite(amountCents)||amountCents<1||amountCents>100_000_000)throw err('The cart needs a price.');
    const str=(v,n)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,n);
    const merchant=str(input.merchant,100),item=str(input.item,100),terms=str(input.terms,20000);
    const items=(Array.isArray(input.items)?input.items:[]).slice(0,30).map(i=>({name:str(i?.name,100),qty:Math.max(1,Math.min(99,Number(i?.qty)||1)),priceCents:Math.max(0,Math.round(Number(i?.priceCents)||0))})).filter(i=>i.name);
    const cart=items.length?items:[{name:item||'Purchase',qty:1,priceCents:amountCents}];
    const flags=purchaseFlags(terms+' '+(input.flagsText?str(input.flagsText,2000):''));
    const category=detectCategory([item,merchant,...cart.map(i=>i.name),terms.slice(0,600)].join(' '));
    expire();
    const sample=input.sample===true;
    if(!sample){
      const dup=asks.find(a=>!a.sample&&!a.stale&&a.merchant===merchant&&a.item===(item||cart[0].name)&&a.amountCents===amountCents&&['pending','allowed','approved'].includes(a.status)&&now()-a.at<10*60_000);
      if(dup)return dup;
    }
    const res=evaluate(rules,{amountCents,category,flags,text:[item,...cart.map(i=>i.name)].join(' ')},{spent});
    const base={id:crypto.randomBytes(5).toString('hex'),token:crypto.randomBytes(8).toString('hex'),at:now(),merchant,item:item||cart[0].name,amountCents,items:cart,category,flags,sample,
      verdict:res.verdict,ruleId:res.ruleId||null,ruleText:res.ruleText||null,reason:res.reason,reasons:res.reasons||[],gate:res.gate};
    const status=res.verdict==='allow'?'allowed':res.verdict==='block'?'blocked':'pending';
    const a={...base,status,by:res.verdict==='ask'?null:'rule',decidedAt:status==='pending'?null:now()};
    asks.push(a);asks=asks.slice(-300);save();
    return a;
  }
  const find=id=>{expire();return asks.find(a=>a.id===id)};
  function answer(a,decision,by){
    if(a.status!=='pending')throw err(a.status==='expired'?'This request expired. Ask again from the checkout.':'This request was already answered.',409);
    a.status=decision==='approve'?'approved':'declined';a.by=by;a.decidedAt=now();save();return a;
  }
  const sameHost=req=>{if(!req.headers.origin)return;let ok=false;try{ok=new URL(req.headers.origin).host===req.headers.host}catch{}if(!ok)throw err('Open this from the ConsentCart page.',403)};
  const tokenOk=(a,t)=>{const x=Buffer.from(String(a.token)),y=Buffer.from(String(t||''));return x.length===y.length&&crypto.timingSafeEqual(x,y)};

  // Returns true when the request was handled here.
  async function handle(req,res,url,{readJson,send}){
    await ready;
    const p=url.pathname,m=req.method;
    if(m==='GET'&&STATIC[p]){const [f,type]=STATIC[p];res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(await readFile(path.join(web,f)));return true}
    if(m==='GET'&&/^\/phone\/[0-9a-f]{10}$/.test(p)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(PHONE_HTML);return true}
    if(!p.startsWith('/api/consent/'))return false;
    const local=isLoopback(req.socket?.remoteAddress);
    // phone side: token-gated, reachable from the local network
    if(p==='/api/consent/phone'&&m==='GET'){
      const a=find(url.searchParams.get('id'));
      if(!a||!tokenOk(a,url.searchParams.get('t')))throw err('This approval link is not valid.',404);
      const {token,flags,reasons,ruleId,sample,gate,...v}=a;send(res,200,v);return true;
    }
    if(p==='/api/consent/phone/answer'&&m==='POST'){
      sameHost(req);const i=await readJson(req),a=find(i?.id);
      if(!a||!tokenOk(a,i?.t))throw err('This approval link is not valid.',404);
      if(!['approve','decline'].includes(i.decision))throw err('Choose approve or decline.');
      answer(a,i.decision,'phone');send(res,200,{status:a.status});return true;
    }
    if(!local)throw err('This is only available on the computer running ConsentCart.',403);
    if(m==='GET'&&p==='/api/consent/rules'){send(res,200,{rules});return true}
    if(m==='POST'&&p==='/api/consent/rules'){const i=await readJson(req);sameHost(req);send(res,200,addRules(String(i?.text||'').slice(0,2000)));return true}
    if(m==='POST'&&p==='/api/consent/rules/toggle'){sameHost(req);const i=await readJson(req),r=rules.find(x=>x.id===i?.id);if(!r)throw err('No such rule.',404);r.enabled=i.enabled!==false;invalidate();save();send(res,200,{rules});return true}
    if(m==='POST'&&p==='/api/consent/rules/remove'){sameHost(req);const i=await readJson(req);rules=rules.filter(x=>x.id!==i?.id);invalidate();save();send(res,200,{rules});return true}
    if(m==='POST'&&p==='/api/consent/ask'){sameHost(req);send(res,200,withPhone(createAsk(await readJson(req))));return true}
    if(m==='GET'&&p==='/api/consent/ask'){const a=find(url.searchParams.get('id'));if(!a)throw err('No such request.',404);send(res,200,withPhone(a));return true}
    if(m==='POST'&&p==='/api/consent/answer'){sameHost(req);const i=await readJson(req),a=find(i?.id);if(!a)throw err('No such request.',404);
      if(!['approve','decline'].includes(i.decision))throw err('Choose approve or decline.');answer(a,i.decision,'desktop');send(res,200,withPhone(a));return true}
    if(m==='GET'&&p==='/api/consent/history'){expire();send(res,200,{history:asks.slice(-100).reverse().map(pub)});return true}
    if(m==='GET'&&p==='/api/consent/qr'){
      const a=find(url.searchParams.get('id'));if(!a||a.status!=='pending')throw err('No pending request.',404);
      res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(qrSvg(phoneUrl(a)));return true;
    }
    return false;
  }
  // Anything arriving from another machine may only reach the phone approval routes.
  function guard(req,res,url){
    const a=req.socket?.remoteAddress;
    if(isLoopback(a))return false;
    if(isPrivate(a)&&lanPaths(url.pathname)){return false}
    res.writeHead(403,{'Content-Type':'text/plain'});res.end('Forbidden');return true;
  }
  return {handle,guard,rules:()=>rules,asks:()=>asks,addRules,createAsk,answer,find,fmtMoney};
}
