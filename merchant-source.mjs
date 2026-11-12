import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';

const MAX_PAGE_BYTES=2_000_000;
const MAX_PDF_BYTES=8_000_000;
const fail=message=>Object.assign(new Error(message),{status:422});
export function merchantPageUrl(value){
 let url;try{url=new URL(String(value||'').trim())}catch{throw fail('Enter the full HTTPS address of the merchant’s terms page.')}
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!url.hostname.includes('.')||isIP(url.hostname.replace(/^\[|\]$/g,''))||url.href.length>2048)
  throw fail('Use a public HTTPS merchant page address.');
 url.hash='';return url;
}
export function publicSourceAddress(address){
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)
  ||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))||(b===88&&c===99)))
  ||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}
export function createMerchantSourceClient({lookupImpl=lookup,requestImpl=https.request}={}){
 return async function fetchMerchantSource(value){
  let url=merchantPageUrl(value);const requestedUrl=url.href;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   for(let redirects=0;redirects<=3;redirects++){
    controller.signal.throwIfAborted();
    const addresses=await Promise.race([
     lookupImpl(url.hostname,{family:4,all:true}),
     new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(fail('The merchant page took too long to respond. Try again or paste its terms.')),{once:true}))
    ]);
    if(!addresses.length||addresses.some(a=>!publicSourceAddress(a.address)))throw fail('This address is not an available public merchant page.');
    const address=addresses[0].address;
    const response=await new Promise((resolve,reject)=>{
     const request=requestImpl(url,{method:'GET',family:4,agent:false,signal:controller.signal,
      headers:{'Accept':'text/html, application/pdf;q=0.95, text/plain;q=0.9','Accept-Encoding':'identity','User-Agent':'ConsentCart/0.13 source reader'},
      // Use the checked destination for this connection; do not resolve again.
      lookup:(_hostname,options,callback)=>options?.all?callback(null,[{address,family:4}]):callback(null,address,4)
     },res=>{
      if([301,302,303,307,308].includes(res.statusCode)){res.resume();resolve({redirect:res.headers.location});return}
      if(res.statusCode!==200){res.resume();reject(fail('The merchant page could not be opened (HTTP '+res.statusCode+'). You can still paste its terms.'));return}
      const type=String(res.headers['content-type']||'').toLowerCase();
      if(!/^(?:text\/html|application\/xhtml\+xml|text\/plain|application\/pdf)(?:;|$)/.test(type)){res.resume();reject(fail('This link is not an HTML or text terms page. Open the page and paste its terms.'));return}
      if(res.headers['content-encoding']&&!/^identity$/i.test(res.headers['content-encoding'])){res.resume();reject(fail('This page uses an unsupported transfer format. Open it and paste its terms.'));return}
      const pdf=/^application\/pdf(?:;|$)/.test(type);
      const limit=pdf?MAX_PDF_BYTES:MAX_PAGE_BYTES;
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>limit){res.destroy();reject(fail(pdf?'This PDF exceeds the 8 MB limit. Open it and paste the original terms instead.':'This page is too large to import completely. Open it and paste the relevant original terms.'));return}chunks.push(chunk)});
      res.on('error',reject);
      res.on('end',()=>{
       try{const body=Buffer.concat(chunks);
        const sha256=createHash('sha256').update(body).digest('hex');
        if(pdf){
          if(body.subarray(0,8).toString('ascii').startsWith('%PDF-')===false)throw fail('This link did not return a readable PDF. Open the original document and paste its terms.');
          resolve({pdfBase64:body.toString('base64'),contentType:type,bytes:size,sha256});
          return;
        }
        const charset=type.match(/charset\s*=\s*["']?([^;"'\s]+)/)?.[1]||'utf-8';
        const text=new TextDecoder(charset,{fatal:true}).decode(body);
        resolve({text,contentType:type,bytes:size,sha256});
       }catch(error){reject(error?.status?error:fail('This page’s text encoding could not be read completely. Open it and paste its terms.'))}
      });
     });
     request.on('error',reject);request.end();
    });
    if('redirect' in response){
     if(redirects===3||!response.redirect)throw fail('This page redirects too many times. Open the final terms-page address.');
     url=merchantPageUrl(new URL(response.redirect,url).href);continue;
    }
    return {...response,url:url.href,requestedUrl,fetchedAt:new Date().toISOString()};
   }
  }catch(error){
   if(error.status)throw error;
   if(controller.signal.aborted)throw fail('The merchant page took too long to respond. Try again or paste its terms.');
   throw fail('The merchant page could not be read. Check the address, or open it and paste its terms.');
  }finally{clearTimeout(timer)}
 };
}
export const fetchMerchantSource=createMerchantSourceClient();
