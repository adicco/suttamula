# Suttamūla UI — Design Spec

Date: 2026-06-25

## Goal

A fully static Astro website that serves the project's custom LLM translations of the
Pāli Canon alongside the Pāli source, with maximum transparency (every prompt version,
model, and editorial term-choice visible). Node toolchain throughout (not Bun).

## Source data (read-only inputs)

- **Translations**: `../translation/<version>/<model>/<nikaya>/<vagga?>/<sutta>.json`
  Flat map `segment-id → English`. Models may contain a colon (e.g. `gpt-5.5:medium`).
  Versions seen: `0.1`, `0.2`.
- **Pāli source**: `../bilara-data/root/pli/ms/sutta/<nikaya>/<vagga?>/<sutta>_root-pli-ms.json`
  Flat map `segment-id → Pāli`. Segment-ids align exactly with translations.
- **Prompts**: `../prompts/<version>.md` (and `../PROMPT.md` is the symlinked current one).

Paths are relative to the `ui/` app root via a configurable constant (default `../`).

## 1. Data pipeline — `scripts/build-db.mjs` (Node)

A Node script (run via `npm run build:db`) generates a local **SQLite** database using
`better-sqlite3`. The DB is a **build-time-only intermediate**: gitignored, regenerated on
demand, read by Astro only at build time. It is never shipped to the browser.

### Schema

```sql
suttas(
  id TEXT PRIMARY KEY,        -- e.g. "sn12.1"
  nikaya TEXT,                -- "sn"
  vagga TEXT,                 -- "sn12" or NULL where flat (e.g. mn9)
  title_pali TEXT,            -- from segment :0.3 of the Pāli file
  title_en TEXT,              -- from segment :0.3 of a translation file
  order_key TEXT              -- natural sort key for browse ordering
)

translations(
  sutta_id TEXT,
  version TEXT,               -- "0.1", "0.2"
  model TEXT,                 -- "sonnet", "gpt-5.5:medium"
  PRIMARY KEY (sutta_id, version, model)
)

segments(
  sutta_id TEXT,
  version TEXT,
  model TEXT,
  seg_id TEXT,                -- "sn12.1:1.1"
  seg_order INTEGER,          -- preserves source order
  pali TEXT,                  -- joined from bilara-data by seg_id (may be NULL)
  english TEXT
)

versions(
  version TEXT PRIMARY KEY,
  is_latest INTEGER          -- 1 for the newest version
)

prompts(
  version TEXT PRIMARY KEY,   -- matches versions.version
  body_md TEXT               -- full markdown text of ../prompts/<version>.md
)
```

### Behaviour

- Walk every `translation/<version>/<model>/**/*.json`, derive `(version, model, sutta_id)`.
- For each, load the matching Pāli file and join Pāli ↔ English by `seg_id`, preserving
  the source key order as `seg_order`.
- `nikaya` / `vagga` derived from the sutta id and source path.
- `latest`: the highest version (string-sorted with numeric awareness; currently `0.2`)
  gets `is_latest = 1`.
- Store every prompt file's full markdown in `prompts`.
- Idempotent: drops and recreates tables each run.

## 2. Routing & static generation

All pages prerendered to static HTML. Root-domain deploy, **no base path**.

- `/` — landing: list of nikāyas present in the DB (SN, MN, AN, UD…), each with sutta count.
- `/[nikaya]` — browse: suttas grouped by vagga (where a vagga exists), in `order_key` order.
  Each links to its default sutta view (`latest` + a default model).
