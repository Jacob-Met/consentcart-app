/**
 * Source-only revision comparison. Exact passages, not an AI judgement.
 * A changed sentence is shown once as removed and once as added.
 */
function passages(text) {
  return String(text).split(/\n+|(?<=[.!?])\s+/u).map(s => s.trim()).filter(Boolean);
}
function unmatched(source, other) {
  const counts = new Map();
  for (const s of other) counts.set(s, (counts.get(s) || 0) + 1);
  return source.filter(s => {
    const n = counts.get(s) || 0;
    if (n) { counts.set(s, n - 1); return false; }
    return true;
  });
}
export function compareTerms(before, after) {
  const previous = passages(before), current = passages(after);
  return {removed: unmatched(previous, current), added: unmatched(current, previous)};
}
export function compareOffer(before, after) {
  const terms = compareTerms(before.terms, after.terms);
  const fields = [];
  for (const [key, label] of [['merchant', 'Merchant'], ['itemName', 'Item'], ['amountCents', 'Price']]) {
    if (before[key] !== after[key]) fields.push({key, label, previous: before[key], current: after[key]});
  }
  return {...terms, fields, changed: !!(terms.added.length || terms.removed.length || fields.length)};
}
