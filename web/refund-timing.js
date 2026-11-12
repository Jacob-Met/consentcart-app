// Index settlement wording separately from a deadline for requesting a refund.
// These literal cues retain the complete sentence; they do not infer eligibility.
export function isRefundTiming(text){
 const refund=/\brefund(?:s|ed|ing)?\b/i.test(text);
 const reimbursement=/\breimburs(?:e|es|ed|ing|ement|ements)\b/i.test(text)
  && /\b(?:purchase|withdraw(?:al)?|returned goods)\b/i.test(text)
  && /\b(?:customer|consumer|buyer|you|your|payments?)\b/i.test(text);
 if(!refund&&!reimbursement)return false;
 // A refusal to issue money is not a payment-processing deadline.
 if(/\bno\s+(?:partial\s+)?refund(?:\s+or\s+partial\s+refund)?\s+(?:(?:will|shall|can|may)\s+)?be\s+(?:issued|provided|paid)\b/i.test(text)
  || /\brefunds?\s+(?:will|shall|can|may)\s+not\s+be\s+(?:issued|provided|paid)\b/i.test(text)
  || /\b(?:issue|provide|pay)\s+no\s+(?:partial\s+)?refund\b/i.test(text))return false;
 if(/\brequest(?:s|ed|ing)?\b[^.;!?]*\bwithin\b/i.test(text))return false;
 if(/\brequest(?:s|ed|ing)?\b/i.test(text)&&!/\b(?:process(?:ed|ing)|issu(?:e|ed|ing)|credit(?:ed|ing)?)\b/i.test(text))return false;
 return /\brefund[- ](?:processing|tim(?:e|ing))\b|\bprocessing\s+time\b/i.test(text)
  || /\b(?:process(?:ed|ing)|issu(?:e|ed|ing)|credit(?:ed|ing)?|receiv(?:e|ed|ing)|arriv(?:e|es|al)|appear(?:s)?|reimburs(?:e|es|ed|ing))\b/i.test(text)
    && /\b(?:within|after|takes?|up to|(?:not|no) later than|business days?|not specified|not stated|not provided)\b/i.test(text);
}
