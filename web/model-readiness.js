const section=document.querySelector('.model-readiness');
const options=document.createElement('details');options.className='model-options';
const summary=document.createElement('summary');summary.textContent='AI highlights';
options.append(summary,section);document.getElementById('reader-action').append(options);
const status=document.getElementById('model-readiness-status');
const recovery=document.getElementById('model-recovery');
const retry=document.getElementById('model-recheck');
export function showModelReadiness(config,{checking=false,failed=false}={}){
 const ready=!checking&&!failed&&config.ai===true;
 const button=document.getElementById('analyze');button.disabled=!ready;button.classList.toggle('hidden',!ready);options.classList.toggle('hidden',ready);
 if(!ready)button.textContent=checking?'Checking AI…':'AI unavailable';
 section.classList.toggle('hidden',ready||checking);
 retry.disabled=checking;retry.classList.toggle('hidden',ready||checking);
 recovery.classList.toggle('hidden',ready||checking);
 status.textContent=failed?'Could not connect to AI.':'AI is not connected.';
}
