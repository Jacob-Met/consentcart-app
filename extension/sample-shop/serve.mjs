// Serves the sample checkout page on its own origin, so the extension runs on a different origin than the app.
// node extension/sample-shop/serve.mjs   (PORT=4190 by default)
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT)||4190;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  const p=new URL(req.url,'http://x').pathname;
  const file=p==='/'||p==='/checkout.html'?'checkout.html':p==='/checkout.css'?'checkout.css':null;
  if(!file){res.writeHead(404);return res.end('Not found')}
  res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});
  res.end(await readFile(path.join(here,file)));
}).listen(port,'127.0.0.1',()=>console.log(`Sample checkout: http://127.0.0.1:${port}/checkout.html`));
