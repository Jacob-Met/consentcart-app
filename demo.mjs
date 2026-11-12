// Simulated demo: `npm run demo` (or `node demo.mjs`).
// Runs the normal app with an in-process fake PayPal Sandbox and a canned AI answer.
// Nothing here touches the network, reads PayPal keys, or needs a local model.
import {createApp} from './server.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const here=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT)||4178;
const origin=`http://127.0.0.1:${port}`;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));

// ---- fake PayPal (OAuth token, create order, get order, capture) ----
const orders=new Map();
const payPal=async(method,pathname,body)=>{
  if(pathname==='/v1/oauth2/token')return json({scope:'https://uri.paypal.com/services/payments/payment',access_token:'SIMULATED-ACCESS-TOKEN',token_type:'Bearer',app_id:'APP-SIMULATED',expires_in:32400,nonce:'simulated'});
  if(method==='POST'&&pathname==='/v2/checkout/orders'){
    const unit=body.purchase_units[0],id='SIM'+crypto.randomBytes(7).toString('hex').toUpperCase();
    const returnUrl=body.payment_source?.paypal?.experience_context?.return_url||origin+'/';
    orders.set(id,{id,status:'CREATED',unit,returnUrl,captures:[]});
    return json({id,status:'PAYER_ACTION_REQUIRED',links:[
      {href:`${origin}/api/v2/checkout/orders/${id}`,rel:'self',method:'GET'},
      {href:`${origin}/demo/paypal/approve?order=${id}`,rel:'payer-action',method:'GET'}]},201);
  }
  const m=pathname.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/),o=m&&orders.get(m[1]);
  if(!o)return json({name:'RESOURCE_NOT_FOUND',message:'The specified resource does not exist.'},404);
  const view=()=>({id:o.id,intent:'CAPTURE',status:o.status,payer:o.status==='CREATED'?undefined:{name:{given_name:'Simulated',surname:'Buyer'},email_address:'buyer@simulated.example'},
    purchase_units:[{reference_id:o.unit.reference_id,description:o.unit.description,amount:o.unit.amount,...(o.captures.length?{payments:{captures:o.captures}}:{})}],
    links:[{href:`${origin}/api/v2/checkout/orders/${o.id}`,rel:'self',method:'GET'}]});
  if(method==='GET'&&!m[2])return json(view());
  if(method==='POST'&&m[2]){
    if(o.status!=='APPROVED')return json({name:'UNPROCESSABLE_ENTITY',details:[{issue:'ORDER_NOT_APPROVED'}]},422);
    o.captures=[{id:'SIMCAP'+crypto.randomBytes(5).toString('hex').toUpperCase(),status:'COMPLETED',amount:o.unit.amount,final_capture:true}];
    o.status='COMPLETED';return json(view(),201);
  }
  return json({name:'NOT_FOUND'},404);
};

// ---- canned AI answer for the built-in sample (same wire shape as an OpenAI-compatible chat completion) ----
const model=async body=>{
  await wait(1200);
  const user=JSON.parse(body.messages.find(x=>x.role==='user').content);
  // Fixed rule for the sample: the clauses about returns, fees, final sale and damage.
  const ids=user.sourcePassages.filter(p=>/restocking fee|final sale|Returns are accepted|damaged|postage/i.test(p.text)).map(p=>p.id);
  return json({id:'chatcmpl-simulated',object:'chat.completion',model:'simulated',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({passageIds:ids})}}]});
};

const fakeFetch=async(url,init={})=>{
  const u=new URL(String(url)),body=typeof init.body==='string'&&init.body.startsWith('{')?JSON.parse(init.body):undefined;
  if(u.hostname==='api-m.sandbox.paypal.com')return payPal(init.method||'GET',u.pathname,body);
  if(u.hostname==='localhost'&&u.port==='1'&&u.pathname.endsWith('/chat/completions'))return model(body);
  throw new TypeError('Simulated demo: network access is disabled ('+u.hostname+')');
};

