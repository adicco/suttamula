import Database from 'better-sqlite3';
import { resolve } from 'node:path';

// Model ids contain a colon (e.g. "gpt-5.5:medium"). A percent-encoded colon
// in a URL path is fragile (dev router 404s, CDN inconsistency), so URLs carry
// a colon-free slug. Reversal is by lookup against the known models (below), so
// the slug can be lossy without ambiguity.
export function modelToSlug(model: string): string { return model.replaceAll(':', '-'); }

// Resolve from the project root (cwd during `astro build`), not import.meta.url:
// this module gets bundled into dist/.prerender at build time, so a path relative
// to the module location would break.
const DB_PATH = resolve(process.cwd(), 'data', 'suttamula.db');
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

export function getNikayas() { return db.prepare(`SELECT nikaya, COUNT(*) AS count FROM suttas GROUP BY nikaya ORDER BY nikaya`).all(); }
export function getSuttasByNikaya(nikaya) { return db.prepare(`SELECT id, vagga, title_pali, title_en FROM suttas WHERE nikaya = ? ORDER BY order_key`).all(nikaya); }
export function getCombos(suttaId) { return db.prepare(`SELECT version, model FROM translations WHERE sutta_id = ? ORDER BY version DESC, model`).all(suttaId); }
let _modelsCache: string[] | null = null;
function distinctModels(): string[] {
  if (!_modelsCache) _modelsCache = (db.prepare(`SELECT DISTINCT model FROM translations`).all() as Array<{ model: string }>).map((r) => r.model);
  return _modelsCache;
}
export function slugToModel(slug: string): string {
  return distinctModels().find((m) => modelToSlug(m) === slug) ?? slug;
}

export function getAllCombos() { return db.prepare(`SELECT sutta_id AS suttaId, version, model FROM translations`).all(); }
export function getSegments(suttaId, version, model) { return db.prepare(`SELECT seg_id, seg_order, pali, english FROM segments WHERE sutta_id = ? AND version = ? AND model = ? ORDER BY seg_order`).all(suttaId, version, model); }
export function getVersions() { return db.prepare(`SELECT version, is_latest FROM versions ORDER BY version`).all(); }
export function getLatestVersion() { const row = db.prepare(`SELECT version FROM versions WHERE is_latest = 1`).get(); if (!row) throw new Error('No latest version in DB'); return row.version; }
export function resolveVersion(v) { return v === 'latest' ? getLatestVersion() : v; }
export function getDefaultModel(suttaId, version) { const row = db.prepare(`SELECT model FROM translations WHERE sutta_id = ? AND version = ? ORDER BY model LIMIT 1`).get(suttaId, version); if (!row) throw new Error(`No model for ${suttaId} ${version}`); return row.model; }
// Best (version, model) for a sutta: newest available version, first model.
// Not every sutta has a translation in the global latest version, so browse
// links must use whatever the sutta actually has.
export function getDefaultCombo(suttaId) { const row = db.prepare(`SELECT version, model FROM translations WHERE sutta_id = ? ORDER BY version DESC, model LIMIT 1`).get(suttaId); if (!row) throw new Error(`No translation for ${suttaId}`); return row; }
export function getSutta(suttaId) { return db.prepare(`SELECT id, nikaya, vagga, title_pali, title_en FROM suttas WHERE id = ?`).get(suttaId); }
export function getPrompt(version) { const row = db.prepare(`SELECT body_md FROM prompts WHERE version = ?`).get(version); return row?.body_md ?? null; }
export function getPromptVersions() { return db.prepare(`SELECT version FROM prompts ORDER BY version`).all().map((r) => r.version); }
