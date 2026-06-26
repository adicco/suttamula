import Database from 'better-sqlite3';
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	parseTranslationPath,
	latestVersion,
	zipSegments,
	suttaSortKey,
} from './lib/extract.mjs';
import { tokenizePali } from '../src/lib/pali.mjs';
import { dedupeSenses, stripLemmaNumber } from './lib/dpd.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = join(HERE, '..');
const TRANSLATION_ROOT = join(UI_ROOT, '..', 'translation');
// bilara-data is a sibling of the suttamula repo, i.e. two levels up from ui/.
const PALI_ROOT = join(UI_ROOT, '..', '..', 'bilara-data', 'root', 'pli', 'ms', 'sutta');
const PROMPTS_ROOT = join(UI_ROOT, '..', 'prompts');
const DB_DIR = join(UI_ROOT, 'data');
const DB_PATH = join(DB_DIR, 'suttamula.db');
const DPD_PATH = join(DB_DIR, 'dpd.db');
const DEFINITIONS_DIR = join(UI_ROOT, 'src', 'content', 'definitions');

function walkJson(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walkJson(full));
		else if (entry.endsWith('.json')) out.push(full);
	}
	return out;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

// Index every Pāli root file by its sutta id (from the filename), so we can join
// regardless of how each nikāya is nested (e.g. kn/ud/vagga1, an/an1, sn/sn12).
function buildPaliIndex(root) {
	const index = new Map();
	if (!existsSync(root)) return index;
	for (const file of walkJson(root)) {
		const base = file.split('/').pop();
		const m = base.match(/^(.+)_root-pli-ms\.json$/);
		if (m) index.set(m[1], file);
	}
	return index;
}

// The sutta title is the last header segment (section 0) before the text begins.
// Its position varies: MN has no vagga line so the title is :0.2, while SN/AN
// carry a vagga line and the title is :0.3. Walk in source order, keep the last
// :0.x value, and stop at the first non-header segment.
function titleFromMap(map) {
	let title = null;
	for (const [key, value] of Object.entries(map)) {
		const seg = key.split(':').pop();
		if (/^0\.\d+$/.test(seg)) title = value;
		else if (/^\d+\.\d+$/.test(seg)) break;
	}
	return title != null ? String(title).trim() : null;
}

mkdirSync(DB_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  DROP TABLE IF EXISTS dpd;
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
  CREATE TABLE dpd (form TEXT PRIMARY KEY, senses TEXT NOT NULL, term TEXT);
`);

const insSutta = db.prepare(
	`INSERT OR REPLACE INTO suttas (id, nikaya, vagga, title_pali, title_en, order_key)
   VALUES (@id, @nikaya, @vagga, @title_pali, @title_en, @order_key)`
);
const insTrans = db.prepare(
	`INSERT OR REPLACE INTO translations (sutta_id, version, model) VALUES (?, ?, ?)`
);
const insSeg = db.prepare(
	`INSERT INTO segments (sutta_id, version, model, seg_id, seg_order, pali, english)
   VALUES (@sutta_id, @version, @model, @seg_id, @seg_order, @pali, @english)`
);
const insVer = db.prepare(`INSERT OR REPLACE INTO versions (version, is_latest) VALUES (?, ?)`);
const insPrompt = db.prepare(`INSERT OR REPLACE INTO prompts (version, body_md) VALUES (?, ?)`);

const versionsSeen = new Set();
const suttasSeen = new Map();
const formsSeen = new Set();
const paliIndex = buildPaliIndex(PALI_ROOT);

if (existsSync(TRANSLATION_ROOT)) {
	for (const file of walkJson(TRANSLATION_ROOT)) {
		const rel = relative(TRANSLATION_ROOT, file).split('\\').join('/');
		const meta = parseTranslationPath(rel);
		versionsSeen.add(meta.version);

		const enMap = readJson(file);
		const paliPath = paliIndex.get(meta.suttaId);
		const paliMap = paliPath ? readJson(paliPath) : {};
		// Raw segment ids from the source maps are already consistent between
		// Pāli and English; keep them verbatim so the join in zipSegments holds.
		const segs = zipSegments(paliMap, enMap);

		for (const s of segs) {
			if (s.pali) for (const form of tokenizePali(s.pali)) formsSeen.add(form);
		}

		const key = meta.suttaId;
		if (!suttasSeen.has(key)) {
			suttasSeen.set(key, {
				id: meta.suttaId,
				nikaya: meta.nikaya,
				vagga: meta.vagga,
				title_pali: titleFromMap(paliMap),
				title_en: titleFromMap(enMap),
				order_key: suttaSortKey(meta.suttaId),
			});
		}
		insTrans.run(meta.suttaId, meta.version, meta.model);
		for (const s of segs) {
			insSeg.run({ ...s, sutta_id: meta.suttaId, version: meta.version, model: meta.model });
		}
	}
}

for (const row of suttasSeen.values()) insSutta.run(row);

const latest = latestVersion([...versionsSeen]);
for (const version of versionsSeen) insVer.run(version, version === latest ? 1 : 0);

if (existsSync(PROMPTS_ROOT)) {
	for (const entry of readdirSync(PROMPTS_ROOT)) {
		if (!entry.endsWith('.md')) continue;
		const version = entry.replace(/\.md$/, '');
		insPrompt.run(version, readFileSync(join(PROMPTS_ROOT, entry), 'utf8'));
	}
}

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

db.close();
console.log(`Built ${DB_PATH}: ${suttasSeen.size} suttas, ${versionsSeen.size} versions, latest=${latest ?? 'none'}`);
