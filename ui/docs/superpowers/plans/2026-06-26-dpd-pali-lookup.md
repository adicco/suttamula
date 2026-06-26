# DPD Pāli Dictionary Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Pāli word in the sutta-view left column a DPD dictionary lookup — hover shows a compact sense tooltip, click opens the shared dialog with the full list — with no per-word DOM markup.

**Architecture:** `build:db` tokenizes all Pāli, looks each form up in the build-only `data/dpd.db`, and bakes a small `dpd` table into `suttamula.db`. A static per-sutta JSON endpoint (`/dpd/[id].json`) ships only the relevant subset. The client leaves the Pāli as plain text and resolves the hovered/clicked word at runtime via the caret API, then looks it up in the fetched JSON. Curated `/definitions/` entries combine with DPD data (two-in-one tooltip + dialog), DPD content marked by the DPD logo.

**Tech Stack:** Astro 7, better-sqlite3, Node ≥22.12, `node --test`, vanilla client JS (caret API), HTMX.

## Global Constraints

- Node only, never Bun.
- `data/dpd.db` (2.1 GB) is a **build-time input only** — never read at runtime, never shipped, never imported into the Astro build. Only `suttamula.db`'s small `dpd` table reaches Astro.
- Shared tokenize/normalize logic must live in **one** plain-JS module (`src/lib/pali.mjs`) imported by both the Node build script and the Astro client bundle (Node cannot import `.ts`; Vite can import `.mjs`).
- After `npm run build:db`, the dev server must be restarted to see new data.
- Model-slug rule unchanged; DPD data is keyed by **sutta id only** (version/model-independent).
- DPD logo asset: `/dpd-logo-48.png` (already at `public/dpd-logo-48.png`).
- Tooltip caps at **6 senses**; the click dialog shows all.
- No-match Pāli words stay plain (non-interactive).

---

### Task 1: Pāli tokenizer / normalizer (`src/lib/pali.mjs`)

Pure, shared module. A "word" is a maximal run of Pāli letters; apostrophes/punctuation split words. Used by the build script (collect forms) and the client (resolve the word at a caret).

**Files:**
- Create: `src/lib/pali.mjs`
- Test: `src/lib/pali.test.mjs`

**Interfaces:**
- Produces:
  - `PALI_LETTERS: string` — character-class body (no brackets), e.g. `"A-Za-zĀāĪīŪūṄṅÑñṬṭḌḍṆṇḶḷṂṃṀṁ"`.
  - `tokenizePali(text: string): string[]` — every Pāli-letter run, lowercased, in order (duplicates kept; caller dedupes).
  - `wordAt(text: string, offset: number): string | null` — the lowercased Pāli word containing/adjacent to `offset`, or `null` if none.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/pali.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizePali, wordAt, PALI_LETTERS } from './pali.mjs';

test('tokenizePali extracts lowercased letter runs', () => {
  assert.deepEqual(tokenizePali('Evaṃ me sutaṃ—'), ['evaṃ', 'me', 'sutaṃ']);
});

