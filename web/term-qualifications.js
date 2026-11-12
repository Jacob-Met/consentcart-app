// Keep a literal metric from posing as an unconditional purchase rule.
// This is a narrow lexical guard, not a complete interpretation of the source.
const condition=/\b(?:only|unless|except|until|if|when|provided)\b|\bsubject\s+to\b|\b(?:for|on)\s+(?:defective|damaged)\b|\bupon\s+request\b|\bduring\s+(?:(?:the|a|your)\s+)?trial\b|\bfirst\s+\d+\s+(?:days?|weeks?|months?|years?)\b/i;
const feeOrRequirement=/\bno subscription\s+(?:fees?|charges?|costs?|payments?|discounts?|cancellation)\b|\bno subscription\s+(?:is\s+)?(?:required|needed|necessary)\b/i;
export function qualifyTermHeadline(row){
 if(!row||!Array.isArray(row.passages))return row;
 const texts=row.passages.map(p=>p.text);
 const bareMetric=row.value!=='Read terms'&&!/^\d+ clauses$/.test(row.value);
 const conditionalPostage=row.id==='postage'&&texts.some(text=>condition.test(text));
 const qualifiedRenewal=row.id==='renewal'&&texts.some(text=>condition.test(text)||/^no subscription$/i.test(row.value)&&feeOrRequirement.test(text));
 const guarded=bareMetric&&(conditionalPostage||qualifiedRenewal);
 const detail=row.detail||((row.id==='postage'||guarded)&&texts.length===1&&texts[0].length<=400?texts[0]:'');
 return {...row,value:guarded?'Read terms':row.value,detail,caution:row.caution||guarded};
}
