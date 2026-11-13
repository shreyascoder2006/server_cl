import type { DB } from './db.ts';
import { getSettings } from './catalog.ts';
import { registrar } from './providers/registry.ts';

/**
 * Domain search: we generate name ideas locally (cheap, instant), then ask the
 * registrar which of them are actually available. Only confirmed-available
 * names are returned as purchasable. Availability is checked again at checkout.
 */

export const TLD = '.com';
const PREFIXES = ['get', 'try', 'meet', 'hey', 'join', 'go', 'with', 'team', 'hello', 'use', 'the', 'reach', 'mail', 'grow', 'its'];
const SUFFIXES = ['hq', 'team', 'mail', 'group', 'labs', 'hub', 'now', 'works', 'connect', 'pro', 'global', 'direct', 'partners', 'reach', 'growth', 'outreach', 'online', 'co', 'inc', 'app'];

export function normalizeRoot(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0];
  if (s.includes('.')) s = s.slice(0, s.indexOf('.'));
  s = s.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  return s.slice(0, 40);
}

export function isValidComDomain(d: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.com$/.test(d);
}

/** Deterministic, ordered list of candidate .com names for a root. */
export function generateCandidates(root: string, primary?: string): string[] {
  const r = normalizeRoot(root);
  if (r.length < 2) return [];
  const out: string[] = [];
  const add = (name: string) => {
    const d = `${name}${TLD}`;
    if (name.length >= 3 && name.length <= 63 && isValidComDomain(d) && !out.includes(d) && d !== primary) out.push(d);
  };
  // Interleave prefixes and suffixes so the first page has variety.
  for (let i = 0; i < Math.max(PREFIXES.length, SUFFIXES.length); i++) {
    if (PREFIXES[i]) add(`${PREFIXES[i]}${r}`);
    if (SUFFIXES[i]) add(`${r}${SUFFIXES[i]}`);
  }
  for (const p of PREFIXES.slice(0, 6)) add(`${p}-${r}`);
  for (const s of SUFFIXES.slice(0, 6)) add(`${r}-${s}`);
  return out;
}

export interface DomainOption { domain: string; priceCents: number; renewalCents: number }

export async function searchDomains(db: DB, query: string, opts: { offset?: number; limit?: number; exclude?: string[]; primaryDomain?: string } = {}) {
  const settings = getSettings(db);
  const root = normalizeRoot(query);
  const primary = opts.primaryDomain ? `${normalizeRoot(opts.primaryDomain)}${TLD}` : undefined;
  const all = generateCandidates(root, primary);
  const offset = opts.offset ?? 0;
  const limit = Math.min(opts.limit ?? 16, 40);
  const exclude = new Set(opts.exclude ?? []);
  const results: DomainOption[] = [];
  let cursor = offset;
  const maxCost = Number(settings.domain_max_registrar_cost_cents ?? Infinity);
  // Check in batches until we have `limit` confirmed-available names or run out of ideas.
  while (results.length < limit && cursor < all.length) {
    const batch = all.slice(cursor, cursor + 24).filter((d) => !exclude.has(d));
    cursor += 24;
    if (!batch.length) continue;
    const checked = await registrar(db).checkAvailability(batch);
    for (const c of checked) {
      if (!c.available || c.premium) continue;
      if (c.registrarPriceCents !== undefined && c.registrarPriceCents > maxCost) continue;
      results.push({ domain: c.domain, priceCents: Number(settings.domain_price_cents), renewalCents: Number(settings.domain_renewal_cents) });
      if (results.length >= limit) break;
    }
  }
  return { root, results, nextOffset: cursor < all.length ? cursor : null, checkedLive: true };
}

/** Re-check a set of chosen domains right before payment. */
export async function recheckDomains(db: DB, domains: string[]) {
  if (!domains.length) return { ok: true, unavailable: [] as string[] };
  const settings = getSettings(db);
  const maxCost = Number(settings.domain_max_registrar_cost_cents ?? Infinity);
  const checked = await registrar(db).checkAvailability(domains);
  const unavailable = domains.filter((d) => {
    const c = checked.find((x) => x.domain === d);
    return !c || !c.available || c.premium || (c.registrarPriceCents !== undefined && c.registrarPriceCents > maxCost);
  });
  return { ok: unavailable.length === 0, unavailable };
}
