import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, renderEnglishWithTerms } from './terms.ts';

test('slugify lowercases, keeps diacritics, hyphenates spaces', () => {
	assert.equal(slugify('Paṭiccasamuppāda'), 'paṭiccasamuppāda');
	assert.equal(slugify('yoniso manasikāra'), 'yoniso-manasikāra');
});

test('known standalone term becomes interactive span', () => {
	const html = renderEnglishWithTerms('I teach *dhamma* now', new Set(['dhamma']));
	assert.match(html, /<span class="pali-term" data-term="dhamma">dhamma<\/span>/);
});

test('plural matches singular slug', () => {
	const html = renderEnglishWithTerms('the *bhikkhus* sat', new Set(['bhikkhu']));
	assert.match(html, /data-term="bhikkhu">bhikkhus<\/span>/);
});

test('unknown term renders as plain em', () => {
	const html = renderEnglishWithTerms('a *nibbāna* here', new Set());
	assert.equal(html, 'a <em>nibbāna</em> here');
});

test('bracketed term keeps brackets, span inside', () => {
	const html = renderEnglishWithTerms('mind [*citta*]', new Set(['citta']));
	assert.match(html, /\[<span class="pali-term" data-term="citta">citta<\/span>\]/);
});

test('escapes html in surrounding text', () => {
	const html = renderEnglishWithTerms('a < b *dhamma*', new Set(['dhamma']));
	assert.match(html, /a &lt; b /);
});
