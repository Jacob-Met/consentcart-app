import {MAX_AI_SOURCE_CHARACTERS} from './web/offer-limits.js';
import http from 'node:http';
import {fetchMerchantSource} from './merchant-source.mjs';
import {readFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import {readFileSync,lstatSync} from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import {createModelClient,createPayPalClient,normalizeOffer,digestOffer,inputError,inspectPayPalOrder} from './engine.mjs';

import {renderReviewRecord} from './review-record.mjs';
import {savedBuyerQuestions,savedSourceSection,savedSourceTopic} from './web/saved-review.js';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'web');
const staticMap={'/pdf-page-navigation.js':['pdf-page-navigation.js','text/javascript; charset=utf-8'],'/original-pdfs.js':['original-pdfs.js','text/javascript; charset=utf-8'],'/pdf-source.js':['pdf-source.js','text/javascript; charset=utf-8'],'/vendor/pdfjs/pdf.min.mjs':['vendor/pdfjs/pdf.min.mjs','text/javascript; charset=utf-8'],'/vendor/pdfjs/pdf.worker.min.mjs':['vendor/pdfjs/pdf.worker.min.mjs','text/javascript; charset=utf-8'],'/source-import.js':['source-import.js','text/javascript; charset=utf-8'],'/source-import.css':['source-import.css','text/css; charset=utf-8'],'/source-charge.js':['source-charge.js','text/javascript; charset=utf-8'],'/source-charge.css':['source-charge.css','text/css; charset=utf-8'],'/draft-recovery.js':['draft-recovery.js','text/javascript; charset=utf-8'],'/refund-timing.js':['refund-timing.js','text/javascript; charset=utf-8'],'/source-links.js':['source-links.js','text/javascript; charset=utf-8'],'/copied-source-links.js':['copied-source-links.js','text/javascript; charset=utf-8'],'/decision-questions.js':['decision-questions.js','text/javascript; charset=utf-8'],'/offer-limits.js':['offer-limits.js','text/javascript; charset=utf-8'],'/comparison-topics.js':['comparison-topics.js','text/javascript; charset=utf-8'],'/comparison-topics.css':['comparison-topics.css','text/css; charset=utf-8'],'/term-qualifications.js':['term-qualifications.js','text/javascript; charset=utf-8'],'/terms-facts.js':['terms-facts.js','text/javascript; charset=utf-8'],'/comparison-draft.js':['comparison-draft.js','text/javascript; charset=utf-8'],'/comparison-find.js':['comparison-find.js','text/javascript; charset=utf-8'],'/comparison-find.css':['comparison-find.css','text/css; charset=utf-8'],'/review-continuity.js':['review-continuity.js','text/javascript; charset=utf-8'],'/model-readiness.js':['model-readiness.js','text/javascript; charset=utf-8'],'/offer-draft.js':['offer-draft.js','text/javascript; charset=utf-8'],'/source-reader.js':['source-reader.js','text/javascript; charset=utf-8'],'/review-navigation.js':['review-navigation.js','text/javascript; charset=utf-8'],'/saved-review.js':['saved-review.js','text/javascript; charset=utf-8'],'/offer-comparison.js':['offer-comparison.js','text/javascript; charset=utf-8'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/clarification.js':['clarification.js','text/javascript; charset=utf-8'],'/source.js':['source.js','text/javascript; charset=utf-8'],'/compare.js':['compare.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};


// Local OCR bundles are explicitly allowlisted. Neither documents nor language
// recognition requests leave this server.
for(const file of ['tesseract.esm.min.js','worker.min.js'])
  staticMap['/vendor/tesseract/'+file]=['vendor/tesseract/'+file,'text/javascript; charset=utf-8'];
staticMap['/vendor/tesseract/lang/eng.traineddata.gz']=['vendor/tesseract/lang/eng.traineddata.gz','application/gzip'];
staticMap['/vendor/tesseract/lang/spa.traineddata.gz']=['vendor/tesseract/lang/spa.traineddata.gz','application/gzip'];
for(const suffix of ['','-lstm','-simd','-simd-lstm','-relaxedsimd','-relaxedsimd-lstm'])
 for(const ext of ['.wasm.js','.wasm']){
  const file='tesseract-core'+suffix+ext;
  staticMap['/vendor/tesseract/core/'+file]=['vendor/tesseract/core/'+file,
    ext==='.wasm'?'application/wasm':'text/javascript; charset=utf-8'];
 }
staticMap['/scanned-ocr.js']=['scanned-ocr.js','text/javascript; charset=utf-8'];

export function createApp({fetchImpl=globalThis.fetch,env=process.env,now=()=>Date.now(),stateFile=null,sourceClient=fetchMerchantSource}={}) {
  const ai=createModelClient({fetchImpl,env}), paypal=createPayPalClient({fetchImpl,env});
  const sessions=new Map();const ttl=45*60_000;let activeSourceImports=0;
  // A restart must not detach an already-approved Sandbox order from the exact reviewed terms.
  // Test instances opt out by default. The actual local launcher uses a private on-disk store.
  if(stateFile){
    let saved;
    try {
      const info=lstatSync(stateFile);
      if(!info.isFile()||info.isSymbolicLink())throw new Error('State path must be a regular private file.');
      if(process.platform!=='win32'&&(info.mode&0o077)!==0)throw new Error('State file must not be readable by other users.');
      saved=JSON.parse(readFileSync(stateFile,'utf8'));
    }catch(error){
      if(error.code!=='ENOENT')throw new Error('Cannot safely recover ConsentCart reviews: '+error.message);
    }
    if(saved){
      if(saved.version!==1||!Array.isArray(saved.sessions))throw new Error('Unrecognized ConsentCart review storage format.');
      for(const entry of saved.sessions){
        if(!Array.isArray(entry)||entry.length!==2)throw new Error('Malformed stored review entry.');
        const [id,s]=entry;
        if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)||!s||typeof s!=='object'
          ||!Number.isFinite(s.created)||s.created>now()+60_000
          ||!['review','pending_buyer','captured','refunded','partially_refunded'].includes(s.status)
          ||!s.offer||!s.analysis||digestOffer(normalizeOffer(s.offer))!==s.digest
          ||(s.status==='review'&&s.order)
          ||(s.status!=='review'&&(!s.order||!/^[A-Z0-9]{4,40}$/.test(s.order.id||'')
             ||!/^https:\/\/www\.sandbox\.paypal\.com\//.test(s.order.approval||'')))
          ||(['captured','refunded','partially_refunded'].includes(s.status)&&!s.captureId))throw new Error('Stored buyer review failed integrity checks.');
        if(s.buyerQuestions!==undefined)s.buyerQuestions=savedBuyerQuestions(s.buyerQuestions);
        if(s.sourceSection!==undefined)s.sourceSection=savedSourceSection(s.offer.terms,s.sourceSection);
        if(s.sourceTopic!==undefined)s.sourceTopic=savedSourceTopic(s.offer.terms,s.sourceTopic);
        if(s.order||now()-s.created<ttl)sessions.set(id,{...s,busy:false});
      }
    }
  }
  let writeTail=Promise.resolve();
  async function persist(){
    if(!stateFile)return;
    const next=writeTail.catch(()=>{}).then(async()=>{
      const directory=path.dirname(stateFile);
      await mkdir(directory,{recursive:true,mode:0o700});
      const temporary=stateFile+'.'+crypto.randomUUID()+'.tmp';
      try{
        const file=await open(temporary,'wx',0o600);
        try{
          const entries=[...sessions].map(([id,s])=>[id,{
            offer:s.offer,analysis:s.analysis,digest:s.digest,created:s.created,
            status:s.status,order:s.order,captureId:s.captureId||null,paymentObservation:s.paymentObservation||null,
            ...(s.sourceSection?{sourceSection:s.sourceSection}:{}),...(s.sourceTopic?{sourceTopic:s.sourceTopic}:{}),...(s.buyerQuestions!==undefined?{buyerQuestions:s.buyerQuestions}:{})
          }]);
          await file.writeFile(JSON.stringify({version:1,sessions:entries}));
          await file.sync();
        }finally{await file.close()}
        await rename(temporary,stateFile);
      }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error})}
    });
    writeTail=next;
    await next;
  }
  const port=Number(env.PORT)||4178;
  const origin=env.PUBLIC_ORIGIN||`http://127.0.0.1:${port}`;
  if(!/^https:\/\//.test(origin)&&!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))throw new Error('PUBLIC_ORIGIN must be HTTPS or local loopback.');
  async function prune(){let removed=false;for(const [id,s] of sessions)if(!s.order&&!s.busy&&now()-s.created>ttl){sessions.delete(id);removed=true}if(removed)await persist()}
  async function readJson(req){
    let chunks=[],length=0;
    for await (const chunk of req){length+=chunk.length;if(length>512_000)throw inputError('Request exceeds the 512 KB limit.',413);chunks.push(chunk)}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw inputError('Expected a JSON object.',400)}
  }
  function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    try {
      await prune();const url=new URL(req.url||'/',origin);
      if(req.method==='GET'&&staticMap[url.pathname]){const [file,type]=staticMap[url.pathname];res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(await readFile(path.join(root,file)));return}
      if(req.method==='GET'&&url.pathname==='/api/config'){send(res,200,{ai:ai.configured,aiTimeoutSeconds:Math.ceil(ai.timeoutMs/1000),reviewMode:ai.mode,paypal:paypal.configured,sandbox:true});return}
      if(req.method==='POST'&&url.pathname==='/api/import-source'){
        if(req.headers.origin){let same=false;try{same=new URL(req.headers.origin).host===req.headers.host}catch{}if(!same)throw inputError('Open source import from this ConsentCart page.',403)}
        if(activeSourceImports>=2)throw inputError('Another page is being imported. Try again in a moment.',429);
        activeSourceImports++;
        try{const input=await readJson(req);send(res,200,await sourceClient(input?.url));}finally{activeSourceImports--}
        return;
      }
      if(['GET','POST'].includes(req.method)&&url.pathname==='/api/review-record'){
        const input=req.method==='POST'?await readJson(req):null;
        const s=sessions.get(input?input.id:url.searchParams.get('id'));
        if(!s)throw inputError('This review is no longer available. Review the offer again before saving a copy.',404);
        if(s.busy)throw inputError('Checkout is updating. Wait for it to finish before saving a copy.',409);
        let buyerQuestions=s.buyerQuestions||[],sourceSection=s.sourceSection||null,sourceTopic=s.sourceTopic||null;
        if(input){
          if(input.digest!==s.digest)throw inputError('The saved questions no longer match this reviewed offer.',409);
          try{buyerQuestions=savedBuyerQuestions(input.buyerQuestions)}catch(error){throw inputError(error.message)}
          if(input.sourceSection!==undefined)try{sourceSection=savedSourceSection(s.offer.terms,input.sourceSection)}catch(error){throw inputError(error.message)}
          if(input.sourceTopic!==undefined)try{sourceTopic=savedSourceTopic(s.offer.terms,input.sourceTopic)}catch(error){throw inputError(error.message)}
          if(input.retain===true){s.buyerQuestions=buyerQuestions;s.sourceSection=sourceSection;s.sourceTopic=sourceTopic;await persist();}
        }
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="ConsentCart-purchase-review.html"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.end(renderReviewRecord({...s,buyerQuestions,sourceSection,sourceTopic},now()));return;
      }
      if(req.method==='GET'&&url.pathname==='/api/review'){
        const id=url.searchParams.get('id');
        const s=typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)?sessions.get(id):null;
        if(!s)throw inputError('This review is no longer available. Start a new review or open your saved copy.',404);
        send(res,200,{id,digest:s.digest,analysis:s.analysis,sourceSection:s.sourceSection||null,sourceTopic:s.sourceTopic||null,...(s.buyerQuestions!==undefined?{buyerQuestions:s.buyerQuestions}:{}),
          offer:{merchant:s.offer.merchant,itemName:s.offer.itemName,terms:s.offer.terms,amountCents:s.offer.amountCents,currency:'USD'},
          order:s.order?{orderId:s.order.id,approval:s.order.approval,...(s.paymentObservation||{})}:null,status:s.status,captureId:s.captureId||null,expiresAt:s.order?null:s.created+ttl});return;
      }
      if(req.method==='POST'&&url.pathname==='/api/source-review'){
        const offer=normalizeOffer(await readJson(req));
        const analysis={mode:'source',reviewMethod:'manual',summary:'Complete purchase terms',facts:[],unknowns:[],questions:[],rejectedClaims:0};
        const id=crypto.randomUUID(),digest=digestOffer(offer);
        sessions.set(id,{offer,analysis,digest,created:now(),status:'review',order:null,busy:false});
        try{await persist()}catch(error){sessions.delete(id);throw error}
        send(res,200,{id,digest,analysis,offer:{...offer,currency:'USD'}});return;
      }
      if(req.method==='POST'&&url.pathname==='/api/analyze'){
        const offer=normalizeOffer(await readJson(req));
        if(offer.terms.length>MAX_AI_SOURCE_CHARACTERS)throw inputError('AI highlights support up to 8,000 characters. Use Read terms for this complete policy.');
        const analysis=await ai.analyze(offer);
        const id=crypto.randomUUID(),digest=digestOffer(offer);
        sessions.set(id,{offer,analysis,digest,created:now(),status:'review',order:null,busy:false});
        try{await persist()}catch(error){sessions.delete(id);throw error}
        send(res,200,{id,digest,analysis,offer:{merchant:offer.merchant,itemName:offer.itemName,amountCents:offer.amountCents,currency:'USD',terms:offer.terms}});return;
      }
      if(req.method==='POST'&&url.pathname==='/api/checkout'){
        const input=await readJson(req),s=sessions.get(input?.id);
        if(!s)throw inputError('This review expired. Analyze the offer again.',404);
        if(input.digest!==s.digest)throw inputError('The reviewed offer changed. Analyze it again.',409);
        if(input.consent!==true||input.reviewedUnknowns!==true)throw inputError('Review the terms and unresolved questions first.',409);
        let questions;if(input.buyerQuestions!==undefined)try{questions=savedBuyerQuestions(input.buyerQuestions)}catch(error){throw inputError(error.message)}
        if(s.order){
          if(questions!==undefined){if(s.busy)throw inputError('A payment request is already underway.',409);s.buyerQuestions=questions;await persist()}
          send(res,200,{orderId:s.order.id,approval:s.order.approval});return;
        }
        if(s.busy)throw inputError('A checkout request is already underway.',409);
        s.busy=true;
        try {if(questions!==undefined){s.buyerQuestions=questions;await persist()}s.order=await paypal.createOrder(s.offer,`${origin}/?return=1&review=${encodeURIComponent(input.id)}`,`cc-${s.id||input.id}`);s.status='pending_buyer';await persist();}
        finally{s.busy=false}
        send(res,200,{orderId:s.order.id,approval:s.order.approval});return;
      }
      if(req.method==='POST'&&url.pathname==='/api/payment-status'){
        const input=await readJson(req),s=sessions.get(input?.id);
        if(!s||!s.order)throw inputError('No pending PayPal Sandbox order was found.',404);
        if(input.orderId!==s.order.id)throw inputError('The order ID does not match the buyer-reviewed order.',409);
        if(s.busy)throw inputError('A payment request is already underway. Check again when it finishes.',409);
        s.busy=true;
        try{
          const observed=inspectPayPalOrder(await paypal.getOrder(s.order.id),s.order.id,s.offer.amountCents);
          s.status=observed.status;if(observed.captureId)s.captureId=observed.captureId;
          s.paymentObservation={...observed,observedAt:now()};
          await persist();
          send(res,200,{...s.paymentObservation,orderId:s.order.id});
        }finally{s.busy=false}
        return;
      }
      if(req.method==='POST'&&url.pathname==='/api/capture'){
        const input=await readJson(req),s=sessions.get(input?.id);
        if(!s||!s.order)throw inputError('No pending PayPal Sandbox order was found.',404);
        if(input?.orderId!==s.order.id)throw inputError('The order ID does not match the buyer-reviewed order.',409);
        let questions;if(input.buyerQuestions!==undefined){
          if(input.digest!==s.digest)throw inputError('The question record belongs to a different reviewed offer.',409);
          try{questions=savedBuyerQuestions(input.buyerQuestions)}catch(error){throw inputError(error.message)}
        }
        if(s.status==='captured'){send(res,200,{...s.paymentObservation,status:'captured',orderId:s.order.id,captureId:s.captureId});return}
        if(s.captureId)throw inputError('This order already has a capture. Check its payment status instead.',409);
        if(s.busy)throw inputError('A capture request is already underway.',409);
        s.busy=true;
        try{
          if(questions!==undefined){s.buyerQuestions=questions;await persist()}
          const result=await paypal.captureOrder(s.order.id,`cc-capture-${input.id}`);
          const unit=result.purchase_units?.[0];const capture=unit?.payments?.captures?.[0];
          const expected=(s.offer.amountCents/100).toFixed(2);
          if(result.status!=='COMPLETED'||!capture||capture.status!=='COMPLETED'||capture.amount?.currency_code!=='USD'||capture.amount.value!==expected)throw inputError('PayPal did not confirm the exact reviewed capture amount. Reconcile the order in the Sandbox dashboard.',502);
          s.status='captured';s.captureId=capture.id;
          s.paymentObservation={status:'captured',paypalStatus:'COMPLETED',captureStatus:'COMPLETED',captureId:capture.id,canCapture:false,observedAt:now()};await persist();
        }finally{s.busy=false}
        send(res,200,{...s.paymentObservation,status:'captured',orderId:s.order.id,captureId:s.captureId});return;
      }
      send(res,404,{error:'Not found.'});
    }catch(error){send(res,error.status||500,{error:error.status?error.message:'Service error. Check the server log without exposing any credentials.'});if(!error.status)console.error('Unexpected request error:',error.name)}
  });
  return {server,sessions,port};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const stateFile=process.env.CONSENTCART_STATE_FILE||path.join(os.homedir(),'.local','state','consentcart','reviews.json');
  const app=createApp({stateFile});app.server.listen(app.port,'127.0.0.1',()=>console.log(`ConsentCart local app: http://127.0.0.1:${app.port} (sandbox only)`));
}
