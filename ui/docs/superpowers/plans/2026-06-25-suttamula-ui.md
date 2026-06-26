# Suttamūla UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fully static Astro site serving the project's Pāli↔English sutta translations with version/model switching, interactive Pāli-term definitions, and full prompt transparency.

**Architecture:** A Node script reads the JSON translations + bilara-data Pāli + prompt files and builds a build-time-only SQLite DB. Astro reads that DB at build time via `getStaticPaths` to prerender every `(sutta, version, model)` combination plus `latest` aliases. HTMX swaps the English pane between cached static pages (edge-cache friendly). Pāli terms with a definition file become interactive (tooltip + native `<dialog>`).

**Tech Stack:** Astro 7 (static output), `better-sqlite3` (build-time only), HTMX (vendored), Coelacanth + Geist fonts (vendored, `@font-face`), Node built-in test runner (`node --test`).

## Global Constraints

- Node only, **never Bun**. Node `>=22.12.0` (per `package.json`).
- Dev server runs in background: `astro dev --background` (per `CLAUDE.md`).
- SQLite DB is a **build-time-only intermediate**: gitignored, never shipped to the browser, never read at runtime.
- Root-domain deploy: **no base path**.
- Data source roots are relative to `ui/`: translations `../translation`, Pāli `../bilara-data/root/pli/ms/sutta`, prompts `../prompts`. Centralize as constants.
- URL scheme: `/sutta/[id]/[version]/[model]`; model keeps its colon (URL-encoded). `latest` is a valid `version`.
- Palette: `--oxblood #752803`, `--parchment #FBF8F2`, `--sand #EFE7D9`, `--ink #2A2018`, `--muted #8A7E6E`.
- Fonts: Coelacanth for Pāli + English reading text; Geist (sans) for UI chrome only.
- Pāli terms are interactive **only if** a matching `src/content/definitions/<slug>.md` exists; otherwise plain italic.
- Accessibility floor: responsive to mobile, visible keyboard focus, `prefers-reduced-motion` respected, native `<dialog>` for term modals.

---

## File Structure

- `scripts/lib/extract.mjs` — pure, testable functions: path parsing, version compare, segment zipping, sutta sort key.
- `scripts/lib/extract.test.mjs` — unit tests for the above.
- `scripts/build-db.mjs` — orchestrates fs walk + SQLite write (uses `extract.mjs`).
- `src/lib/db.ts` — opens the SQLite DB read-only at build time; typed query functions.
- `src/lib/terms.ts` — pure term-slugify + English→HTML term-injection.
- `src/lib/terms.test.mjs` — unit tests for term rendering.
- `src/content.config.ts` — `definitions` content collection schema.
- `src/content/definitions/*.md` — one starter definition (`dhamma.md`).
- `src/styles/global.css` — design tokens, fonts, base layout.
- `src/layouts/Base.astro` — HTML shell, fonts, header, HTMX include.
- `src/components/SuttaView.astro` — two-pane + line-by-line + tabs.
- `src/components/TermDialog.astro` — single shared `<dialog>` + client script.
- `src/components/Dhammacakka.astro` — inline SVG wheel motif.
- `src/pages/index.astro` — nikāya landing.
- `src/pages/[nikaya].astro` — vagga→sutta browse.
- `src/pages/sutta/[id]/[version]/[model].astro` — sutta view (getStaticPaths).
- `src/pages/prompts/index.astro`, `src/pages/prompts/[version].astro` — prompt transparency.
- `src/pages/terms.astro` — definitions index.
- `public/fonts/` — vendored Coelacanth + Geist woff2.
- `public/htmx.min.js` — vendored HTMX.

---

### Task 1: Dependencies, constants, and the extraction library (TDD)

**Files:**

- Modify: `package.json` (add deps + scripts)
- Create: `scripts/lib/extract.mjs`
- Test: `scripts/lib/extract.test.mjs`

**Interfaces:**

- Produces:
  - `parseTranslationPath(relPath: string): { version, model, nikaya, vagga, suttaId, suttaRel }` — `relPath` is POSIX path under `translation/` (e.g. `0.2/gpt-5.5:medium/an/an1/an1.1-10.json`). `suttaRel` is the path under `<version>/<model>/` minus `.json` (e.g. `an/an1/an1.1-10`).
  - `paliRelFor(suttaRel: string): string` — returns `<suttaRel>_root-pli-ms.json`.
  - `compareVersions(a: string, b: string): number` — numeric-aware (`0.2` > `0.1`).
  - `latestVersion(versions: string[]): string`.
  - `zipSegments(paliMap: Record<string,string>, enMap: Record<string,string>): Array<{ seg_id, seg_order, pali, english }>` — order follows `enMap` insertion order; `pali` is `paliMap[seg_id] ?? null`.
  - `suttaSortKey(suttaId: string): string` — zero-padded key so `sn12.1`,`sn12.2`,`sn12.10` sort naturally (e.g. `sn|0000000012|0000000001|...`).

- [ ] **Step 1: Add dependencies and scripts**

Run:

```bash
cd /home/adicco/Code/suttamula/ui
npm install better-sqlite3
```

Then edit `package.json` `scripts` to:

```json
  "scripts": {
    "dev": "astro dev",
    "build:db": "node scripts/build-db.mjs",
    "build": "npm run build:db && astro build",
    "preview": "astro preview",
    "test": "node --test",
    "astro": "astro"
  }
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/lib/extract.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTranslationPath,
  paliRelFor,
  compareVersions,
  latestVersion,
  zipSegments,
  suttaSortKey,
} from "./extract.mjs";

test("parseTranslationPath with vagga", () => {
  const r = parseTranslationPath("0.2/gpt-5.5:medium/an/an1/an1.1-10.json");
  assert.deepEqual(r, {
    version: "0.2",
    model: "gpt-5.5:medium",
    nikaya: "an",
    vagga: "an1",
    suttaId: "an1.1-10",
    suttaRel: "an/an1/an1.1-10",
  });
});

test("parseTranslationPath without vagga", () => {
  const r = parseTranslationPath("0.1/sonnet/mn/mn9.json");
  assert.equal(r.vagga, null);
  assert.equal(r.suttaId, "mn9");
  assert.equal(r.suttaRel, "mn/mn9");
});

test("paliRelFor", () => {
  assert.equal(paliRelFor("sn/sn12/sn12.1"), "sn/sn12/sn12.1_root-pli-ms.json");
});

test("compareVersions numeric-aware", () => {
  assert.ok(compareVersions("0.2", "0.1") > 0);
  assert.ok(compareVersions("0.10", "0.2") > 0);
});

test("latestVersion", () => {
  assert.equal(latestVersion(["0.1", "0.2"]), "0.2");
});

test("zipSegments follows english order and joins pali", () => {
  const pali = { "x:1.1": "P1", "x:1.2": "P2" };
  const en = { "x:1.1": "E1", "x:1.2": "E2" };
  const out = zipSegments(pali, en);
  assert.deepEqual(out, [
    { seg_id: "x:1.1", seg_order: 0, pali: "P1", english: "E1" },
    { seg_id: "x:1.2", seg_order: 1, pali: "P2", english: "E2" },
  ]);
});

test("zipSegments tolerates missing pali", () => {
  const out = zipSegments({}, { "x:1.1": "E1" });
  assert.equal(out[0].pali, null);
});

test("suttaSortKey sorts naturally", () => {
  const ids = ["sn12.10", "sn12.1", "sn12.2"];
  ids.sort((a, b) => suttaSortKey(a).localeCompare(suttaSortKey(b)));
  assert.deepEqual(ids, ["sn12.1", "sn12.2", "sn12.10"]);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test scripts/lib/extract.test.mjs`