const env={CONSENTCART_SIMULATED:'1',PORT:String(port),PUBLIC_ORIGIN:origin,AI_BASE_URL:'http://localhost:1/v1',AI_MODEL:'simulated-canned-answer',AI_REVIEW_MODE:'source',AI_TIMEOUT_MS:'30000',
  PAYPAL_SANDBOX_CLIENT_ID:'SIMULATED',PAYPAL_SANDBOX_CLIENT_SECRET:'SIMULATED'};
const app=createApp({fetchImpl:fakeFetch,env,stateFile:null});

// ---- demo-only routes: approval page, badge assets, and the index with the badge ----
const CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"; // same as server.mjs
const page=(res,status,type,text,framable)=>{res.writeHead(status,{'Content-Type':type,'Content-Security-Policy':framable?CSP.replace("frame-ancestors 'none'",'frame-ancestors http: https:'):CSP,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(text)};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const orig=app.server.listeners('request')[0];
app.server.removeAllListeners('request');
app.server.on('request',async(req,res)=>{
  const url=new URL(req.url||'/',origin);
  if(app.consent.guard(req,res,url))return; // a phone on the network reaches only the approval page
  if(req.method==='GET'&&url.pathname==='/demo-badge.css')return page(res,200,'text/css; charset=utf-8',await readFile(path.join(here,'demo-badge.css')));
  if(req.method==='GET'&&url.pathname==='/demo-badge.js')return page(res,200,'text/javascript; charset=utf-8',"document.body.insertAdjacentHTML('afterbegin','<div class=\"sim-badge\" role=\"note\">Simulated demo: no real PayPal call</div>');");
  if(req.method==='GET'&&url.pathname==='/'){
    const html=(await readFile(path.join(here,'web','index.html'),'utf8')).replace('</head>','<link rel="stylesheet" href="/demo-badge.css"><script src="/demo-badge.js" defer></script></head>');
    return page(res,200,'text/html; charset=utf-8',html,url.searchParams.get('embed')==='1'); // embed mode: framable, as in server.mjs
  }
  if(url.pathname==='/demo/paypal/approve'){
    if(req.method==='POST'){
      let raw='';for await(const c of req)raw+=c;
      const o=orders.get(new URLSearchParams(raw).get('order'));
      if(!o)return page(res,404,'text/plain','Unknown simulated order.');
      if(new URLSearchParams(raw).get('action')==='cancel'){res.writeHead(303,{Location:o.returnUrl+'&cancel=1'});return res.end()}
      if(o.status==='CREATED')o.status='APPROVED';
      res.writeHead(303,{Location:`${o.returnUrl}&token=${o.id}&PayerID=SIMULATEDPAYER`});return res.end();
    }
    const o=orders.get(url.searchParams.get('order'));
    if(!o)return page(res,404,'text/plain','Unknown simulated order.');
    return page(res,200,'text/html; charset=utf-8',`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Simulated PayPal approval</title><link rel="stylesheet" href="/demo-badge.css"><script src="/demo-badge.js" defer></script></head><body class="sim-page"><main class="sim-card"><h1>Simulated PayPal approval</h1><p>This page stands in for PayPal's hosted approval page. No real PayPal account or card is involved.</p><p><b>${esc(o.unit.description)}</b><br>${esc(o.unit.amount.value)} ${esc(o.unit.amount.currency_code)}<br>Order ${esc(o.id)}</p><form method="post" action="/demo/paypal/approve"><input type="hidden" name="order" value="${esc(o.id)}"><button type="submit" name="action" value="approve" id="sim-approve">Approve</button> <button type="submit" name="action" value="cancel" class="sim-secondary">Cancel</button></form></main></body></html>`);
  }
  return orig(req,res);
});
const host=process.env.CONSENTCART_LAN==='0'?'127.0.0.1':'0.0.0.0';
app.server.listen(port,host,()=>console.log(`ConsentCart SIMULATED demo: ${origin}${host==='0.0.0.0'?'  (phone approval reachable on the local network)':''}\nFake PayPal Sandbox and a canned AI answer; no keys, no model, no network.`));
