import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTranslationPath, paliRelFor, compareVersions, latestVersion,
  zipSegments, suttaSortKey,
} from './extract.mjs';

test('parseTranslationPath with vagga', () => {
  const r = parseTranslationPath('0.2/gpt-5.5:medium/an/an1/an1.1-10.json');
  assert.deepEqual(r, {
    version: '0.2', model: 'gpt-5.5:medium', nikaya: 'an',
    vagga: 'an1', suttaId: 'an1.1-10', suttaRel: 'an/an1/an1.1-10',
  });
});

test('parseTranslationPath without vagga', () => {
  const r = parseTranslationPath('0.1/sonnet/mn/mn9.json');
  assert.equal(r.vagga, null);
  assert.equal(r.suttaId, 'mn9');
  assert.equal(r.suttaRel, 'mn/mn9');
});

test('paliRelFor', () => {
  assert.equal(paliRelFor('sn/sn12/sn12.1'), 'sn/sn12/sn12.1_root-pli-ms.json');
});

test('compareVersions numeric-aware', () => {
  assert.ok(compareVersions('0.2', '0.1') > 0);
  assert.ok(compareVersions('0.10', '0.2') > 0);
});

test('latestVersion', () => {
  assert.equal(latestVersion(['0.1', '0.2']), '0.2');
});

test('zipSegments follows english order and joins pali', () => {
  const pali = { 'x:1.1': 'P1', 'x:1.2': 'P2' };
  const en = { 'x:1.1': 'E1', 'x:1.2': 'E2' };
  const out = zipSegments(pali, en);
  assert.deepEqual(out, [
    { seg_id: 'x:1.1', seg_order: 0, pali: 'P1', english: 'E1' },
    { seg_id: 'x:1.2', seg_order: 1, pali: 'P2', english: 'E2' },
  ]);
});

test('zipSegments tolerates missing pali', () => {
  const out = zipSegments({}, { 'x:1.1': 'E1' });
  assert.equal(out[0].pali, null);
});

test('suttaSortKey sorts naturally', () => {
  const ids = ['sn12.10', 'sn12.1', 'sn12.2'];
  ids.sort((a, b) => suttaSortKey(a).localeCompare(suttaSortKey(b)));
  assert.deepEqual(ids, ['sn12.1', 'sn12.2', 'sn12.10']);
});
