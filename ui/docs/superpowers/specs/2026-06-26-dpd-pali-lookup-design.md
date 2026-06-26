# DPD Pāli dictionary lookup — design

**Date:** 2026-06-26
**Status:** Approved (design); implementation plan pending

## Goal

Make every Pāli word in the left (Pāli) column of the sutta view a dictionary
lookup, sourced from the Digital Pāli Dictionary (`data/dpd.db`). Hovering a word
shows a compact tooltip of its DPD senses; clicking opens the existing shared
dialog with the fuller list. Where a Pāli word also has a curated definition
(`src/content/definitions/<slug>.md` with a `tooltip:`), the hover shows **both**
(our definition + DPD, two-in-one) and the click dialog shows the curated body
**plus** a DPD section. DPD content is marked with the DPD logo
(`public/dpd-logo-48.png`).

## Constraints / decisions

- **Scope:** every Pāli word in the left column (full coverage), not a curated subset.
- **No-match words** (compounds, sandhi, rare forms): left as plain text, not interactive.
- **Tooltip depth:** all senses for the form, compact — `lemma · grammar · meaning_1`,
  one line each — **capped at 6** in the hover tooltip; the full list lives in the click dialog.
- **Interaction:** hover tooltip **+** click dialog. Pointer/touch only (see DOM approach).
- **DOM:** **no per-word markup.** The Pāli stays a plain text node; the hovered word is
  resolved at runtime via caret hit-testing (Option B below). Only the English-side curated
  terms keep their existing `<span>`s and keyboard accessibility.
- **Data delivery:** per-sutta JSON fetched lazily (`fetch()`), not inlined — the Pāli is
  identical across all version/model combos, so one file serves every tab and is browser-cached.
- **The 2.1 GB `dpd.db` is a build-time input only** — never read at runtime, never shipped,
  never pulled into the Astro build. Consistent with how `suttamula.db` already works.

## Architecture

### 1. Precompute DPD data into `suttamula.db` (`scripts/build-db.mjs` + `scripts/lib/`)

During `npm run build:db`:

1. Tokenize every Pāli segment already being ingested. Tokenizer (new, in `scripts/lib/`,
   pure + unit-tested): split on whitespace/punctuation, normalize each token —
   lowercase, strip leading/trailing non-Pāli letters, keep internal diacritics
   (`ā ī ū ṅ ñ ṭ ḍ ṇ ḷ ṃ`). Collect the **set of unique normalized forms** across the corpus.
2. Batch-query `data/dpd.db`:
   - `lookup.lookup_key = form` → JSON array of headword ids (chunked `IN (...)`).
   - `dpd_headwords` for those ids → `lemma_1`, `grammar` (or `pos`), `meaning_1`.
3. For each matched form, build `senses`: array of `{ lemma, grammar, meaning }`,
   deduped, with the trailing sense number stripped from `lemma_1` (e.g. `dukkha 3` → `dukkha`).
   Store **all** senses (UI caps the hover at 6).
4. Curated overlap: for each sense, if the stripped lemma matches a definition slug
   (the slug set known to the build), record `term: <slug>` on the form's record.
5. Write a new table to `suttamula.db`:
   ```sql
   CREATE TABLE dpd (form TEXT PRIMARY KEY, senses TEXT NOT NULL, term TEXT);
   ```
   `senses` = JSON; `term` = matching definition slug or NULL.

This keeps the giant DB out of the Astro build; Astro reads only the small `dpd` table.

### 2. Per-sutta JSON endpoint (`src/pages/dpd/[id].json.ts`, new)

- `getStaticPaths` over all sutta ids; keyed by **sutta id only** (DPD data is
  version/model-independent).
- For each sutta, gather the normalized forms of its Pāli segments, read their rows
  from the `dpd` table, emit `{ [form]: { senses: [...], term: <slug|null> } }` as a
  static JSON file (`dist/dpd/<id>.json`). Edge-cacheable, ~50–150 KB, gzips well.
- A small lib helper resolves a sutta's forms → `dpd` rows (reuses the same tokenizer
  via a shared module, or a build-time form list).

### 3. Sutta view (`SuttaView.astro`)

- Pāli rendering is unchanged except for a hint attribute on the Pāli pane container:
  `data-dpd-src="/dpd/<id>.json"`. **No per-word spans.**
