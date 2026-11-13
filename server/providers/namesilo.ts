import { config } from '../config.ts';
import { httpJson } from './http.ts';
import { NotConfiguredError, type Contact, type DomainAvailability, type HealthCheck, type RegistrarProvider } from './types.ts';

/**
 * NameSilo live adapter.
 *
 * Verified from https://www.namesilo.com/api-reference: requests are HTTPS GET to
 *   https://www.namesilo.com/api/OPERATION?version=1&type=json&key=KEY&...
 * Operation names and parameters below follow NameSilo's API reference
 * (checkRegisterAvailability, contactAdd, registerDomain, changeNameServers,
 * getAccountBalance). The per-operation pages are JavaScript-rendered and could
 * not be fetched from the build environment, so each call is marked
 * "implemented, not live-tested" in INTEGRATION_NOTES.md. Test against the
 * NameSilo sandbox (credentials issued by NameSilo on request) before going live.
 *
 * Payment: NameSilo charges registrations to the account's funds balance (or the
 * payment profile set in NAMESILO_PAYMENT_ID). Keep the balance topped up.
 */

const SUCCESS_CODES = new Set([300, 301, 302]);

async function call(operation: string, params: Record<string, string | number>, idempotent = true) {
  if (!config.namesilo.apiKey) throw new NotConfiguredError('NAMESILO_API_KEY is not set.');
  const qs = new URLSearchParams({ version: '1', type: 'json', key: config.namesilo.apiKey });
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const url = `${config.namesilo.baseUrl.replace(/\/$/, '')}/${operation}?${qs}`;
  const data = await httpJson<any>(url, { provider: 'namesilo', operation, idempotent, timeoutMs: idempotent ? 15_000 : 60_000 });
  const reply = data?.reply;
  const code = Number(reply?.code);
  if (!SUCCESS_CODES.has(code)) throw new Error(`NameSilo ${operation} failed: ${reply?.detail ?? 'unknown error'} (code ${reply?.code ?? '?'})`);
  return reply;
}

const toCents = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Math.round(Number(v) * 100));
const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export const namesiloLive: RegistrarProvider = {
  id: 'namesilo',
  async checkAvailability(domains) {
    const out: DomainAvailability[] = [];
    // NameSilo accepts a comma-separated list; keep batches modest.
    for (let i = 0; i < domains.length; i += 50) {
      const batch = domains.slice(i, i + 50);
      const reply = await call('checkRegisterAvailability', { domains: batch.join(',') });
      for (const a of asArray<any>(reply?.available?.domain ?? reply?.available)) {
        const name = typeof a === 'string' ? a : a.domain;
        out.push({ domain: String(name).toLowerCase(), available: true, registrarPriceCents: toCents(a.price), renewalPriceCents: toCents(a.renew), premium: a.premium === 1 || a.premium === '1' });
      }
      for (const u of asArray<any>(reply?.unavailable?.domain ?? reply?.unavailable)) {
        out.push({ domain: String(typeof u === 'string' ? u : u.domain).toLowerCase(), available: false, reason: 'Already registered' });
      }
      for (const u of asArray<any>(reply?.invalid?.domain ?? reply?.invalid)) {
        out.push({ domain: String(typeof u === 'string' ? u : u.domain).toLowerCase(), available: false, reason: 'Invalid name' });
      }
    }
    // Anything the registrar did not mention is treated as unavailable (never assume available).
    const seen = new Set(out.map((o) => o.domain));
    for (const d of domains) if (!seen.has(d)) out.push({ domain: d, available: false, reason: 'No answer from registrar' });
    return out;
  },

  async registerDomain({ domain, years, contact }) {
    const contactId = await addContact(contact);
    const params: Record<string, string | number> = { domain, years, private: 1, auto_renew: 0, contact_id: contactId };
    if (config.namesilo.paymentId) params.payment_id = config.namesilo.paymentId;
    // Not idempotent: a timeout raises OutcomeUnknownError and the order is flagged for manual review.
    const reply = await call('registerDomain', params, false);
    const amount = reply?.order_amount !== undefined ? ` (charged $${reply.order_amount})` : '';
    return { externalRef: `${domain}${amount}`, status: 'registered' };
  },

  async setNameservers(domain, nameservers) {
    const params: Record<string, string> = { domain };
    nameservers.slice(0, 13).forEach((ns, i) => (params[`ns${i + 1}`] = ns));
    await call('changeNameServers', params, true);
  },

  async health(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    if (!config.namesilo.apiKey) return [{ name: 'Credentials', ok: false, detail: 'NAMESILO_API_KEY is not set.' }];
    try {
      const r = await call('getAccountBalance', {});
      checks.push({ name: 'Credentials + account balance (read-only)', ok: true, detail: `Key accepted. Account balance: $${r?.balance ?? '?'}` });
    } catch (e: any) {
      checks.push({ name: 'Credentials + account balance (read-only)', ok: false, detail: e.message });
    }
    try {
      const r = await namesiloLive.checkAvailability(['cloudlead-healthcheck-example.com']);
      checks.push({ name: 'Availability lookup (read-only)', ok: true, detail: `Lookup answered: ${r[0]?.available ? 'available' : 'unavailable'}.` });
    } catch (e: any) {
      checks.push({ name: 'Availability lookup (read-only)', ok: false, detail: e.message });
    }
    checks.push({ name: 'Domain registration', ok: false, billable: true, detail: 'Not run automatically: registering a domain is charged to your NameSilo balance.' });
    return checks;
  },
};

async function addContact(c: Contact): Promise<string> {
  const reply = await call('contactAdd', {
    fn: c.firstName, ln: c.lastName, cp: c.company ?? '', ad: c.address1, ad2: c.address2 ?? '', cy: c.city, st: c.state,
    zp: c.postalCode, ct: c.country, em: c.email, ph: c.phone.replace(/[^\d+]/g, ''),
  }, false);
  const id = reply?.contact_id;
  if (!id) throw new Error('NameSilo contactAdd returned no contact_id');
  return String(id);
}