test('tokenizePali splits on apostrophes and punctuation', () => {
  assert.deepEqual(tokenizePali("vuccatī’ti, dhammaṃ."), ['vuccatī', 'ti', 'dhammaṃ']);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/pali.test.mjs`
Expected: FAIL — `Cannot find module './pali.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
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
export function wordAt(text, offset) {
  const s = String(text);
  if (offset < 0 || offset > s.length) return null;
  // Treat the char to the left of a boundary offset as part of the word.
  let start = offset;
  let end = offset;
  while (start > 0 && LETTER.test(s[start - 1])) start--;
  while (end < s.length && LETTER.test(s[end])) end++;
  if (start === end) return null; // sitting on a non-letter
  return s.slice(start, end).toLowerCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/pali.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pali.mjs src/lib/pali.test.mjs
git commit -m "feat: shared Pāli tokenizer/normalizer for DPD lookup"
```

---

### Task 2: DPD sense helpers (`scripts/lib/dpd.mjs`)

Pure transforms applied to `dpd_headwords` rows. No DB handle here (the giant DB is queried in Task 3) — these are the testable parts.

**Files:**
- Create: `scripts/lib/dpd.mjs`
- Test: `scripts/lib/dpd.test.mjs`

**Interfaces:**
- Produces:
  - `stripLemmaNumber(lemma: string): string` — `"dukkha 3"` → `"dukkha"`, `"dhamma"` → `"dhamma"`.
  - `dedupeSenses(rows: {lemma_1, pos, meaning_1}[]): {lemma, pos, meaning}[]` — map each row to `{lemma: stripLemmaNumber(lemma_1), pos, meaning: meaning_1}`, drop entries with empty meaning, dedupe identical `(lemma,pos,meaning)` tuples, preserve order.

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/dpd.test.mjs
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
    { lemma_1: 'dukkha 3', pos: 'nt', meaning_1: 'suffering' }, // dup
    { lemma_1: 'dukkha 1', pos: 'adj', meaning_1: 'painful' },
    { lemma_1: 'dukkha 9', pos: 'nt', meaning_1: '' },          // empty -> dropped
  ];
  assert.deepEqual(dedupeSenses(rows), [
    { lemma: 'dukkha', pos: 'nt', meaning: 'suffering' },
    { lemma: 'dukkha', pos: 'adj', meaning: 'painful' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/dpd.test.mjs`
Expected: FAIL — `Cannot find module './dpd.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/lib/dpd.mjs
// Pure transforms over dpd_headwords rows. The DB query lives in build-db.mjs.

export function stripLemmaNumber(lemma) {
  return String(lemma).replace(/\s+\d+$/, '').trim();
}

export function dedupeSenses(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const meaning = (r.meaning_1 ?? '').trim();
    if (!meaning) continue;
    const lemma = stripLemmaNumber(r.lemma_1 ?? '');
    const pos = (r.pos ?? '').trim();
    const key = `${lemma} ${pos} ${meaning}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lemma, pos, meaning });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/dpd.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/dpd.mjs scripts/lib/dpd.test.mjs
git commit -m "feat: pure DPD sense dedupe/strip helpers"
```

---

### Task 3: Build the `dpd` table in `build:db` (`scripts/build-db.mjs`)

Collect every Pāli form during the existing ingest, look each up in `data/dpd.db`, tag curated overlaps against the `/definitions/` slugs, and write a `dpd` table into `suttamula.db`.

**Files:**
- Modify: `scripts/build-db.mjs`
- (No new unit test — verified by a build smoke check; pure parts already covered by Tasks 1–2.)

**Interfaces:**
- Consumes: `tokenizePali` (Task 1), `dedupeSenses` + `stripLemmaNumber` (Task 2).
- Produces: table `dpd (form TEXT PRIMARY KEY, senses TEXT NOT NULL, term TEXT)` in `suttamula.db`; `senses` is `JSON.stringify([{lemma,pos,meaning}, ...])`, `term` is a matching definition slug or `NULL`.

- [ ] **Step 1: Add imports and the DPD/definitions paths**

At the top of `scripts/build-db.mjs`, extend the `./lib/extract.mjs` import group with the new modules and add path constants near the existing `*_ROOT` constants (after line 17):

```js
import { tokenizePali } from '../src/lib/pali.mjs';
import { dedupeSenses, stripLemmaNumber } from './lib/dpd.mjs';
```

```js
const DPD_PATH = join(DB_DIR, 'dpd.db');
const DEFINITIONS_DIR = join(UI_ROOT, 'src', 'content', 'definitions');
```

- [ ] **Step 2: Add the `dpd` table to the schema block**

In the `db.exec(\`...\`)` block (lines 65–86), add the drop at the top of the DROP list and the create at the end of the CREATE list:

```sql
  DROP TABLE IF EXISTS dpd;
```
```sql
  CREATE TABLE dpd (form TEXT PRIMARY KEY, senses TEXT NOT NULL, term TEXT);
```

- [ ] **Step 3: Collect unique Pāli forms during ingest**

Add a `formsSeen` set beside the other `*Seen` collections (near line 102–104):

```js
const formsSeen = new Set();
```

Inside the segment loop (after `const segs = zipSegments(paliMap, enMap);`, ~line 117), collect forms from the Pāli side:

```js
		for (const s of segs) {
			if (s.pali) for (const form of tokenizePali(s.pali)) formsSeen.add(form);
		}
```

- [ ] **Step 4: Read definition slugs and build the `dpd` table**

After the prompts block and **before** `db.close();` (line 150), add:

```js
// --- DPD dictionary lookup table -------------------------------------------
// data/dpd.db is a build-time input only; we bake the relevant subset into
// suttamula.db so the 2.1 GB source never reaches the Astro build or runtime.
if (existsSync(DPD_PATH) && formsSeen.size) {
	const defSlugs = new Set(
		existsSync(DEFINITIONS_DIR)
			? readdirSync(DEFINITIONS_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
			: []
	);

	const dpd = new Database(DPD_PATH, { readonly: true, fileMustExist: true });
	const lookupStmt = dpd.prepare('SELECT headwords FROM lookup WHERE lookup_key = ?');
	// id list is interpolated (integers from JSON) — safe, and avoids variadic binding.
	const headwordsFor = (ids) =>
		dpd.prepare(`SELECT lemma_1, pos, meaning_1 FROM dpd_headwords WHERE id IN (${ids.join(',')})`).all();

	const insDpd = db.prepare('INSERT OR REPLACE INTO dpd (form, senses, term) VALUES (?, ?, ?)');
	let matched = 0;
	const writeAll = db.transaction(() => {
		for (const form of formsSeen) {
			const row = lookupStmt.get(form);
			if (!row || !row.headwords) continue;
			let ids;
			try { ids = JSON.parse(row.headwords); } catch { continue; }
			if (!Array.isArray(ids) || !ids.length) continue;
			const onlyInts = ids.filter((n) => Number.isInteger(n));
			if (!onlyInts.length) continue;
			const senses = dedupeSenses(headwordsFor(onlyInts));
			if (!senses.length) continue;
			const term = senses.map((s) => stripLemmaNumber(s.lemma)).find((l) => defSlugs.has(l)) ?? null;
			insDpd.run(form, JSON.stringify(senses), term);
			matched++;
		}
	});
	writeAll();
	dpd.close();
	console.log(`DPD: ${matched}/${formsSeen.size} forms matched.`);
} else {
	console.log('DPD: data/dpd.db not found or no forms — skipping dpd table.');
}
```

- [ ] **Step 5: Build and verify the table populates**

Run:
```bash
npm run build:db
node -e "const D=require('better-sqlite3');const db=new D('data/suttamula.db',{readonly:true});console.log('rows',db.prepare('SELECT COUNT(*) c FROM dpd').get().c);console.log(db.prepare('SELECT form,senses,term FROM dpd WHERE form=?').get('dhammaṃ'));console.log('curated',db.prepare('SELECT form,term FROM dpd WHERE term IS NOT NULL LIMIT 3').all());"
```
Expected: `rows` > 0; the `dhammaṃ` row prints a non-empty `senses` JSON; at least the `dhamma`-family curated rows show `term: 'dhamma'`.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-db.mjs
git commit -m "feat: bake DPD lookup subset into suttamula.db at build time"
```

---

### Task 4: Per-sutta JSON endpoint (`src/pages/dpd/[id].json.ts`)

Emit a static `dist/dpd/<id>.json` per sutta: `{ form: { senses, term } }` for the forms in that sutta's Pāli.

**Files:**
- Modify: `src/lib/db.ts`
- Create: `src/pages/dpd/[id].json.ts`

**Interfaces:**
- Consumes: `tokenizePali` (Task 1); `dpd` table (Task 3).
- Produces (added to `db.ts`):
  - `getAllSuttaIds(): string[]`
  - `getDistinctPaliForSutta(suttaId): string[]` — distinct non-null `pali` strings across all combos of the sutta.
  - `getDpdRows(forms: string[]): { form, senses, term }[]` — rows from `dpd` for the given forms (`senses` is the raw JSON string).

- [ ] **Step 1: Add the query helpers to `db.ts`**

Append to `src/lib/db.ts`:

```ts
export function getAllSuttaIds(): string[] {
  return (db.prepare(`SELECT id FROM suttas`).all() as Array<{ id: string }>).map((r) => r.id);
}

export function getDistinctPaliForSutta(suttaId: string): string[] {
  return (db.prepare(`SELECT DISTINCT pali FROM segments WHERE sutta_id = ? AND pali IS NOT NULL AND pali <> ''`).all(suttaId) as Array<{ pali: string }>).map((r) => r.pali);
}

export function getDpdRows(forms: string[]): Array<{ form: string; senses: string; term: string | null }> {
  if (!forms.length) return [];
  const placeholders = forms.map(() => '?').join(',');
  return db.prepare(`SELECT form, senses, term FROM dpd WHERE form IN (${placeholders})`).all(...forms) as any;
}
```

- [ ] **Step 2: Create the endpoint**

```ts
// src/pages/dpd/[id].json.ts
import type { APIRoute, GetStaticPaths } from 'astro';
import { getAllSuttaIds, getDistinctPaliForSutta, getDpdRows } from '../../lib/db';
import { tokenizePali } from '../../lib/pali.mjs';

export const getStaticPaths: GetStaticPaths = () =>
  getAllSuttaIds().map((id) => ({ params: { id } }));

export const GET: APIRoute = ({ params }) => {
  const id = params.id!;
  const forms = new Set<string>();
  for (const pali of getDistinctPaliForSutta(id)) for (const f of tokenizePali(pali)) forms.add(f);

  const out: Record<string, { senses: unknown; term: string | null }> = {};
  for (const row of getDpdRows([...forms])) {
    out[row.form] = { senses: JSON.parse(row.senses), term: row.term };
  }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
};
```

- [ ] **Step 3: Build and verify the JSON emits**

Run:
```bash
npm run build
node -e "const fs=require('fs');const g=require('child_process').execSync('ls dist/dpd | head -1').toString().trim();const j=JSON.parse(fs.readFileSync('dist/dpd/'+g));const k=Object.keys(j);console.log('file',g,'forms',k.length);console.log('sample',k[0],j[k[0]]);"
```
Expected: prints a filename like `mn1.json`, a positive form count, and a sample entry with a `senses` array and `term` field.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts src/pages/dpd/[id].json.ts
git commit -m "feat: per-sutta DPD JSON endpoint"
```

---

### Task 5: Client lookup — caret hit-test, fetch, tooltip (`src/components/PaliLookup.astro`)

No per-word DOM. A throttled `mousemove` over the Pāli pane resolves the word via the caret API, looks it up in the fetched JSON, draws a floating highlight box + tooltip. Click dispatches a dialog-open event (handled in Task 6).

**Files:**
- Create: `src/components/PaliLookup.astro`
- Modify: `src/components/SuttaView.astro` (add `data-dpd-src` + `data-sutta-id` on the Pāli pane container; include `PaliLookup`)
- Modify: `src/pages/sutta/[id]/[version]/[model].astro` (only if include is cleaner there — see step) 

**Interfaces:**
- Consumes: `/dpd/<id>.json` (Task 4); `PALI_LETTERS`, `wordAt` (Task 1).
- Produces: dispatches `document` CustomEvent `suttamula:open-dialog` with `detail: { title: string, senses: Array<{lemma,pos,meaning}>, term: string | null }` (consumed in Task 6).

- [ ] **Step 1: Mark the Pāli pane in `SuttaView.astro`**

The `.sutta` grid mixes Pāli and English cells, so scope the lookup to a wrapper around the whole doc and identify Pāli cells by their existing `.seg--pali` class. Add `data-sutta-id` and a JSON src to the `.sutta-doc` root (line 30) and include the component. Change line 30 from:

```astro
<div class="sutta-doc">
```
to:
```astro
<div class="sutta-doc" data-sutta-id={suttaId} data-dpd-src={`/dpd/${suttaId}.json`}>
```

Add the import at the top of the frontmatter (after line 4):
```astro
import PaliLookup from './PaliLookup.astro';
```

Add the component just before the closing `</div>` of `.sutta-doc` (after line 65, before line 66 `</div>`):
```astro
  <PaliLookup />
```

- [ ] **Step 2: Create `PaliLookup.astro` with the floating UI shell**

```astro
---
// Runtime DPD lookups for the Pāli column. No per-word markup: the word under
// the pointer is resolved via the caret API, then looked up in the per-sutta
// JSON fetched on demand. A click opens the shared term dialog (TermDialog).
---
<div id="pali-tip" class="pali-tip" hidden></div>
<div id="pali-hl" class="pali-hl" hidden></div>

<style>
  .pali-tip {
    position: fixed; z-index: 50; max-width: 22rem;
    background: var(--parchment); color: var(--ink);
    border: 1px solid var(--sand); border-top: 3px solid var(--oxblood);
    border-radius: 3px; padding: 0.6rem 0.75rem;
    box-shadow: 0 16px 40px -16px rgba(42, 32, 24, 0.45);
    font-size: 0.85rem; line-height: 1.35; pointer-events: none;
  }
  .pali-tip__def { margin: 0 0 0.5rem; font-style: italic; color: #4a3d30; }
  .pali-tip__dpd { display: flex; gap: 0.45rem; }
  .pali-tip__logo { width: 16px; height: 16px; flex: none; margin-top: 0.15rem; }
  .pali-tip__senses { margin: 0; padding: 0; list-style: none; }
  .pali-tip__senses li { margin: 0 0 0.2rem; }
  .pali-tip__lemma { font-weight: 600; }
  .pali-tip__pos { color: var(--muted); font-style: italic; margin: 0 0.3rem; }
  .pali-tip__more { color: var(--muted); font-size: 0.78rem; }
  .pali-hl {
    position: fixed; z-index: 49; pointer-events: none;
    border-bottom: 2px solid var(--oxblood); background: rgba(117, 40, 3, 0.07);
  }
</style>

<script>
  import { PALI_LETTERS, wordAt } from '../lib/pali.mjs';

  type Sense = { lemma: string; pos: string; meaning: string };
  type Entry = { senses: Sense[]; term: string | null };
  type Data = Record<string, Entry>;

  const TIP_CAP = 6;
  const cache = new Map<string, Promise<Data>>();
  const tip = document.getElementById('pali-tip') as HTMLElement;
  const hl = document.getElementById('pali-hl') as HTMLElement;

  function load(src: string): Promise<Data> {
    if (!cache.has(src)) {
      cache.set(src, fetch(src).then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<Data>);
    }
    return cache.get(src)!;
  }

  // Cross-browser caret hit-test -> { node, offset } for a text node, else null.
  function caretAt(x: number, y: number): { node: Text; offset: number } | null {
    const d = document as any;
    if (d.caretPositionFromPoint) {
      const p = d.caretPositionFromPoint(x, y);
      if (p && p.offsetNode && p.offsetNode.nodeType === 3) return { node: p.offsetNode, offset: p.offset };
    } else if (d.caretRangeFromPoint) {
      const r = d.caretRangeFromPoint(x, y);
      if (r && r.startContainer && r.startContainer.nodeType === 3) return { node: r.startContainer, offset: r.startOffset };
    }
    return null;
  }

  // Expand a text-node offset to the Pāli word range, for positioning.
  function wordRange(node: Text, offset: number): Range | null {
    const text = node.data;
    const LETTER = new RegExp(`[${PALI_LETTERS}]`, 'u');
    let start = offset, end = offset;
    while (start > 0 && LETTER.test(text[start - 1])) start--;
    while (end < text.length && LETTER.test(text[end])) end++;
    if (start === end) return null;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  }

  function inPaliPane(node: Node | null): HTMLElement | null {
    const el = (node && (node.nodeType === 3 ? node.parentElement : (node as HTMLElement))) || null;
    return el ? el.closest('.seg--pali') as HTMLElement | null : null;
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function dpdHtml(senses: Sense[]) {
    const items = senses.slice(0, TIP_CAP).map((s) =>
      `<li><span class="pali-tip__lemma">${escapeHtml(s.lemma)}</span>` +
      (s.pos ? `<span class="pali-tip__pos">${escapeHtml(s.pos)}</span>` : ' ') +
      `${escapeHtml(s.meaning)}</li>`).join('');
    const more = senses.length > TIP_CAP ? `<div class="pali-tip__more">+${senses.length - TIP_CAP} more — click for all</div>` : '';
    return `<div class="pali-tip__dpd"><img class="pali-tip__logo" src="/dpd-logo-48.png" alt="DPD" />` +
      `<ul class="pali-tip__senses">${items}</ul></div>${more}`;
  }

  // The curated tooltip text, if any, is read from TermDialog's inlined defs blob.
  function curatedTooltip(term: string | null): string {
    if (!term) return '';
    try {
      const defs = JSON.parse(document.getElementById('term-defs')?.textContent || '{}');
      return defs[term]?.tooltip || '';
    } catch { return ''; }
  }

  function showTip(entry: Entry, rect: DOMRect) {
    const def = curatedTooltip(entry.term);
    tip.innerHTML = (def ? `<p class="pali-tip__def">${escapeHtml(def)}</p>` : '') + dpdHtml(entry.senses);
    tip.hidden = false;
    // Position below the word, clamped to viewport.
    const tr = tip.getBoundingClientRect();
    let left = Math.min(rect.left, window.innerWidth - tr.width - 8);
    let top = rect.bottom + 6;
    if (top + tr.height > window.innerHeight - 8) top = rect.top - tr.height - 6;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }

  function showHighlight(rect: DOMRect) {
    hl.hidden = false;
    hl.style.left = `${rect.left}px`;
    hl.style.top = `${rect.top}px`;
    hl.style.width = `${rect.width}px`;
    hl.style.height = `${rect.height}px`;
  }

  function hide() { tip.hidden = true; hl.hidden = true; }

  let raf = 0;
  let lastWord = '';

  async function onMove(e: MouseEvent) {
    const pane = e.target instanceof Node ? inPaliPane(e.target) : null;
    if (!pane) { hide(); lastWord = ''; return; }
    const root = pane.closest('[data-dpd-src]') as HTMLElement | null;
    if (!root) { hide(); return; }
    const hit = caretAt(e.clientX, e.clientY);
    if (!hit) { hide(); lastWord = ''; return; }
    const word = wordAt(hit.node.data, hit.offset);
    if (!word) { hide(); lastWord = ''; return; }
    if (word === lastWord && !tip.hidden) return;
    lastWord = word;
    const data = await load(root.dataset.dpdSrc!);
    const entry = data[word];
    if (!entry) { hide(); return; }
    const range = wordRange(hit.node, hit.offset);
    if (!range) { hide(); return; }
    const rect = range.getBoundingClientRect();
    showHighlight(rect);
    showTip(entry, rect);
  }

  function arm() {
    const root = document.querySelector('[data-dpd-src]') as HTMLElement | null;
    if (root) load(root.dataset.dpdSrc!); // idle prefetch
  }

  document.addEventListener('mousemove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; onMove(e); });
  });
  document.addEventListener('scroll', hide, true);

  document.addEventListener('click', async (e) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // don't hijack text selection
    const pane = e.target instanceof Node ? inPaliPane(e.target) : null;
    if (!pane) return;
    const root = pane.closest('[data-dpd-src]') as HTMLElement | null;
    if (!root) return;
    const hit = caretAt((e as MouseEvent).clientX, (e as MouseEvent).clientY);
    if (!hit) return;
    const word = wordAt(hit.node.data, hit.offset);
    if (!word) return;
    const data = await load(root.dataset.dpdSrc!);
    const entry = data[word];
    if (!entry) return;
    document.dispatchEvent(new CustomEvent('suttamula:open-dialog', {
      detail: { title: entry.term || entry.senses[0]?.lemma || word, senses: entry.senses, term: entry.term },
    }));
  });

  arm();
  document.body.addEventListener('htmx:afterSwap', arm); // re-prefetch after version/model swap
</script>
```

- [ ] **Step 3: Build, run the dev server, verify the tooltip**

Run:
```bash
npm run build:db
npx astro dev --background
npx astro dev status
```
Then in a browser open a sutta page (e.g. `/sutta/mn1/latest/<model>`) and hover a Pāli word. Expected: a floating tooltip with the DPD logo and up to 6 senses appears, and the hovered word gets an oxblood underline box. Hovering whitespace hides it. (Use the playwright MCP browser to screenshot if needed.)

- [ ] **Step 4: Commit**

```bash
git add src/components/PaliLookup.astro src/components/SuttaView.astro
git commit -m "feat: client-side DPD Pāli lookup via caret hit-test + tooltip"
```

---

### Task 6: Click dialog — combine DPD + curated definition (`src/components/TermDialog.astro`)

Listen for `suttamula:open-dialog` and render the full DPD sense list (logo header), prepended with the curated definition body when the word is curated.

**Files:**
- Modify: `src/components/TermDialog.astro`

**Interfaces:**
- Consumes: `suttamula:open-dialog` CustomEvent `{ title, senses: Array<{lemma,pos,meaning}>, term }` (Task 5); the existing inlined `defs` blob (`#term-defs`).

- [ ] **Step 1: Add a DPD-block renderer and the event listener**

In the `<script>` of `TermDialog.astro`, after the existing `defs` constant (after line 63), add:

```ts
  function escapeDpd(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderDpdSection(senses: Array<{ lemma: string; pos: string; meaning: string }>) {
    const items = senses.map((s) =>
      `<li><span class="dpd-lemma">${escapeDpd(s.lemma)}</span>` +
      (s.pos ? `<span class="dpd-pos">${escapeDpd(s.pos)}</span>` : ' ') +
      `${escapeDpd(s.meaning)}</li>`).join('');
    return `<div class="dpd-section"><div class="dpd-head">` +
      `<img class="dpd-logo" src="/dpd-logo-48.png" alt="" /><span>Digital Pāli Dictionary</span></div>` +
      `<ul class="dpd-list">${items}</ul></div>`;
  }

  document.addEventListener('suttamula:open-dialog', (e) => {
    const { title, senses, term } = (e as CustomEvent).detail as {
      title: string; senses: Array<{ lemma: string; pos: string; meaning: string }>; term: string | null;
    };
    titleEl.textContent = title;
    const curated = term && defs[term] ? defs[term].html : '';
    bodyEl.innerHTML = curated + renderDpdSection(senses);
    dialog.showModal();
  });
```

- [ ] **Step 2: Add styles for the DPD section**

In the `<style>` block of `TermDialog.astro`, after line 56, add:

```css
  .term-dialog__body :global(.dpd-section) { margin-top: 1rem; padding-top: 0.8rem; border-top: 1px solid var(--sand); }
  .term-dialog__body :global(.dpd-head) { display: flex; align-items: center; gap: 0.5rem; color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.5rem; }
  .term-dialog__body :global(.dpd-logo) { width: 18px; height: 18px; }
  .term-dialog__body :global(.dpd-list) { margin: 0; padding-left: 1.1rem; }
  .term-dialog__body :global(.dpd-list li) { margin: 0 0 0.35rem; }
  .term-dialog__body :global(.dpd-lemma) { font-weight: 600; }
  .term-dialog__body :global(.dpd-pos) { color: var(--muted); font-style: italic; margin: 0 0.3rem; }
```

- [ ] **Step 3: Build, run, and verify the dialog**

Run:
```bash
npm run build:db
npx astro dev stop && npx astro dev --background
```
In the browser, on a sutta page: (a) click a plain Pāli word → dialog opens with the DPD section (logo header + full sense list, no cap); (b) click a curated word (one whose lemma is `dhamma`, e.g. `dhammaṃ` / `dhammā`) → dialog shows the curated `dhamma` prose **followed by** the DPD section. Confirm the English-side `*term*` dialog (existing behavior) still works.

- [ ] **Step 4: Run the full test suite and build**

Run:
```bash
npm test && npm run build
```
Expected: all `node --test` tests pass; build completes and emits `dist/dpd/*.json`.

- [ ] **Step 5: Commit**

```bash
git add src/components/TermDialog.astro
git commit -m "feat: combine DPD senses + curated definition in the term dialog"
```

---

## Notes for the implementer

- **Restart the dev server after every `build:db`** — it reads the DB once at import (see CLAUDE.md). Tasks 5–6 verification depends on fresh data.
- The caret approach trades away keyboard navigation of individual Pāli words by design (pointer/touch only). English-side curated terms keep their `<span>`s and stay keyboard-accessible.
- If `data/dpd.db` is absent in an environment, Task 3 logs and skips; the endpoint then emits empty `{}` objects and the client simply shows no tooltips — the site still builds.
