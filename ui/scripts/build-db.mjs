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

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = join(HERE, '..');
const TRANSLATION_ROOT = join(UI_ROOT, '..', 'translation');
// bilara-data is a sibling of the suttamula repo, i.e. two levels up from ui/.
const PALI_ROOT = join(UI_ROOT, '..', '..', 'bilara-data', 'root', 'pli', 'ms', 'sutta');
const PROMPTS_ROOT = join(UI_ROOT, '..', 'prompts');
const DB_DIR = join(UI_ROOT, 'data');
const DB_PATH = join(DB_DIR, 'suttamula.db');

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

// Title segment is the `:0.3` segment. For range files (e.g. an1.316-332) the
// keys carry the sub-sutta id, so fall back to the first key ending in :0.3.
function titleFromMap(suttaId, map) {
	if (map[`${suttaId}:0.3`] != null) return map[`${suttaId}:0.3`];
	const key = Object.keys(map).find((k) => k.endsWith(':0.3'));
	return key ? map[key] : null;
}

mkdirSync(DB_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
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

		const key = meta.suttaId;
		if (!suttasSeen.has(key)) {
			suttasSeen.set(key, {
				id: meta.suttaId,
				nikaya: meta.nikaya,
				vagga: meta.vagga,
				title_pali: titleFromMap(meta.suttaId, paliMap),
				title_en: titleFromMap(meta.suttaId, enMap),
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

db.close();
console.log(`Built ${DB_PATH}: ${suttasSeen.size} suttas, ${versionsSeen.size} versions, latest=${latest ?? 'none'}`);