Expected: FAIL — `Cannot find module './extract.mjs'`.

- [ ] **Step 4: Implement `extract.mjs`**

Create `scripts/lib/extract.mjs`:

```js
// Pure helpers for the DB build. No fs/sqlite here so they stay unit-testable.

export function parseTranslationPath(relPath) {
  const parts = relPath.split("/");
  const [version, model, ...rest] = parts;
  const nikaya = rest[0];
  const file = rest[rest.length - 1];
  const suttaId = file.replace(/\.json$/, "");
  const vagga = rest.length === 3 ? rest[1] : null;
  const suttaRel = rest.join("/").replace(/\.json$/, "");
  return { version, model, nikaya, vagga, suttaId, suttaRel };
}

export function paliRelFor(suttaRel) {
  return `${suttaRel}_root-pli-ms.json`;
}

function versionTuple(v) {
  return v.split(".").map((n) => parseInt(n, 10));
}

export function compareVersions(a, b) {
  const ta = versionTuple(a),
    tb = versionTuple(b);
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
  const pad = (s) => s.replace(/\d+/g, (n) => n.padStart(10, "0"));
  const m = suttaId.match(/^([a-z]+)(.*)$/);
  const nikaya = m ? m[1] : suttaId;
  const rest = m ? m[2] : "";
  return `${nikaya}|${pad(rest)}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test scripts/lib/extract.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/lib/extract.mjs scripts/lib/extract.test.mjs
git commit -m "feat: extraction helpers + deps for sutta DB build"
```

---

### Task 2: SQLite build script

**Files:**

- Create: `scripts/build-db.mjs`
- Modify: `.gitignore` (ignore the DB)

**Interfaces:**

- Consumes: all of `extract.mjs`.
- Produces: `data/suttamula.db` with tables `suttas`, `translations`, `segments`, `versions`, `prompts` (schema per spec §1). Running the script is idempotent (drops + recreates).

- [ ] **Step 1: Ignore the generated DB**

Append to `.gitignore`:

```
# generated build-time database
data/
```

- [ ] **Step 2: Write the build script**

Create `scripts/build-db.mjs`:

```js
import Database from "better-sqlite3";
import {
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTranslationPath,
  paliRelFor,
  compareVersions,
  latestVersion,
  zipSegments,
  suttaSortKey,
} from "./lib/extract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = join(HERE, "..");
const TRANSLATION_ROOT = join(UI_ROOT, "..", "translation");
const PALI_ROOT = join(
  UI_ROOT,
  "..",
  "bilara-data",
  "root",
  "pli",
  "ms",
  "sutta",
);
const PROMPTS_ROOT = join(UI_ROOT, "..", "prompts");
const DB_DIR = join(UI_ROOT, "data");
const DB_PATH = join(DB_DIR, "suttamula.db");

function walkJson(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkJson(full));
    else if (entry.endsWith(".json")) out.push(full);
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

