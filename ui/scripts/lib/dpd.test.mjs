import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripLemmaNumber, dedupeSenses } from './dpd.mjs';

test('stripLemmaNumber drops a trailing sense number', () => {
  assert.equal(stripLemmaNumber('dukkha 3'), 'dukkha');
  assert.equal(stripLemmaNumber('dhamma'), 'dhamma');
  assert.equal(stripLemmaNumber('saṅkhāra 12'), 'saṅkhāra');
});

test('dedupeSenses maps, drops empty meanings, and dedupes', () => {
  const rows = [
    { lemma_1: 'dukkha 3', pos: 'nt', meaning_1: 'suffering' },
    { lemma_1: 'dukkha 3', pos: 'nt', meaning_1: 'suffering' },
    { lemma_1: 'dukkha 1', pos: 'adj', meaning_1: 'painful' },
    { lemma_1: 'dukkha 9', pos: 'nt', meaning_1: '' },
  ];
  assert.deepEqual(dedupeSenses(rows), [
    { lemma: 'dukkha', pos: 'nt', meaning: 'suffering' },
    { lemma: 'dukkha', pos: 'adj', meaning: 'painful' },
  ]);
});
