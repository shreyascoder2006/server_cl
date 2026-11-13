import { config } from '../config.ts';
import { httpJson } from './http.ts';
import { standardMailRecords } from './mock.ts';
import {
  NotConfiguredError, NotVerifiedError, type HealthCheck, type MailboxProvider, type PrewarmedProvider,
} from './types.ts';

/**
 * InboxKit live adapter. Public docs: https://docs.inboxkit.com/
 *
 * Verified from the docs (Nov 2026):
 *  - Auth: "Authorization: Bearer <API key>" (key from Settings > API & MCP).
 *  - Domain/mailbox calls also need header "X-Workspace-Id" (workspace uid).
 *  - Pre-warmed purchase: POST {base}/v1/api/prewarm/buy-domain, response data.order_uid,
 *    status "pending", total_price; charged to the InboxKit wallet at order time.
 *  - Buy mailboxes: body { username, domain, platform } with platform e.g. "GOOGLE";
 *    Azure and SMTP mailboxes are wallet-only. Mailboxes go "scheduled" -> "active".
 *  - Errors: 401 no auth token, 402 insufficient wallet balance, 400 workspace id required.
 *
 * NOT yet verified (docs are inconsistent about the /v1 prefix and the exact
 * paths for search, buy-mailboxes and account details were not captured), so
 * those calls raise NotVerifiedError instead of guessing. Fill in PATHS after
 * opening https://docs.inboxkit.com/ with the real key and confirming each path.
 */

const PATHS = {
  prewarmBuy: '/v1/api/prewarm/buy-domain', // verified in docs
  prewarmSearch: '', // TODO verify: "Search Domains" (POST)
  prewarmCheck: '', // TODO verify: "Check Availability" (POST)
  buyMailboxes: '', // TODO verify: "Buy mailboxes" (POST)
  accountDetails: '', // TODO verify: "Get account details" (GET)
};

function base() { return config.inboxkit.baseUrl.replace(/\/$/, ''); }
function headers(withWorkspace = true) {
  if (!config.inboxkit.apiKey) throw new NotConfiguredError('INBOXKIT_API_KEY is not set.');
  const h: Record<string, string> = { Authorization: `Bearer ${config.inboxkit.apiKey}` };
  if (withWorkspace) {
    if (!config.inboxkit.workspaceId) throw new NotConfiguredError('INBOXKIT_WORKSPACE_ID is not set.');
    h['X-Workspace-Id'] = config.inboxkit.workspaceId;
  }
  return h;
}
function need(path: string, op: string) {
  if (!path) throw new NotVerifiedError('inboxkit', op, 'Confirm the endpoint path at https://docs.inboxkit.com/ and set it in server/providers/inboxkit.ts.');
  return path;
}

const PLATFORM: Record<string, string> = { google: 'GOOGLE', microsoft: 'MICROSOFT', azure: 'AZURE', smtp: 'SMTP' }; // TODO verify non-GOOGLE values

export const inboxkitMailboxesLive: MailboxProvider = {
  id: 'inboxkit',
  platforms: ['google', 'microsoft', 'azure', 'smtp'],
  supportsProfileImage: false,
  requiredDnsRecords: standardMailRecords,
  async createMailboxes({ platform, domain, mailboxes }) {
    const path = need(PATHS.buyMailboxes, 'createMailboxes');
    const results = [];
    for (const m of mailboxes) {
      results.push(await httpJson<any>(`${base()}${path}`, {
        method: 'POST', headers: headers(), provider: 'inboxkit', operation: 'buyMailboxes', idempotent: false,
        body: { username: m.username, domain, platform: PLATFORM[platform] ?? platform.toUpperCase(), first_name: m.firstName, last_name: m.lastName },
      }));
    }
    return { externalRef: results.map((r) => r?.mailboxes?.[0]?.uid ?? r?.data?.uid ?? '?').join(','), status: 'scheduled' };
  },
  async health() { return inboxkitHealth(); },
};

export const inboxkitPrewarmedLive: PrewarmedProvider = {
  id: 'inboxkit',
  async search(filters) {
    const path = need(PATHS.prewarmSearch, 'prewarm.search');
    const data = await httpJson<any>(`${base()}${path}`, { method: 'POST', headers: headers(), body: filters, provider: 'inboxkit', operation: 'prewarm.search', idempotent: true });
    return (data?.data ?? []) as any[];
  },
  async checkAvailability(domains) {
    const path = need(PATHS.prewarmCheck, 'prewarm.checkAvailability');
    const data = await httpJson<any>(`${base()}${path}`, { method: 'POST', headers: headers(), body: { domains }, provider: 'inboxkit', operation: 'prewarm.check', idempotent: true });
    return (data?.data ?? []).map((d: any) => ({ domain: d.domain, available: !!d.available }));
  },
  async buy({ domains, forwardingDomain }) {
    const data = await httpJson<any>(`${base()}${PATHS.prewarmBuy}`, {
      method: 'POST', headers: headers(), provider: 'inboxkit', operation: 'prewarm.buy', idempotent: false,
      body: { domains, forwarding_domain: forwardingDomain }, // TODO verify body field names
    });
    const uid = data?.data?.order_uid;
    if (!uid) throw new Error('InboxKit did not return an order_uid; treating as failed.');
    return { externalRef: uid, status: 'pending' };
  },
  async health() { return inboxkitHealth(); },
};

async function inboxkitHealth(): Promise<HealthCheck[]> {
  if (!config.inboxkit.apiKey) return [{ name: 'Credentials', ok: false, detail: 'INBOXKIT_API_KEY is not set.' }];
  const checks: HealthCheck[] = [{ name: 'Credentials present', ok: true, detail: 'API key is set (not shown).' }];
  checks.push({ name: 'Workspace id', ok: !!config.inboxkit.workspaceId, detail: config.inboxkit.workspaceId ? 'INBOXKIT_WORKSPACE_ID is set.' : 'Set INBOXKIT_WORKSPACE_ID (from "List workspaces").' });
  if (PATHS.accountDetails) {
    try {
      await httpJson(`${base()}${PATHS.accountDetails}`, { headers: headers(false), provider: 'inboxkit', operation: 'account' });
      checks.push({ name: 'Key accepted (read-only)', ok: true, detail: 'Account details returned.' });
    } catch (e: any) {
      checks.push({ name: 'Key accepted (read-only)', ok: false, detail: e.message });
    }
  } else {
    checks.push({ name: 'Key accepted (read-only)', ok: false, detail: 'Account-details endpoint path not verified yet; see INTEGRATION_NOTES.md.' });
  }
  checks.push({ name: 'Buy mailboxes / pre-warmed', ok: false, billable: true, detail: 'Not run automatically: charges the InboxKit wallet.' });
  return checks;
}
