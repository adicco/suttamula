function escapeHtml(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function slugify(term) {
	return term
		.trim()
		.toLowerCase()
		.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
		.replace(/\s+/g, '-');
}

function matchSlug(inner, known) {
	const slug = slugify(inner);
	if (known.has(slug)) return slug;
	const singular = slug.replace(/s$/, '');
	if (singular !== slug && known.has(singular)) return singular;
	return null;
}

function termSpan(inner, known) {
	const slug = matchSlug(inner, known);
	const safe = escapeHtml(inner);
	return slug
		? `<span class="pali-term" data-term="${escapeHtml(slug)}">${safe}</span>`
		: `<em>${safe}</em>`;
}

const TOKEN = /\[\*([^*]+)\*\]|\*([^*]+)\*/g;

export function renderEnglishWithTerms(text, knownSlugs) {
	let out = '';
	let last = 0;
	for (const m of text.matchAll(TOKEN)) {
		out += escapeHtml(text.slice(last, m.index));
		if (m[1] !== undefined) out += `[${termSpan(m[1], knownSlugs)}]`;
		else out += termSpan(m[2], knownSlugs);
		last = m.index + m[0].length;
	}
	out += escapeHtml(text.slice(last));
	return out;
}