mkdirSync(DB_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  DROP TABLE IF EXISTS segments;
  DROP TABLE IF EXISTS translations;
  DROP TABLE IF EXISTS suttas;
  DROP TABLE IF EXISTS versions;
  DROP TABLE IF EXISTS prompts;
  CREATE TABLE suttas (
    id TEXT PRIMARY KEY, nikaya TEXT, vagga TEXT,
    title_pali TEXT, title_en TEXT, order_key TEXT
  );
  CREATE TABLE translations (
    sutta_id TEXT, version TEXT, model TEXT,
    PRIMARY KEY (sutta_id, version, model)
  );
  CREATE TABLE segments (
    sutta_id TEXT, version TEXT, model TEXT,
    seg_id TEXT, seg_order INTEGER, pali TEXT, english TEXT
  );
  CREATE INDEX idx_seg ON segments (sutta_id, version, model, seg_order);
  CREATE TABLE versions (version TEXT PRIMARY KEY, is_latest INTEGER);
  CREATE TABLE prompts (version TEXT PRIMARY KEY, body_md TEXT);
`);

const insSutta = db.prepare(
  `INSERT OR REPLACE INTO suttas (id, nikaya, vagga, title_pali, title_en, order_key)
   VALUES (@id, @nikaya, @vagga, @title_pali, @title_en, @order_key)`,
);
const insTrans = db.prepare(
  `INSERT OR REPLACE INTO translations (sutta_id, version, model) VALUES (?, ?, ?)`,
);
const insSeg = db.prepare(
  `INSERT INTO segments (sutta_id, version, model, seg_id, seg_order, pali, english)
   VALUES (@sutta_id, @version, @model, @seg_id, @seg_order, @pali, @english)`,
);

const versionsSeen = new Set();

const run = db.transaction(() => {
  for (const file of walkJson(TRANSLATION_ROOT)) {
    const rel = relative(TRANSLATION_ROOT, file).split("\\").join("/");
    const meta = parseTranslationPath(rel);
    versionsSeen.add(meta.version);

    const enMap = readJson(file);
    const paliPath = join(PALI_ROOT, paliRelFor(meta.suttaRel));
    const paliMap = existsSync(paliPath) ? readJson(paliPath) : {};
    const segs = zipSegments(paliMap, enMap);

    const titlePali = paliMap[`${meta.suttaId}:0.3`]?.trim() ?? null;
    const titleEn = enMap[`${meta.suttaId}:0.3`]?.trim() ?? null;

    insSutta.run({
      id: meta.suttaId,
      nikaya: meta.nikaya,
      vagga: meta.vagga,
      title_pali: titlePali,
      title_en: titleEn,
      order_key: suttaSortKey(meta.suttaId),
    });
    insTrans.run(meta.suttaId, meta.version, meta.model);
    for (const s of segs) {
      insSeg.run({
        ...s,
        sutta_id: meta.suttaId,
        version: meta.version,
        model: meta.model,
      });
    }
  }

  const latest = latestVersion([...versionsSeen]);
  const insVer = db.prepare(
    `INSERT OR REPLACE INTO versions (version, is_latest) VALUES (?, ?)`,
  );
  for (const v of versionsSeen) insVer.run(v, v === latest ? 1 : 0);

  if (existsSync(PROMPTS_ROOT)) {
    const insPrompt = db.prepare(
      `INSERT OR REPLACE INTO prompts (version, body_md) VALUES (?, ?)`,
    );
    for (const entry of readdirSync(PROMPTS_ROOT)) {
      if (!entry.endsWith(".md")) continue;
      const version = entry.replace(/\.md$/, "");
      insPrompt.run(version, readFileSync(join(PROMPTS_ROOT, entry), "utf8"));
    }
  }
});

run();
const n = db.prepare("SELECT COUNT(*) c FROM translations").get().c;
console.log(
  `Built ${DB_PATH}: ${n} translation combinations, versions ${[...versionsSeen].join(", ")}`,
);
db.close();
```

- [ ] **Step 3: Run the build script**

Run: `cd /home/adicco/Code/suttamula/ui && npm run build:db`
Expected: prints `Built .../data/suttamula.db: <N> translation combinations, versions 0.1, 0.2` and creates `data/suttamula.db`.

- [ ] **Step 4: Sanity-check the DB**

Run:

```bash
node -e "const D=require('better-sqlite3');const db=new D('data/suttamula.db');console.log(db.prepare('SELECT * FROM versions').all());console.log(db.prepare('SELECT sutta_id,version,model FROM translations LIMIT 3').all());console.log(db.prepare(\"SELECT seg_id,pali,english FROM segments WHERE sutta_id='sn12.1' AND version='0.2' ORDER BY seg_order LIMIT 2\").all());"
```

Expected: versions array with one `is_latest:1`; translation rows; segments with both Pāli and English populated.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-db.mjs .gitignore
git commit -m "feat: build-time SQLite DB from translations, pali, prompts"
```

---

### Task 3: Build-time DB query module

**Files:**

- Create: `src/lib/db.ts`

**Interfaces:**

- Consumes: `data/suttamula.db`.
- Produces (all synchronous, build-time):
  - `getNikayas(): Array<{ nikaya: string, count: number }>`
  - `getSuttasByNikaya(nikaya: string): Array<{ id, vagga, title_pali, title_en }>` (ordered by `order_key`)
  - `getCombos(suttaId: string): Array<{ version: string, model: string }>`
  - `getAllCombos(): Array<{ suttaId: string, version: string, model: string }>`
  - `getSegments(suttaId, version, model): Array<{ seg_id, seg_order, pali, english }>`
  - `getVersions(): Array<{ version: string, is_latest: number }>`
  - `getLatestVersion(): string`
  - `resolveVersion(v: string): string` — maps `'latest'` to the latest version, else returns `v`.
  - `getDefaultModel(suttaId: string, version: string): string` — first model alphabetically for that sutta+version.
  - `getPrompt(version: string): string | null`
  - `getPromptVersions(): string[]`
  - `getSutta(suttaId: string): { id, nikaya, vagga, title_pali, title_en } | undefined`

- [ ] **Step 1: Implement the module**

Create `src/lib/db.ts`:

```ts
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(HERE, "..", "..", "data", "suttamula.db");

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

export function getNikayas() {
  return db
    .prepare(
      `SELECT nikaya, COUNT(*) AS count FROM suttas GROUP BY nikaya ORDER BY nikaya`,
    )
    .all() as Array<{ nikaya: string; count: number }>;
}

export function getSuttasByNikaya(nikaya: string) {
  return db
    .prepare(
      `SELECT id, vagga, title_pali, title_en FROM suttas
     WHERE nikaya = ? ORDER BY order_key`,
    )
    .all(nikaya) as Array<{
    id: string;
    vagga: string | null;
    title_pali: string;
    title_en: string;
  }>;
}

export function getCombos(suttaId: string) {
  return db
    .prepare(
      `SELECT version, model FROM translations WHERE sutta_id = ?
     ORDER BY version DESC, model`,
    )
    .all(suttaId) as Array<{ version: string; model: string }>;
}

export function getAllCombos() {
  return db
    .prepare(`SELECT sutta_id AS suttaId, version, model FROM translations`)
    .all() as Array<{ suttaId: string; version: string; model: string }>;
}

export function getSegments(suttaId: string, version: string, model: string) {
  return db
    .prepare(
      `SELECT seg_id, seg_order, pali, english FROM segments
     WHERE sutta_id = ? AND version = ? AND model = ? ORDER BY seg_order`,
    )
    .all(suttaId, version, model) as Array<{
    seg_id: string;
    seg_order: number;
    pali: string | null;
    english: string;
  }>;
}

export function getVersions() {
  return db
    .prepare(`SELECT version, is_latest FROM versions ORDER BY version`)
    .all() as Array<{ version: string; is_latest: number }>;
}

export function getLatestVersion(): string {
  const row = db
    .prepare(`SELECT version FROM versions WHERE is_latest = 1`)
    .get() as { version: string } | undefined;
  if (!row) throw new Error("No latest version in DB");
  return row.version;
}

export function resolveVersion(v: string): string {
  return v === "latest" ? getLatestVersion() : v;
}

export function getDefaultModel(suttaId: string, version: string): string {
  const row = db
    .prepare(
      `SELECT model FROM translations WHERE sutta_id = ? AND version = ? ORDER BY model LIMIT 1`,
    )
    .get(suttaId, version) as { model: string } | undefined;
  if (!row) throw new Error(`No model for ${suttaId} ${version}`);
  return row.model;
}

export function getSutta(suttaId: string) {
  return db
    .prepare(
      `SELECT id, nikaya, vagga, title_pali, title_en FROM suttas WHERE id = ?`,
    )
    .get(suttaId) as
    | {
        id: string;
        nikaya: string;
        vagga: string | null;
        title_pali: string;
        title_en: string;
      }
    | undefined;
}

export function getPrompt(version: string): string | null {
  const row = db
    .prepare(`SELECT body_md FROM prompts WHERE version = ?`)
    .get(version) as { body_md: string } | undefined;
  return row?.body_md ?? null;
}

export function getPromptVersions(): string[] {
  return (
    db.prepare(`SELECT version FROM prompts ORDER BY version`).all() as Array<{
      version: string;
    }>
  ).map((r) => r.version);
}
```

- [ ] **Step 2: Verify it loads and queries**

Run:

```bash
node --input-type=module -e "import('./src/lib/db.ts').catch(()=>{});" 2>/dev/null; \
npx tsx -e "import {getNikayas,getLatestVersion,getAllCombos} from './src/lib/db.ts'; console.log(getNikayas()); console.log('latest', getLatestVersion()); console.log('combos', getAllCombos().length);"
```

Note: if `tsx` is unavailable, this module is exercised by the Astro build in later tasks; skip the standalone check and rely on Task 6's build.
Expected (if run): nikāya counts, a latest version string, and a combo count > 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: build-time DB query module"
```

---

### Task 4: Pāli-term rendering (TDD)

**Files:**

- Create: `src/lib/terms.ts`
- Test: `src/lib/terms.test.mjs`

**Interfaces:**

- Produces:
  - `slugify(term: string): string` — lowercase, trim, spaces→`-`, keep diacritics, strip surrounding punctuation.
  - `renderEnglishWithTerms(text: string, knownSlugs: Set<string>): string` — returns HTML. Replaces `[*X*]` with `[<span class="pali-term" data-term="<slug>">X</span>]` and standalone `*X*` with `<span class="pali-term" ...>X</span>` (or `<em>X</em>` if no slug matches). A term matches if `slugify(X)` is in `knownSlugs`, or `slugify(X without trailing s)` is. Non-matching `*X*` renders as `<em>X</em>`; non-matching `[*X*]` renders as `[<em>X</em>]`. HTML-escapes all literal text.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/terms.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, renderEnglishWithTerms } from "./terms.ts";

test("slugify lowercases, keeps diacritics, hyphenates spaces", () => {
  assert.equal(slugify("Paṭiccasamuppāda"), "paṭiccasamuppāda");
  assert.equal(slugify("yoniso manasikāra"), "yoniso-manasikāra");
});

