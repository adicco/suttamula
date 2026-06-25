// Pure helpers for the DB build. No fs/sqlite here so they stay unit-testable.

export function parseTranslationPath(relPath) {
  const parts = relPath.split('/');
  const [version, model, ...rest] = parts;
  const nikaya = rest[0];
  const file = rest[rest.length - 1];
  const suttaId = file.replace(/\.json$/, '');
  const vagga = rest.length === 3 ? rest[1] : null;
  const suttaRel = rest.join('/').replace(/\.json$/, '');
  return { version, model, nikaya, vagga, suttaId, suttaRel };
}

export function paliRelFor(suttaRel) {
  return `${suttaRel}_root-pli-ms.json`;
}

function versionTuple(v) {
  return v.split('.').map((n) => parseInt(n, 10));
}

export function compareVersions(a, b) {
  const ta = versionTuple(a), tb = versionTuple(b);
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const d = (ta[i] || 0) - (tb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function latestVersion(versions) {
  return [...versions].sort(compareVersions).at(-1);
}

export function zipSegments(paliMap, enMap) {
  return Object.keys(enMap).map((seg_id, seg_order) => ({
    seg_id,
    seg_order,
    pali: paliMap[seg_id] ?? null,
    english: enMap[seg_id],
  }));
}

export function suttaSortKey(suttaId) {
  const pad = (s) => s.replace(/\d+/g, (n) => n.padStart(10, '0'));
  const m = suttaId.match(/^([a-z]+)(.*)$/);
  const nikaya = m ? m[1] : suttaId;
  const rest = m ? m[2] : '';
  return `${nikaya}|${pad(rest)}`;
}
