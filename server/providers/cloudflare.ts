import { config } from '../config.ts';
import { httpJson } from './http.ts';
import { NotConfiguredError, type DnsProvider, type HealthCheck } from './types.ts';

/**
 * Cloudflare live adapter (API v4, https://api.cloudflare.com/client/v4).
 * Uses an account-owned API token with the minimum permissions:
 *   Zone: Zone Edit, Zone: DNS Edit  (scoped to the Cloudlead account)
 * Operations: verify token, find/create zone, list/create/update DNS records.
 */

const BASE = 'https://api.cloudflare.com/client/v4';

function headers() {
  if (!config.cloudflare.apiToken) throw new NotConfiguredError('CLOUDFLARE_API_TOKEN is not set.');
  return { Authorization: `Bearer ${config.cloudflare.apiToken}` };
}

async function cf<T = any>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown, operation = path): Promise<T> {
  const data = await httpJson<any>(`${BASE}${path}`, { method, headers: headers(), body, provider: 'cloudflare', operation, idempotent: method !== 'POST' });
  if (!data?.success) throw new Error(`Cloudflare ${operation} failed: ${(data?.errors ?? []).map((e: any) => e.message).join('; ') || 'unknown error'}`);
  return data.result as T;
}

export const cloudflareLive: DnsProvider = {
  id: 'cloudflare',
  async ensureZone(domain) {
    const existing = await cf<any[]>(`/zones?name=${encodeURIComponent(domain)}`, 'GET', undefined, 'zones.list');
    const zone = existing?.[0] ?? await cf<any>('/zones', 'POST', { name: domain, account: { id: config.cloudflare.accountId }, type: 'full' }, 'zones.create');
    return { zoneId: zone.id, nameservers: zone.name_servers ?? [] };
  },
  async upsertRecords(zoneId, _domain, records) {
    let created = 0;
    let updated = 0;
    for (const r of records) {
      const found = await cf<any[]>(`/zones/${zoneId}/dns_records?type=${r.type}&name=${encodeURIComponent(r.name)}`, 'GET', undefined, 'dns_records.list');
      const body = { type: r.type, name: r.name, content: r.content, ttl: r.ttl ?? 1, priority: r.priority, proxied: r.proxied ?? false };
      // TXT records can legitimately repeat (SPF vs verification); only replace an exact-prefix match.
      const match = (found ?? []).find((f) => r.type !== 'TXT' || String(f.content).split(' ')[0] === r.content.split(' ')[0]);
      if (match) { await cf(`/zones/${zoneId}/dns_records/${match.id}`, 'PUT', body, 'dns_records.update'); updated++; }
      else { await cf(`/zones/${zoneId}/dns_records`, 'POST', body, 'dns_records.create'); created++; }
    }
    return { created, updated };
  },
  async health(): Promise<HealthCheck[]> {
    if (!config.cloudflare.apiToken) return [{ name: 'Credentials', ok: false, detail: 'CLOUDFLARE_API_TOKEN is not set.' }];
    const checks: HealthCheck[] = [];
    const verifyPath = config.cloudflare.accountId ? `/accounts/${config.cloudflare.accountId}/tokens/verify` : '/user/tokens/verify';
    try {
      const r = await cf<any>(verifyPath, 'GET', undefined, 'tokens.verify');
      checks.push({ name: 'Token is valid', ok: r?.status === 'active', detail: `Token status: ${r?.status ?? 'unknown'}` });
    } catch (e: any) {
      checks.push({ name: 'Token is valid', ok: false, detail: e.message });
    }
    try {
      const zones = await cf<any[]>('/zones?per_page=5', 'GET', undefined, 'zones.list');
      checks.push({ name: 'Can read zones (read-only)', ok: true, detail: `Token can list zones (${zones.length} visible on first page).` });
    } catch (e: any) {
      checks.push({ name: 'Can read zones (read-only)', ok: false, detail: e.message });
    }
    if (!config.cloudflare.accountId) checks.push({ name: 'Account id', ok: false, detail: 'CLOUDFLARE_ACCOUNT_ID is not set; new zones cannot be created.' });
    checks.push({ name: 'Create zone / DNS records', ok: false, billable: false, detail: 'Not run automatically: creates real DNS resources.' });
    return checks;
  },
};
