// Group a flat DPD sense list into per-lemma blocks, preserving source order.
// A single hovered form usually maps to several senses of the same lemma
// (e.g. "aṅguttara" adj + masc), so grouping lets the lemma head its senses
// once instead of repeating on every line. Shared by the hover tooltip
// (PaliLookup) and the click dialog (TermDialog) so they stay consistent.
export function groupSenses(senses) {
  const groups = [];
  for (const s of senses) {
    let g = groups[groups.length - 1];
    if (!g || g.lemma !== s.lemma) {
      g = { lemma: s.lemma, items: [] };
      groups.push(g);
    }
    g.items.push({ pos: s.pos, meaning: s.meaning });
  }
  return groups;
}