test("known standalone term becomes interactive span", () => {
  const html = renderEnglishWithTerms(
    "I teach *dhamma* now",
    new Set(["dhamma"]),
  );
  assert.match(
    html,
    /<span class="pali-term" data-term="dhamma">dhamma<\/span>/,
  );
});

test("plural matches singular slug", () => {
  const html = renderEnglishWithTerms(
    "the *bhikkhus* sat",
    new Set(["bhikkhu"]),
  );
  assert.match(html, /data-term="bhikkhu">bhikkhus<\/span>/);
});

test("unknown term renders as plain em", () => {
  const html = renderEnglishWithTerms("a *nibbāna* here", new Set());
  assert.equal(html, "a <em>nibbāna</em> here");
});

test("bracketed term keeps brackets, span inside", () => {
  const html = renderEnglishWithTerms("mind [*citta*]", new Set(["citta"]));
  assert.match(
    html,
    /\[<span class="pali-term" data-term="citta">citta<\/span>\]/,
  );
});

test("escapes html in surrounding text", () => {
  const html = renderEnglishWithTerms("a < b *dhamma*", new Set(["dhamma"]));
  assert.match(html, /a &lt; b /);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/lib/terms.test.mjs`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Implement `terms.ts`**

Create `src/lib/terms.ts`:

```ts
export function slugify(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .replace(/\s+/g, "-");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function matchSlug(inner: string, known: Set<string>): string | null {
  const slug = slugify(inner);
  if (known.has(slug)) return slug;
  const singular = slug.replace(/s$/, "");
  if (singular !== slug && known.has(singular)) return singular;
  return null;
}

function termSpan(inner: string, known: Set<string>): string {
  const slug = matchSlug(inner, known);
  const safe = escapeHtml(inner);
  return slug
    ? `<span class="pali-term" data-term="${escapeHtml(slug)}">${safe}</span>`
    : `<em>${safe}</em>`;
}

// Matches [*inner*] (group 1) or *inner* (group 2). Inner has no '*'.
const TOKEN = /\[\*([^*]+)\*\]|\*([^*]+)\*/g;

export function renderEnglishWithTerms(
  text: string,
  knownSlugs: Set<string>,
): string {
  let out = "";
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/lib/terms.test.mjs`
Expected: PASS (6 tests). Note: Node 22.12 runs `.ts` imports from `.mjs` tests via type-stripping; if the import fails in this environment, rename the test to `terms.test.ts` and run `npx tsx --test src/lib/terms.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/terms.ts src/lib/terms.test.mjs
git commit -m "feat: pali-term HTML rendering with definition gating"
```

---

### Task 5: Definitions content collection + starter file

**Files:**

- Create: `src/content.config.ts`
- Create: `src/content/definitions/dhamma.md`

**Interfaces:**

- Produces: a `definitions` collection with `tooltip?: string` frontmatter; body is markdown. Consumed via `getCollection('definitions')` → each entry's `id` is the slug, `data.tooltip`, and rendered body.

- [ ] **Step 1: Define the collection**

Create `src/content.config.ts`:

```ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const definitions = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/definitions" }),
  schema: z.object({
    tooltip: z.string().optional(),
  }),
});

export const collections = { definitions };
```

- [ ] **Step 2: Create a starter definition**

Create `src/content/definitions/dhamma.md`:

```markdown
---
tooltip: "Left untranslated — the Buddha's teaching, and the nature of things; 'truth' and 'phenomenon' at once."
---

We leave **dhamma** untranslated. No single English word carries its full range:
the teaching of the Buddha, the truth it points to, and the phenomena that truth concerns.

Translating it as "the teaching" or "the law" closes off meanings the Pāli keeps open.
Keeping the word in Pāli invites the reader back to the source each time it appears.
```

- [ ] **Step 3: Verify the collection type-checks**

Run: `cd /home/adicco/Code/suttamula/ui && npx astro sync`
Expected: completes without error; `.astro/` types regenerated.

- [ ] **Step 4: Commit**

```bash
git add src/content.config.ts src/content/definitions/dhamma.md
git commit -m "feat: definitions content collection + dhamma starter"
```

---

### Task 6: Base layout, design tokens, fonts, HTMX

**Files:**

- Create: `public/fonts/` (vendored woff2 — Coelacanth + Geist)
- Create: `public/htmx.min.js`
- Create: `src/styles/global.css`
- Create: `src/components/Dhammacakka.astro`
- Create: `src/layouts/Base.astro`
- Modify: `astro.config.mjs`

**Interfaces:**

- Produces: `Base.astro` accepting props `{ title: string }` and a default slot; loads fonts, tokens, HTMX. `Dhammacakka.astro` accepting `{ size?: number, class?: string }` rendering an inline SVG wheel in `currentColor`.

- [ ] **Step 1: Vendor the fonts**

Download Coelacanth (woff2) from https://gitlab.com/Fuzzypeg/coelacanth and Geist (woff2) from the Geist font release. Place at:

- `public/fonts/Coelacanth.woff2` (regular), `public/fonts/Coelacanth-Italic.woff2`
- `public/fonts/Geist.woff2` (variable or regular weight)

Run to confirm:

```bash
ls -la public/fonts/
```

Expected: the woff2 files present. If Coelacanth ships only OTF/TTF, convert to woff2 with `npx fontmin` or `woff2_compress`; document the source filename used.

- [ ] **Step 2: Vendor HTMX**

Run:

```bash
curl -L -o public/htmx.min.js https://unpkg.com/htmx.org@2/dist/htmx.min.js
ls -la public/htmx.min.js
```

Expected: a non-empty JS file.

- [ ] **Step 3: Write the global stylesheet**

Create `src/styles/global.css`:

```css
@font-face {
  font-family: "Coelacanth";
  src: url("/fonts/Coelacanth.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Coelacanth";
  src: url("/fonts/Coelacanth-Italic.woff2") format("woff2");
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}
@font-face {
  font-family: "Geist";
  src: url("/fonts/Geist.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}

:root {
  --oxblood: #752803;
  --parchment: #fbf8f2;
  --sand: #efe7d9;
  --ink: #2a2018;
  --muted: #8a7e6e;
  --serif: "Coelacanth", Georgia, serif;
  --sans: "Geist", system-ui, sans-serif;
  --measure: 34rem;
}

* {
  box-sizing: border-box;
}
html {
  -webkit-text-size-adjust: 100%;
}
body {
  margin: 0;
  background: var(--parchment);
  color: var(--ink);
  font-family: var(--serif);
  font-size: 1.125rem;
  line-height: 1.6;
}

a {
  color: var(--oxblood);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

.site-header {
  font-family: var(--sans);
  border-bottom: 1px solid var(--sand);
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.site-header a {
  text-decoration: none;
  color: var(--ink);
}
.site-header .wordmark {
  font-family: var(--serif);
  font-size: 1.4rem;
  letter-spacing: 0.01em;
}

.eyebrow {
  font-family: var(--serif);
  font-variant: small-caps;
  letter-spacing: 0.12em;
  color: var(--oxblood);
  font-size: 0.95rem;
}

main {
  max-width: 64rem;
  margin: 0 auto;
  padding: 2rem 1.5rem 6rem;
}

/* UI chrome uses sans */
.tabs,
.meta,
.seg-no,
nav.browse,
.toolbar {
  font-family: var(--sans);
}

/* Pāli terms */
.pali-term {
  font-style: italic;
  cursor: pointer;
  border-bottom: 1px dotted var(--oxblood);
}
.pali-term:hover,
.pali-term:focus {
  color: var(--oxblood);
}

:focus-visible {
  outline: 2px solid var(--oxblood);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
  }
}
```

- [ ] **Step 4: Create the wheel motif**

Create `src/components/Dhammacakka.astro`:

```astro
---
interface Props { size?: number; class?: string; }
const { size = 24, class: cls = '' } = Astro.props;
---
<svg class={cls} width={size} height={size} viewBox="0 0 100 100"
     fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
  <circle cx="50" cy="50" r="46" />
  <circle cx="50" cy="50" r="10" />
  {Array.from({ length: 8 }).map((_, i) => {
    const a = (i * Math.PI) / 4;
    return <line x1={50 + 10 * Math.cos(a)} y1={50 + 10 * Math.sin(a)}
                 x2={50 + 46 * Math.cos(a)} y2={50 + 46 * Math.sin(a)} />;
  })}
</svg>
```

- [ ] **Step 5: Create the base layout**

Create `src/layouts/Base.astro`:

```astro
---
import '../styles/global.css';
import Dhammacakka from '../components/Dhammacakka.astro';
interface Props { title: string; }
const { title } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title} · Suttamūla</title>
    <script src="/htmx.min.js" defer></script>
  </head>
  <body>
    <header class="site-header">
      <a href="/" style="display:flex;align-items:center;gap:.6rem;color:var(--oxblood)">
        <Dhammacakka size={28} />
        <span class="wordmark" style="color:var(--ink)">Suttamūla</span>
      </a>
      <nav class="meta" style="margin-left:auto;display:flex;gap:1.25rem">
        <a href="/terms">Terms</a>
        <a href="/prompts">Prompts</a>
      </nav>
    </header>
    <main><slot /></main>
  </body>
</html>
```

- [ ] **Step 6: Confirm static output config**

Edit `astro.config.mjs`:

```js
// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  // Static output (default). Root-domain deploy, no base path.
  vite: {
    // better-sqlite3 is build-time only; keep it external from client bundles.
    ssr: { external: ["better-sqlite3"] },
  },
});
```

- [ ] **Step 7: Verify the build starts (no pages yet is fine)**

Run: `cd /home/adicco/Code/suttamula/ui && npx astro sync && npx astro check 2>&1 | tail -5 || true`
Expected: no fatal config/type errors from the new files.

- [ ] **Step 8: Commit**

```bash
git add public/fonts public/htmx.min.js src/styles/global.css src/components/Dhammacakka.astro src/layouts/Base.astro astro.config.mjs
git commit -m "feat: base layout, design tokens, fonts, htmx, wheel motif"
```

---

### Task 7: Term dialog component

**Files:**

- Create: `src/components/TermDialog.astro`

**Interfaces:**

- Consumes: `getCollection('definitions')`, `renderEnglishWithTerms` slugs (the dialog reads `data-term`).
- Produces: a single `<dialog id="term-dialog">` plus inline JSON of all definitions (slug→{tooltip, html}) and a client script that, on click of any `.pali-term`, opens the dialog populated with that term's rendered markdown; on hover sets `title`. Used once per sutta page.

- [ ] **Step 1: Implement the component**

Create `src/components/TermDialog.astro`:

```astro
---
import { getCollection, render } from 'astro:content';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

const defs = await getCollection('definitions');
const container = await AstroContainer.create();
const data: Record<string, { tooltip: string; html: string }> = {};
for (const entry of defs) {
  const { Content } = await render(entry);
  const html = await container.renderToString(Content);
  data[entry.id] = { tooltip: entry.data.tooltip ?? '', html };
}
---
<dialog id="term-dialog" class="term-dialog">
  <form method="dialog" class="term-dialog__close-row">
    <button class="term-dialog__close" aria-label="Close">×</button>
  </form>
  <h2 id="term-dialog-title" class="term-dialog__title"></h2>
  <div id="term-dialog-body" class="term-dialog__body"></div>
</dialog>

<script type="application/json" id="term-defs" set:html={JSON.stringify(data)} />

<style>
  .term-dialog {
    max-width: 38rem; border: 1px solid var(--sand); border-top: 4px solid var(--oxblood);
    border-radius: 2px; padding: 1.5rem 1.75rem; color: var(--ink); background: var(--parchment);
  }
  .term-dialog::backdrop { background: rgba(42,32,24,.35); }
  .term-dialog__close-row { display: flex; justify-content: flex-end; margin: 0; }
  .term-dialog__close { font-size: 1.5rem; line-height: 1; border: 0; background: none; cursor: pointer; color: var(--muted); }
  .term-dialog__title { font-family: var(--serif); font-style: italic; color: var(--oxblood); margin: 0 0 .5rem; }
  .term-dialog__body :first-child { margin-top: 0; }
</style>

<script>
  const dialog = document.getElementById('term-dialog') as HTMLDialogElement;
  const titleEl = document.getElementById('term-dialog-title')!;
  const bodyEl = document.getElementById('term-dialog-body')!;
  const defs = JSON.parse(document.getElementById('term-defs')!.textContent || '{}');

  function wire(root: ParentNode) {
    root.querySelectorAll<HTMLElement>('.pali-term').forEach((el) => {
      const slug = el.dataset.term!;
      const def = defs[slug];
      if (!def) return;
      if (def.tooltip && !el.title) el.title = def.tooltip;
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      const open = () => { titleEl.textContent = slug; bodyEl.innerHTML = def.html; dialog.showModal(); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }
  wire(document);
  // Re-wire English panes swapped in by HTMX.
  document.body.addEventListener('htmx:afterSwap', (e) => wire((e as any).target));
</script>
```

- [ ] **Step 2: Verify it builds (exercised in Task 8)**

Run: `npx astro check 2>&1 | tail -5 || true`
Expected: no fatal errors referencing `TermDialog.astro`.

- [ ] **Step 3: Commit**

```bash
git add src/components/TermDialog.astro
git commit -m "feat: shared pali-term dialog with htmx re-wiring"
```

---

### Task 8: Sutta view component + page (HTMX switching + layout toggle)

**Files:**

- Create: `src/components/SuttaView.astro`
- Create: `src/pages/sutta/[id]/[version]/[model].astro`

**Interfaces:**

- Consumes: `db.ts` queries, `renderEnglishWithTerms`, `getCollection('definitions')`, `TermDialog`, `Base`.
- Produces: a page at `/sutta/[id]/[version]/[model]` for every real combo plus `latest` aliases. The English column markup is wrapped in `<div class="english-pane">…</div>` so HTMX `hx-select=".english-pane"` works.

- [ ] **Step 1: Build the SuttaView component**

Create `src/components/SuttaView.astro`:

```astro
---
import { getCollection } from 'astro:content';
import { renderEnglishWithTerms } from '../lib/terms';
import { getSegments, getCombos } from '../lib/db';

interface Props { suttaId: string; version: string; model: string; urlVersion: string; }
const { suttaId, version, model, urlVersion } = Astro.props;

const defs = await getCollection('definitions');
const slugs = new Set(defs.map((d) => d.id));

const segments = getSegments(suttaId, version, model).map((s) => ({
  ...s,
  englishHtml: renderEnglishWithTerms(s.english, slugs),
}));

const combos = getCombos(suttaId);
const versions = [...new Set(combos.map((c) => c.version))];
const models = [...new Set(combos.filter((c) => c.version === version).map((c) => c.model))];

const enc = (m: string) => encodeURIComponent(m);
const href = (v: string, m: string) => `/sutta/${suttaId}/${v}/${enc(m)}`;
---
<div class="toolbar">
  <div class="tabs">
    <span class="tabs__label">Prompt</span>
    {versions.map((v) => (
      <a class:list={["tab", { 'tab--active': v === version }]}
         href={href(v, model)}
         hx-get={href(v, model)} hx-select=".english-pane" hx-target=".english-pane"
         hx-swap="outerHTML" hx-push-url="true">{v}</a>
    ))}
    <a class="tab tab--prompt" href={`/prompts/${version}`}>view prompt ↗</a>
  </div>
  <div class="tabs">
    <span class="tabs__label">Model</span>
    {models.map((m) => (
      <a class:list={["tab", { 'tab--active': m === model }]}
         href={href(urlVersion, m)}
         hx-get={href(urlVersion, m)} hx-select=".english-pane" hx-target=".english-pane"
         hx-swap="outerHTML" hx-push-url="true">{m}</a>
    ))}
  </div>
  <button class="layout-toggle" type="button" aria-pressed="false">Line-by-line</button>
</div>

<div class="sutta" data-layout="columns">
  <div class="pane pali-pane">
    <div class="pane__head eyebrow">Pāli</div>
    {segments.map((s) => (
      <p class="seg"><span class="seg-no">{s.seg_id.split(':')[1]}</span>
        <span class="seg-text">{s.pali}</span></p>
    ))}
  </div>
  <div class="english-pane">
    <div class="pane__head eyebrow">English · {version} · {model}</div>
    {segments.map((s) => (
      <p class="seg"><span class="seg-no">{s.seg_id.split(':')[1]}</span>
        <span class="seg-text" set:html={s.englishHtml} /></p>
    ))}
  </div>
</div>

<style>
  .toolbar { display: flex; flex-wrap: wrap; gap: 1rem 2rem; align-items: center;
    padding-bottom: 1rem; border-bottom: 1px solid var(--sand); margin-bottom: 1.5rem; font-size: .9rem; }
  .tabs { display: flex; align-items: baseline; gap: .75rem; }
  .tabs__label { color: var(--muted); text-transform: uppercase; letter-spacing: .1em; font-size: .72rem; }
  .tab { text-decoration: none; color: var(--muted); padding-bottom: 2px; border-bottom: 2px solid transparent; }
  .tab--active { color: var(--oxblood); border-bottom-color: var(--oxblood); }
  .tab--prompt { color: var(--muted); font-style: italic; }
  .layout-toggle { margin-left: auto; font-family: var(--sans); background: none; border: 1px solid var(--sand);
    border-radius: 2px; padding: .35rem .7rem; cursor: pointer; color: var(--ink); }

  .sutta { display: grid; gap: 2.5rem; }
  .sutta[data-layout="columns"] { grid-template-columns: 1fr 1fr; }
  .sutta[data-layout="columns"] .pali-pane { border-right: 1px solid var(--sand); padding-right: 2.5rem; }
  .pane__head { margin-bottom: 1rem; }
  .seg { display: flex; gap: .9rem; margin: 0 0 .85rem; }
  .seg-no { font-family: var(--sans); font-size: .7rem; color: var(--muted); padding-top: .35rem;
    min-width: 2.2rem; text-align: right; user-select: none; }
  .seg-text { flex: 1; }

  /* line-by-line: one column; pair pali above english per segment */
  .sutta[data-layout="lines"] { grid-template-columns: 1fr; gap: 0; }
  .sutta[data-layout="lines"] .pane__head { display: none; }
  .sutta[data-layout="lines"] { display: block; }
  .sutta[data-layout="lines"] .pali-pane,
  .sutta[data-layout="lines"] .english-pane { display: contents; }
  .sutta[data-layout="lines"] .pali-pane .seg .seg-text { font-size: 1.05em; }
  .sutta[data-layout="lines"] .english-pane .seg { margin-bottom: 1.6rem; color: var(--ink); }
  .sutta[data-layout="lines"] .pali-pane .seg { margin-bottom: .15rem; }

  @media (max-width: 720px) {
    .sutta[data-layout="columns"] { grid-template-columns: 1fr; }
    .sutta[data-layout="columns"] .pali-pane { border-right: 0; padding-right: 0; }
  }
</style>

<script>
  const KEY = 'suttamula-layout';
  const sutta = document.querySelector<HTMLElement>('.sutta')!;
  const btn = document.querySelector<HTMLButtonElement>('.layout-toggle')!;
  const apply = (mode: string) => {
    sutta.dataset.layout = mode;
    btn.setAttribute('aria-pressed', String(mode === 'lines'));
    btn.textContent = mode === 'lines' ? 'Columns' : 'Line-by-line';
  };
  apply(localStorage.getItem(KEY) || 'columns');
  btn.addEventListener('click', () => {
    const next = sutta.dataset.layout === 'lines' ? 'columns' : 'lines';
    localStorage.setItem(KEY, next); apply(next);
  });
</script>
```

Note on line-by-line interleaving: because columns are separate DOM panes, true per-segment interleave needs the panes laid out as `display: contents` with segments ordered by source. The CSS above stacks Pāli then English per pane; if visual interleave per segment is required, Task 8b refines it. For v1 the `lines` mode renders Pāli block then English block stacked — acceptable. **If true interleave is required, see Step 1b.**

- [ ] **Step 1b (optional refinement): true per-segment interleave**

If stacked blocks are not acceptable, change `SuttaView` `lines` rendering to emit a single interleaved list. Replace the two panes' loop with a shared loop guarded by layout — simplest correct approach: render a third hidden block used only in `lines` mode:

```astro
<div class="interleaved">
  {segments.map((s) => (
    <div class="seg-pair">
      <p class="seg seg--pali"><span class="seg-no">{s.seg_id.split(':')[1]}</span><span class="seg-text">{s.pali}</span></p>
      <p class="seg seg--en"><span class="seg-no" aria-hidden="true"></span><span class="seg-text" set:html={s.englishHtml} /></p>
    </div>
  ))}
</div>
```

and toggle `.sutta` vs `.interleaved` visibility by layout in CSS/JS. Decide during implementation; default is the simpler stacked mode. (This duplicates English markup, so keep the canonical `.english-pane` as the HTMX swap target and rebuild `.interleaved` client-side from it, OR accept that HTMX swaps only update columns mode and a full nav updates both. For v1, **prefer the simpler stacked `lines` mode and skip 1b.**)

- [ ] **Step 2: Build the dynamic page**

Create `src/pages/sutta/[id]/[version]/[model].astro`:

```astro
---
import Base from '../../../../layouts/Base.astro';
import SuttaView from '../../../../components/SuttaView.astro';
import TermDialog from '../../../../components/TermDialog.astro';
import { getAllCombos, getLatestVersion, getSutta, resolveVersion } from '../../../../lib/db';

export function getStaticPaths() {
  const combos = getAllCombos();
  const latest = getLatestVersion();
  const paths = [];
  for (const c of combos) {
    paths.push({ params: { id: c.suttaId, version: c.version, model: c.model } });
    if (c.version === latest) {
      paths.push({ params: { id: c.suttaId, version: 'latest', model: c.model } });
    }
  }
  return paths;
}

const { id, version: urlVersion, model } = Astro.params;
const realVersion = resolveVersion(urlVersion!);
const sutta = getSutta(id!);
const title = sutta?.title_en?.trim() || sutta?.title_pali?.trim() || id!;
---
<Base title={title}>
  <p class="eyebrow">{sutta?.nikaya?.toUpperCase()} · {id}</p>
  <h1 style="font-weight:400;margin:.2rem 0 1.5rem">{title}</h1>
  <SuttaView suttaId={id!} version={realVersion} model={model!} urlVersion={urlVersion!} />
  <TermDialog />
</Base>
```

- [ ] **Step 3: Build the site and verify pages generate**

Run:

```bash
cd /home/adicco/Code/suttamula/ui && npm run build:db && npx astro build 2>&1 | tail -15
ls dist/sutta/sn12.1/latest/ 2>/dev/null
```

Expected: build succeeds; `dist/sutta/sn12.1/latest/<model>/index.html` exists (model dir is URL-encoded, e.g. `gpt-5.5%3Amedium`).

- [ ] **Step 4: Spot-check rendered HTML**

Run:

```bash
grep -o 'class="pali-term"[^>]*>[^<]*' dist/sutta/sn12.1/0.2/*/index.html | head
grep -c 'english-pane' dist/sutta/sn12.1/0.2/*/index.html
```

Expected: at least one `pali-term` span (e.g. `dhamma`); exactly one `english-pane` container.

- [ ] **Step 5: Visual verification with Playwright**

Start preview in background, then drive the browser:

```bash
npx astro preview --port 4321 &
```

Use the Playwright MCP tools: navigate to `http://localhost:4321/sutta/sn12.1/latest/gpt-5.5%3Amedium`, take a screenshot. Verify: two columns (Pāli left, English right), oxblood active tabs, segment numbers, a dotted-underline `dhamma` term. Click a model/prompt tab → English pane swaps, URL updates. Click `dhamma` → dialog opens. Toggle line-by-line → layout changes and persists on reload.

- [ ] **Step 6: Commit**

```bash
git add src/components/SuttaView.astro src/pages/sutta
git commit -m "feat: sutta view with htmx version/model switching and layout toggle"
```

---

### Task 9: Homepage + nikāya browse

**Files:**

- Create: `src/pages/index.astro`
- Create: `src/pages/[nikaya].astro`

**Interfaces:**

- Consumes: `getNikayas`, `getSuttasByNikaya`, `getCombos`, `getDefaultModel`, `getLatestVersion`, `resolveVersion`.
- Produces: `/` and `/[nikaya]`. Sutta links point to `/sutta/<id>/latest/<defaultModel>` where `defaultModel` is `getDefaultModel(id, latest)`.

- [ ] **Step 1: Homepage**

Create `src/pages/index.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import { getNikayas } from '../lib/db';
const NAMES: Record<string, string> = {
  sn: 'The Connected Discourses', mn: 'The Middle Length Discourses',
  an: 'The Numerical Discourses', ud: 'Inspired Utterances', dn: 'The Long Discourses',
};
const nikayas = getNikayas();
---
<Base title="Pāli Canon Translations">
  <h1 style="font-weight:400;font-size:2.4rem;margin:.3rem 0 1rem">Suttamūla</h1>
  <p style="max-width:var(--measure);color:var(--ink)">
    Fresh translations of the Buddhist Pāli Canon, returning to the root meaning of the
    early texts. Many core terms are left in Pāli; every choice is open to inspection.
  </p>
  <nav class="browse" style="margin-top:2.5rem;display:grid;gap:1px;background:var(--sand);border:1px solid var(--sand)">
    {nikayas.map((n) => (
      <a href={`/${n.nikaya}`} style="background:var(--parchment);padding:1.1rem 1.25rem;text-decoration:none;display:flex;justify-content:space-between;align-items:baseline">
        <span><strong style="color:var(--ink)">{NAMES[n.nikaya] ?? n.nikaya.toUpperCase()}</strong>
          <span style="color:var(--muted);font-family:var(--sans);font-size:.8rem"> · {n.nikaya.toUpperCase()}</span></span>
        <span style="color:var(--muted);font-family:var(--sans);font-size:.8rem">{n.count} suttas</span>
      </a>
    ))}
  </nav>
</Base>
```

- [ ] **Step 2: Nikāya browse page**

Create `src/pages/[nikaya].astro`:

```astro
---
import Base from '../layouts/Base.astro';
import { getNikayas, getSuttasByNikaya, getDefaultModel, getLatestVersion } from '../lib/db';

export function getStaticPaths() {
  return getNikayas().map((n) => ({ params: { nikaya: n.nikaya } }));
}
const { nikaya } = Astro.params;
const latest = getLatestVersion();
const suttas = getSuttasByNikaya(nikaya!);

// group by vagga preserving order
const groups: Array<{ vagga: string | null; items: typeof suttas }> = [];
for (const s of suttas) {
  const last = groups.at(-1);
  if (last && last.vagga === s.vagga) last.items.push(s);
  else groups.push({ vagga: s.vagga, items: [s] });
}
const linkFor = (id: string) => `/sutta/${id}/latest/${encodeURIComponent(getDefaultModel(id, latest))}`;
---
<Base title={nikaya!.toUpperCase()}>
  <p class="eyebrow">{nikaya!.toUpperCase()}</p>
  <h1 style="font-weight:400;margin:.2rem 0 1.5rem">Suttas</h1>
  {groups.map((g) => (
    <section style="margin-bottom:2rem">
      {g.vagga && <h2 class="eyebrow" style="font-size:1rem">{g.vagga}</h2>}
      <ul style="list-style:none;padding:0;margin:.5rem 0;display:grid;gap:.35rem">
        {g.items.map((s) => (
          <li>
            <a href={linkFor(s.id)} style="text-decoration:none">
              <span style="font-family:var(--sans);font-size:.78rem;color:var(--muted)">{s.id}</span>
              <span style="margin-left:.6rem;color:var(--ink)">{(s.title_en || s.title_pali || '').trim()}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  ))}
</Base>
```

- [ ] **Step 3: Build and verify**

Run:

```bash
npx astro build 2>&1 | tail -5
ls dist/index.html dist/sn/index.html
```

Expected: both files exist; `dist/sn/index.html` lists suttas grouped by vagga with links into `/sutta/.../latest/...`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro src/pages/[nikaya].astro
git commit -m "feat: homepage and nikaya browse"
```

---

### Task 10: Prompt transparency pages

**Files:**

- Create: `src/pages/prompts/index.astro`
- Create: `src/pages/prompts/[version].astro`

**Interfaces:**

- Consumes: `getPromptVersions`, `getPrompt`, `getVersions`. Renders prompt markdown to HTML (use `marked`).

- [ ] **Step 1: Add the markdown renderer**

Run: `npm install marked`

- [ ] **Step 2: Prompts index**

Create `src/pages/prompts/index.astro`:

```astro
---
import Base from '../../layouts/Base.astro';
import { getPromptVersions, getVersions } from '../../lib/db';
const promptVersions = getPromptVersions();
const latest = getVersions().find((v) => v.is_latest)?.version;
---
<Base title="Translation Prompts">
  <p class="eyebrow">Transparency</p>
  <h1 style="font-weight:400;margin:.2rem 0 1rem">Translation Prompts</h1>
  <p style="max-width:var(--measure)">Every translation is produced by a published prompt.
    Each version is reproduced in full below.</p>
  <ul style="list-style:none;padding:0;margin:1.5rem 0;display:grid;gap:.4rem">
    {promptVersions.map((v) => (
      <li><a href={`/prompts/${v}`}>Prompt {v}{v === latest ? ' · latest' : ''}</a></li>
    ))}
  </ul>
</Base>
```

- [ ] **Step 3: Single prompt page**

Create `src/pages/prompts/[version].astro`:

```astro
---
import Base from '../../layouts/Base.astro';
import { getPromptVersions, getPrompt } from '../../lib/db';
import { marked } from 'marked';

export function getStaticPaths() {
  return getPromptVersions().map((v) => ({ params: { version: v } }));
}
const { version } = Astro.params;
const md = getPrompt(version!) ?? '';
const html = marked.parse(md);
---
<Base title={`Prompt ${version}`}>
  <p class="eyebrow">Prompt · {version}</p>
  <article class="prompt-body" set:html={html} />
</Base>
<style>
  .prompt-body { max-width: var(--measure); }
  .prompt-body :global(pre) { background: var(--sand); padding: 1rem; overflow-x: auto; border-radius: 2px;
    font-size: .85rem; }
  .prompt-body :global(code) { font-family: var(--sans); }
  .prompt-body :global(h2), .prompt-body :global(h3) { font-variant: small-caps; color: var(--oxblood); font-weight: 400; }
</style>
```

- [ ] **Step 4: Build and verify**

Run:

```bash
npx astro build 2>&1 | tail -5
ls dist/prompts/index.html dist/prompts/0.2/index.html
grep -c 'Pali to leave untranslated' dist/prompts/0.2/index.html
```

Expected: files exist; the prompt content is rendered (grep count ≥ 1).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/pages/prompts
git commit -m "feat: prompt transparency pages"
```

---

### Task 11: Terms index page

**Files:**

- Create: `src/pages/terms.astro`

**Interfaces:**

- Consumes: `getCollection('definitions')`, `render`, `TermDialog`.
- Produces: `/terms` listing every definition; each term opens the same shared dialog on click.

- [ ] **Step 1: Build the page**

Create `src/pages/terms.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import TermDialog from '../components/TermDialog.astro';
import { getCollection } from 'astro:content';
const defs = (await getCollection('definitions')).sort((a, b) => a.id.localeCompare(b.id));
---
<Base title="Pāli Terms">
  <p class="eyebrow">Editorial choices</p>
  <h1 style="font-weight:400;margin:.2rem 0 1rem">Pāli Terms</h1>
  <p style="max-width:var(--measure)">Why each term is left untranslated, or how it is rendered.
    Click a term for the full note.</p>
  <ul style="list-style:none;padding:0;margin:1.5rem 0;display:grid;gap:.8rem">
    {defs.map((d) => (
      <li>
        <span class="pali-term" data-term={d.id} style="font-size:1.15rem">{d.id}</span>
        {d.data.tooltip && <span style="color:var(--muted);margin-left:.6rem">{d.data.tooltip}</span>}
      </li>
    ))}
  </ul>
  <TermDialog />
</Base>
```

- [ ] **Step 2: Build and verify**

Run:

```bash
npx astro build 2>&1 | tail -5
grep -o 'data-term="[^"]*"' dist/terms/index.html | head
```

Expected: page builds; lists `dhamma` (and any other definitions).

- [ ] **Step 3: Visual check (Playwright)**

With `npx astro preview` running, navigate to `/terms`, click `dhamma`, confirm the dialog opens with the rendered note.

- [ ] **Step 4: Commit**

```bash
git add src/pages/terms.astro
git commit -m "feat: pali terms index page"
```

---

### Task 12: Full build, README, final verification

**Files:**

- Modify: `README.md`

**Interfaces:** none new.

- [ ] **Step 1: Clean full build from scratch**

Run:

```bash
cd /home/adicco/Code/suttamula/ui && rm -rf dist data && npm run build 2>&1 | tail -20
```

Expected: `build:db` runs, then `astro build` prerenders all pages with zero errors.

- [ ] **Step 2: Run the unit test suite**

Run: `npm test`
Expected: all tests in `scripts/lib/extract.test.mjs` and `src/lib/terms.test.mjs` pass.

- [ ] **Step 3: Update the app README**

Replace `README.md` with project-run instructions:

````markdown
# Suttamūla UI

Static Astro site serving Suttamūla's Pāli↔English translations.

## Build

```bash
npm install
npm run build        # builds the SQLite DB from ../translation + ../bilara-data + ../prompts, then astro build
```
````

Output is in `dist/` — a fully static site (no runtime database; SQLite is build-time only).

## Develop

```bash
npm run build:db     # regenerate data/suttamula.db after data changes
astro dev --background
```

## Test

```bash
npm test
```

## Adding term definitions

Add `src/content/definitions/<term>.md` with optional `tooltip:` frontmatter.
Only terms with a definition file become interactive in the text.

````

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: ui build/run instructions"
````

---

## Self-Review

**Spec coverage:**

- §1 data pipeline + prompts table → Tasks 1, 2. ✓
- §2 routing (`/`, `/[nikaya]`, `/sutta/[id]/[version]/[model]`, `latest` alias, `/prompts`, `/terms`) → Tasks 8, 9, 10, 11. ✓
- §3 two-pane + HTMX swap + view-prompt + layout toggle → Task 8. ✓
- §4 term tooltip/dialog, def-gated, `/terms` → Tasks 4, 5, 7, 11. ✓
- §5 palette, Coelacanth/Geist, dhammacakka signature, accessibility floor → Task 6 (+ used throughout). ✓
- §6 static, root domain, Node → Task 6 config, Task 12 build. ✓

**Placeholder scan:** Task 8 flags an optional refinement (1b) but the v1 path (stacked `lines` mode) is fully specified and chosen as default — not a placeholder. Font vendoring (Task 6 Step 1) requires downloading binaries; the path and fallback (otf→woff2 conversion) are specified.

**Type consistency:** `getDefaultModel(suttaId, version)`, `resolveVersion`, `renderEnglishWithTerms(text, Set)`, `.english-pane` HTMX target, and `data-term`/`#term-defs` contract are consistent across Tasks 3, 4, 7, 8, 9.

**Known environment risk:** Node `.ts` import from `.mjs` test (Task 4 Step 4) and standalone `db.ts` check (Task 3 Step 2) depend on type-stripping / `tsx`; fallbacks are noted inline, and the Astro build is the authoritative check.
