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
