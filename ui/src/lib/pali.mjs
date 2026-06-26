// src/lib/pali.mjs
// Shared Pāli word logic. Plain JS so both the Node build script and the
// Vite-bundled Astro client can import it (Node can't import .ts).

export const PALI_LETTERS = 'A-Za-zĀāĪīŪūṄṅÑñṬṭḌḍṆṇḶḷṂṃṀṁ';

const RUN = new RegExp(`[${PALI_LETTERS}]+`, 'gu');
const LETTER = new RegExp(`[${PALI_LETTERS}]`, 'u');

// Every maximal Pāli-letter run, lowercased, in source order.
export function tokenizePali(text) {
  const out = [];
  for (const m of String(text).matchAll(RUN)) out.push(m[0].toLowerCase());
  return out;
}

// The Pāli word covering `offset` within `text`, lowercased, or null.
// Used client-side after the caret API gives a (textNode, offset).
// "Adjacent" means offset is inside a word OR at the very end of the string
// immediately after a word (end-of-text-node boundary).
export function wordAt(text, offset) {
  const s = String(text);
  if (offset < 0 || offset > s.length) return null;
  const atLetter = offset < s.length && LETTER.test(s[offset]);
  const prevLetter = offset === s.length && offset > 0 && LETTER.test(s[offset - 1]);
  if (!atLetter && !prevLetter) return null;
  let start = offset;
  let end = offset;
  while (start > 0 && LETTER.test(s[start - 1])) start--;
  while (end < s.length && LETTER.test(s[end])) end++;
  if (start === end) return null;
  return s.slice(start, end).toLowerCase();
}
