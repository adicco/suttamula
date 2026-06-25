# Suttamūla UI — agent guide

Static Astro site serving the project's Pāli↔English Canon translations. Node only (never Bun).

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

**Gotcha:** the dev server reads `data/suttamula.db` once at import. After running `npm run build:db`, **restart the dev server** (`astro dev stop && astro dev --background`) — a long-running dev server serves stale data and will 404 pages for suttas added since it started.

## Build & data pipeline

```
npm run build:db   # regenerate data/suttamula.db (run after any data/source change)
npm run build      # build:db, then astro build  -> dist/
npm test           # node --test (pure logic in scripts/lib + src/lib)
```

- `scripts/build-db.mjs` builds a **build-time-only** SQLite DB at `data/suttamula.db` (gitignored, never shipped, never read at runtime). Astro reads it only during the build via `src/lib/db.ts` (resolved from `process.cwd()`, since the module is bundled into `dist/.prerender`).
- Sources, relative to `ui/`:
  - translations: `../translation/<version>/<model>/<nikaya>/[<vagga>/]<sutta>.json`
  - Pāli root: **`../../bilara-data`** (a sibling of the suttamula repo, two levels up — not inside it)
  - prompts: `../prompts/<version>.md` (stored in the DB and shown at `/prompts`)
- Pāli files are joined by **indexing every `*_root-pli-ms.json` by its sutta id** (`buildPaliIndex`), so nikāya nesting differences don't matter (e.g. UD lives at `kn/ud/vagga1/`, AN at `an/an1/`).
- Segments are **Pāli-anchored**: every Pāli segment appears in source order, English where present (null otherwise) — so Pāli-only segments (common in AN) still render. See `zipSegments` in `scripts/lib/extract.mjs`.
- **Sutta title** is the last section-0 header segment before the text (`titleFromMap`). Position varies: MN `:0.2`, SN/AN `:0.3`. Don't hardcode `:0.3`.

## Routing & conventions

- Sutta URL: `/sutta/[id]/[version]/[model]`. `version` may be `latest` (resolved per-sutta to its newest available version; not every sutta exists in the global latest).
- **Model slug:** model ids contain a colon (`gpt-5.5:medium`). URLs use a colon-free slug (`gpt-5.5-medium`) via `modelToSlug`; reversed by lookup (`slugToModel`). Never percent-encode the colon — the dev router 404s on `%3A` and CDNs are inconsistent. The colon form is fine as a *display label* (the tab text), just not in the path.
- Pages: `/` (collapsible full listing, KN books nested under a KN banner — anything outside DN/MN/SN/AN is treated as a Khuddaka book), `/[nikaya]`, `/sutta/...`, `/prompts`, `/prompts/[version]`, `/terms`. Homepage and `/[nikaya]` share `src/components/SuttaList.astro`.

## Pāli terms & definitions

- Definitions: `src/content/definitions/<slug>.md`, optional `tooltip:` frontmatter; body is the dialog content. Collection defined in `src/content.config.ts`.
- A term is interactive **only if a matching definition file exists** (def-gated). `renderEnglishWithTerms` (in `src/lib/terms.ts`) turns `*term*` / `[*pali*]` into `.pali-term` spans, falling back to plain `<em>` otherwise. It also matches simple `-s` plurals. Passing an **empty slug set** renders italics without interactivity (used for titles/headings).
- `src/components/TermDialog.astro` inlines **all** definitions (rendered HTML) as JSON into each page and wires `.pali-term` clicks to one shared `<dialog>`. Fully preloaded, zero-latency; re-wires on `htmx:afterSwap`. If the term count grows large, consider inlining only per-page referenced slugs.

## Sutta view (`src/components/SuttaView.astro`)

- Pāli left (fixed), English right (selected version/model). Version/model tabs are `<a hx-get>` links that swap the whole `.sutta-doc` from the target combination's own static page (`hx-select=".sutta-doc"`) — edge-cacheable, and degrades to full navigation without JS.
- Layout (columns ↔ line-by-line) is client-side CSS driven by `?view=` query param + `localStorage` — shareable and still serves identical cacheable HTML.

## Design

- Fonts are vendored in `public/fonts/`: **Coelacanth** (reading text, Pāli + English; converted from the GitLab OTF release to woff2) and **Geist** (UI chrome). HTMX is vendored at `public/htmx.min.js`.
- Palette (tokens in `src/styles/global.css`): `--oxblood #752803` (logo brown, accent), `--parchment #FBF8F2`, `--sand #EFE7D9`, `--ink #2A2018`, `--muted #8A7E6E`.
- Keep underlines minimal (the project owner finds them heavy); use color/hover cues. Pāli-only fallback titles render italic at 0.8 opacity.

## Specs & plans

Design spec and implementation plan live in `docs/superpowers/`.

## Astro documentation

Full docs: https://docs.astro.build — see [routing](https://docs.astro.build/en/guides/routing/), [components](https://docs.astro.build/en/basics/astro-components/), [content collections](https://docs.astro.build/en/guides/content-collections/), [styling](https://docs.astro.build/en/guides/styling/).
