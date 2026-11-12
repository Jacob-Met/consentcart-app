import {createApp} from '../server.mjs';
const {server}=createApp({env:{PORT:'4178'}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
try {
 for(const [path,needle] of [['/','ConsentCart'],['/app.js','/api/checkout'],['/source.js','findQuoteRange'],['/terms-facts.js','renderTermsFacts'],['/saved-review.js','readSavedOffer'],['/offer-draft.js','serializeOfferDraft'],['/clarification.js','merchantMessage'],['/style.css','--forest'],['/api/config','"sandbox":true']]){
  const r=await fetch(base+path);const b=await r.text();if(r.status!==200||!b.includes(needle))throw new Error(`Smoke failed for ${path}`);
 }
 console.log('PASS: real HTTP entrypoint, JS, CSS, and sandbox-only config delivered.');
}finally{await new Promise(resolve=>server.close(resolve))}