- Include the new `PaliLookup` client component/script.

### 4. Caret hit-testing + tooltip (`PaliLookup`, new client script/component)

- **Data load:** module-level `Map<id, Promise<data>>` caches the parsed JSON per sutta.
  Prefetch kicked off on load and on `htmx:afterSwap` (idle), so data is usually ready
  before first hover; an early hover awaits the in-flight promise. Same `id` across
  version/model swaps → cache hit, no re-fetch.
- **Hover (throttled `mousemove` on the Pāli pane):**
  1. `caretPositionFromPoint(x, y)` (WebKit fallback: `caretRangeFromPoint`) → text node + offset.
  2. Expand to the word boundary within the text node; normalize the same way as the tokenizer
     (shared normalize fn so build and client agree).
  3. Look the form up in the fetched map. If absent → hide tooltip, no highlight.
  4. If present → highlight the hovered word with a **single transient `<span>`**
     (wrap the word's Range), removed on mouse-leave / when the word changes — DOM never
     holds more than one highlight span. Position one shared floating tooltip `<div>` under it.
- **Tooltip content:** up to 6 senses (`lemma · grammar · meaning`). If `term` is set,
  render the curated definition's `tooltip` text on top, then the DPD block beneath,
  with the DPD logo (`/dpd-logo-48.png`) marking the DPD block. Built lazily on first show.
- **Click:** caret hit-test the word under the pointer (works for tap too), look it up,
  open the shared dialog.

### 5. Click dialog (extend `TermDialog.astro`)

- Reuse the existing shared `<dialog>`.
- DPD-only word → dialog body = full DPD sense list with a logo-marked header.
- Curated word (`term` set) → dialog body = curated markdown body (existing `defs[slug].html`)
  **plus** a DPD section (logo) below.
- Extend the dialog's open API so it can be invoked with a DPD payload (not only a definition
  slug). Re-wire on `htmx:afterSwap`, like the existing terms.
- The DPD logo block is shared markup between tooltip and dialog (small helper / partial).

## Data flow

```
build:db: Pāli segments → tokenize/normalize → unique forms
        → query dpd.db (lookup → dpd_headwords) → dedupe senses + curated-overlap
        → write `dpd` table in suttamula.db

build:    src/pages/dpd/[id].json.ts → reads `dpd` table → dist/dpd/<id>.json
          SuttaView → Pāli pane with data-dpd-src (no spans)

runtime:  PaliLookup → fetch /dpd/<id>.json (cached per id)
          mousemove → caretPositionFromPoint → word → normalize → map lookup
                    → transient highlight + tooltip (DPD ± curated, logo)
          click/tap → same lookup → shared dialog (full DPD ± curated body)
```

## Error handling / edge cases

- **Caret API absent / returns nothing:** no-op (no tooltip). Feature degrades to plain text.
- **JSON fetch fails:** log, no tooltips; page otherwise unaffected.
- **Word spans multiple text nodes / inside punctuation:** boundary expansion stays within a
  single text node; if normalization yields no map hit, no-op.
- **HTMX swap mid-hover:** highlight span is transient and recreated; prefetch re-armed on swap.
- **Common words with many headwords** (e.g. `dhammaṃ` → 17): hover capped at 6, full set in dialog.
- **Selection/copy:** no persistent spans means Pāli text selection/copy stays clean.

## Testing

- **Unit (`node --test`):** the tokenizer/normalizer (pure) — punctuation stripping, diacritics
  preserved, lowercasing, idempotence; build-side form→senses dedupe and curated-overlap tagging.
- **Build smoke:** `npm run build:db` produces a non-empty `dpd` table; `/dpd/<id>.json` emits
  for a known sutta and contains expected forms (e.g. `dhammaṃ`, `bhikkhave`).
- **Manual:** hover/click a known Pāli word (DPD-only and a curated one, e.g. `dhamma`) in the
  dev server; verify two-in-one tooltip, logo, dialog, and version/model swap re-wiring.

## Non-goals (YAGNI)

- No compound deconstruction for no-match words (left plain).
- No keyboard navigation of individual Pāli words (pointer/touch only by design).
- No DPD content for the English column beyond the existing curated-definition behavior.
- No runtime access to `dpd.db`.
