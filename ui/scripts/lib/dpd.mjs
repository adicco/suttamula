export function stripLemmaNumber(lemma) {
  return String(lemma).replace(/\s+\d+(\.\d+)*\.?$/, '').trim();
}

export function dedupeSenses(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const meaning = (r.meaning_1 ?? '').trim();
    if (!meaning) continue;
    const lemma = stripLemmaNumber(r.lemma_1 ?? '');
    const pos = (r.pos ?? '').trim();
    const key = `${lemma}\0${pos}\0${meaning}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lemma, pos, meaning });
  }
  return out;
}
