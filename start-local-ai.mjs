import path from 'node:path';
import os from 'node:os';
import {createApp} from './server.mjs';

// This profile uses an already-installed local Ollama runtime; it never downloads a model.
const model=process.env.AI_MODEL||'qwen2.5:7b';
const env={...process.env,AI_BASE_URL:'http://127.0.0.1:11434/v1',AI_MODEL:model,AI_API_KEY:'',AI_REVIEW_MODE:process.env.AI_REVIEW_MODE||'source',AI_TIMEOUT_MS:process.env.AI_TIMEOUT_MS||'120000'};
try {
  const response=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Local Ollama model inventory returned HTTP '+response.status+'.');
  const inventory=await response.json();
  if(!inventory.models?.some(item=>item.name===model||item.model===model))throw new Error('The selected local model '+model+' is not installed. Select an installed model with AI_MODEL, or install the model in Ollama before starting.');
  const stateFile=env.CONSENTCART_STATE_FILE||path.join(os.homedir(),'.local','state','consentcart','reviews.json');
  const app=createApp({env,stateFile});
  app.server.listen(app.port,'127.0.0.1',()=>console.log('ConsentCart: http://127.0.0.1:'+app.port+'\nActual local AI: '+model+' (up to '+Math.ceil(Number(env.AI_TIMEOUT_MS)/1000)+' seconds per review).\nReview mode: '+(env.AI_REVIEW_MODE==='source'?'original source selection':'unverified model explanations')+'.\nMerchant terms stay on this computer for AI analysis. PayPal remains Sandbox-only and requires separate credentials.'));
} catch(error) {
  console.error('ConsentCart local AI could not start: '+(error.cause?.code==='ECONNREFUSED'?'Ollama is not running at http://127.0.0.1:11434. Start your local Ollama runtime, then try again.':error.message));
  process.exitCode=1;
}