- `/sutta/[id]/[version]/[model]` — sutta view. Generated via `getStaticPaths` for **every**
  real `(id, version, model)` row in `translations`, **plus** a `latest` alias set
  (`version = "latest"` resolved to the newest version's content). The colon in `model`
  is kept and URL-encoded.
- `/prompts` — lists all prompt versions; `/prompts/[version]` renders one prompt's full text.
- `/terms` — index of all Pāli term definitions.

## 3. Sutta view + HTMX switching

Two columns:
- **Left (fixed): Pāli source.**
- **Right (selected): English translation** for the current `(version, model)`.

### Controls

- **Version tabs** and **model tabs** above the English column. Each is an `<a>` linking to
  the target combination's own static page, enhanced with HTMX:
  `hx-get="<target page url>"`, `hx-select=".english-pane"`, `hx-target=".english-pane"`,
  `hx-swap="outerHTML"`, `hx-push-url="true"`.
  HTMX fetches the **already-cached static page** for the target combination and grafts in
  its English pane — no separate fragment files, fully edge-cache friendly. Without JS the
  links degrade to ordinary full-page navigation.
- **"View prompt" affordance** next to the version tabs → links to `/prompts/[version]`
  (the prompt that produced the current translation). Transparency goal.
- **Layout toggle** (columns ↔ line-by-line). Pure client-side CSS, persisted in
  `localStorage`. Both layouts are rendered in the DOM; CSS switches between:
  - **columns**: Pāli pane | English pane side by side.
  - **line-by-line**: per segment, Pāli line above its English line.

Segment numbering shown in a gutter (like the reference screenshot).

## 4. Pāli terms — tooltip + dialog

- Astro **content collection** at `src/content/definitions/[term].md`.
  Frontmatter: `tooltip?: string` (hover text). Markdown body = dialog content.
- At build, English segment text is scanned for `*term*` (untranslated terms) and `[*pali*]`
  (bracketed originals). An occurrence becomes an interactive `<span class="pali-term">`
  **only if a matching definition file exists**; otherwise it renders as plain italic text.
  Term key matching is normalised (lowercase, diacritics preserved) to a file slug.
- Interaction: hover → `tooltip` (CSS/title-based tooltip); click → opens a native
  `<dialog>` rendering the term's markdown body. One shared dialog element, populated on click.
- `/terms` lists every definition with its tooltip; clicking opens the same dialog.
- Markdown → HTML for definition bodies is rendered at build time.

## 5. Typography & colour (design direction)

Vision: a transparent, "return-to-the-root" scripture edition — a reading instrument.
Minimal direction; precision in spacing and type carries it. Restraint everywhere except
the one signature element.

### Palette (CSS custom properties)

| Token | Hex | Use |
|-------|-----|-----|
| `--oxblood` | `#752803` | primary accent: active tabs, links, dhammacakka mark, rule accents (logo brown) |
| `--parchment` | `#FBF8F2` | page background (warm off-white) |
| `--sand` | `#EFE7D9` | gutter / divider tone / inactive-pane wash |
| `--ink` | `#2A2018` | warm near-black body text |
| `--muted` | `#8A7E6E` | segment numbers, inactive tabs, metadata |

Deliberately deeper than the default AI "cream + terracotta" look — the accent is a
printed-scripture red-brown, the ground is warmer than #F4F1EA.

### Type (3 roles)

- **Coelacanth** (vendored from https://gitlab.com/Fuzzypeg/coelacanth into `public/fonts/`,
  declared via `@font-face`) — both Pāli and English **reading text**. A Garamond-class face
  built for IAST/Pāli diacritics: the subject's own vernacular.
- **Coelacanth small-caps, letterspaced** — section eyebrows / nikāya labels.
- **Geist** (sans) — UI chrome only (tabs, nav, segment-number gutter, metadata); small and
  letterspaced so it never competes with the reading text.

### Layout

Centered reading measure; two panes divided by a single hairline rule (no heavy boxes).
Slim sticky tab bar. Segment numbers hang in a quiet Geist gutter.

### Signature — "trace back to the root"

- Interactive Pāli terms (§4) render in Coelacanth italic with a fine **dotted oxblood
  underline** inviting the click → dialog.
- The **dhammacakka wheel** (from the logo) recurs sparingly as the section divider and as the
  term-dialog header mark — one motif, used with restraint.
- In **line-by-line** mode the Pāli sits a step larger above its English, both hung on the same
  segment number: root above, rendering below.

### Quality floor

Responsive to mobile (columns collapse to stacked/line-by-line), visible keyboard focus,
`prefers-reduced-motion` respected, native `<dialog>` for accessible term modals.

## 6. Deployment

- Pure static `astro build` output, served at a root domain. No base path.
- Node only. `npm run build:db && astro build` produces the site.

## Non-goals / assumptions

- No runtime database or server; SQLite is build-time only.
- No client-side search in v1 (browse is hierarchical nikāya → vagga → sutta).
- `notes/` (editorial footnotes) is **out of scope** for this iteration (directory not yet present).
- Default model for browse links: the model present for the `latest` version (first
  alphabetically if multiple); chosen deterministically at build.
