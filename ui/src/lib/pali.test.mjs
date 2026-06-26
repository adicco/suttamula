// src/lib/pali.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizePali, wordAt, PALI_LETTERS } from './pali.mjs';

test('tokenizePali extracts lowercased letter runs', () => {
  assert.deepEqual(tokenizePali('Evaṃ me sutaṃ—'), ['evaṃ', 'me', 'sutaṃ']);
});

test('tokenizePali splits on apostrophes and punctuation', () => {
  assert.deepEqual(tokenizePali("vuccatī'ti, dhammaṃ."), ['vuccatī', 'ti', 'dhammaṃ']);
});

test('tokenizePali preserves diacritics and lowercases capitals', () => {
  assert.deepEqual(tokenizePali('Bhikkhave Ānanda'), ['bhikkhave', 'ānanda']);
});

test('PALI_LETTERS covers the Pāli diacritic set', () => {
  for (const c of 'āīūṅñṭḍṇḷṃṁ') assert.match(c, new RegExp(`[${PALI_LETTERS}]`));
});

test('wordAt returns the word under an interior offset', () => {
  const t = 'evaṃ me sutaṃ';
  assert.equal(wordAt(t, 0), 'evaṃ');   // start of first word
  assert.equal(wordAt(t, 6), 'me');     // inside "me"
  assert.equal(wordAt(t, 13), 'sutaṃ'); // end of last word
});

test('wordAt returns null on whitespace/punctuation', () => {
  assert.equal(wordAt('evaṃ me', 4), null); // the space
  assert.equal(wordAt('— evaṃ', 0), null);  // the dash
});
