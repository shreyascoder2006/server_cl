import crypto from 'node:crypto';
import type {
  DnsProvider, DnsRecord, DomainAvailability, MailboxProvider, PrewarmedListing, PrewarmedProvider,
  RegistrarProvider, ServerProvider,
} from './types.ts';

/**
 * Deterministic fake vendors for local development and tests. Nothing here
 * contacts the network or buys anything. The same input always gives the same
 * answer so the UI and tests are predictable.
 */

const h = (s: string) => crypto.createHash('sha1').update(s).digest().readUInt32BE(0);
const ref = (prefix: string, key: string) => `${prefix}_${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`;

// A handful of names that are "taken" in mock mode so the UI shows realistic gaps.
const TAKEN = new Set(['google.com', 'acme.com', 'cloudlead.com', 'outreach.com', 'sales.com', 'growth.com']);

export function mockAvailable(domain: string): boolean {
  if (TAKEN.has(domain)) return false;
  return h(`avail:${domain}`) % 5 !== 0; // ~80% available
}

export const mockRegistrar: RegistrarProvider = {
  id: 'namesilo',
  async checkAvailability(domains) {
    return domains.map((domain): DomainAvailability => {
      const available = mockAvailable(domain);
      const premium = available && h(`prem:${domain}`) % 40 === 0;
      return {
        domain, available, premium,
        registrarPriceCents: premium ? 29900 : 1015 + (h(domain) % 3) * 30,
        renewalPriceCents: 1015,
        reason: available ? undefined : 'Already registered',
      };
    });
  },
  async registerDomain({ domain, idempotencyKey }) {
    if (!mockAvailable(domain)) throw new Error(`${domain} is no longer available`);
    return { externalRef: ref('ns_order', idempotencyKey), status: 'registered' };
  },
  async setNameservers() { /* no-op */ },
  async health() {
    return [
      { name: 'Credentials', ok: true, detail: 'Mock mode: no credentials needed.' },
      { name: 'Availability lookup (read-only)', ok: true, detail: 'Mock lookup returned results for example-outreach.com.' },
    ];
  },
};

export const mockDns: DnsProvider = {
  id: 'cloudflare',
  async ensureZone(domain) {
    return { zoneId: ref('zone', domain), nameservers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'] };
  },
  async upsertRecords(_zoneId, _domain, records) {
    return { created: records.length, updated: 0 };
  },
  async health() {
    return [
      { name: 'Token permissions', ok: true, detail: 'Mock mode: Zone:Edit and DNS:Edit assumed.' },
    ];
  },
};

export function standardMailRecords(platform: string, domain: string, forwardingUrl?: string): DnsRecord[] {
  const recs: DnsRecord[] = [];
  if (platform === 'google') {
    recs.push({ type: 'MX', name: domain, content: 'smtp.google.com', priority: 1 });
    recs.push({ type: 'TXT', name: domain, content: 'v=spf1 include:_spf.google.com ~all' });
  } else if (platform === 'microsoft' || platform === 'azure') {
    recs.push({ type: 'MX', name: domain, content: `${domain.replace(/\./g, '-')}.mail.protection.outlook.com`, priority: 0 });
    recs.push({ type: 'TXT', name: domain, content: 'v=spf1 include:spf.protection.outlook.com -all' });
    recs.push({ type: 'CNAME', name: `autodiscover.${domain}`, content: 'autodiscover.outlook.com' });
  } else {
    recs.push({ type: 'TXT', name: domain, content: 'v=spf1 a mx ~all' });
  }
  recs.push({ type: 'TXT', name: `_dmarc.${domain}`, content: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}` });
  if (forwardingUrl) recs.push({ type: 'A', name: domain, content: '192.0.2.10', proxied: true }); // redirect handled by a page rule / redirect rule
  return recs;
}

function makeMailboxProvider(id: string, platforms: string[], profileImage: boolean): MailboxProvider {
  return {
    id, platforms, supportsProfileImage: profileImage,
    requiredDnsRecords: standardMailRecords,
    async createMailboxes({ idempotencyKey, mailboxes }) {
      if (mailboxes.length === 0) throw new Error('No mailboxes requested');
      return { externalRef: ref(`${id}_mbx`, idempotencyKey), status: 'scheduled' };
    },
    async health() {
      return [{ name: 'Credentials', ok: true, detail: 'Mock mode: no credentials needed.' }];
    },
  };
}

export const mockMailpool = makeMailboxProvider('mailpool', ['google', 'microsoft', 'smtp'], true);
export const mockInboxkitMailboxes = makeMailboxProvider('inboxkit', ['google', 'microsoft', 'azure', 'smtp'], false);

const FIRST = ['olivia', 'liam', 'emma', 'noah', 'ava', 'mason', 'mia', 'lucas', 'zoe', 'ethan', 'chloe', 'ryan', 'nora', 'leo', 'ruby', 'owen'];
const LAST = ['parker', 'reed', 'hayes', 'brooks', 'cole', 'wells', 'grant', 'ellis', 'shaw', 'quinn'];
const ROOTS = ['ridgeyield', 'platformevolve', 'negotiateboost', 'holdingsascent', 'demandmarsh', 'coremeridian', 'sprintcompany', 'frameworklaunch',
  'expansionbounce', 'millcontact', 'buzzguardian', 'scoperollout', 'pipelinecrest', 'leadharbor', 'replyforge', 'meetingorbit', 'quotaspring',
  'closerpath', 'prospectfield', 'signalhaven', 'outboundmesa', 'growthkeel', 'dealsummit', 'revenuegrove'];
const TIERS = [{ key: '2-4w', weeks: 3 }, { key: '4-8w', weeks: 6 }, { key: '8w+', weeks: 10 }];

export const MOCK_PREWARMED: PrewarmedListing[] = ROOTS.map((root, i) => {
  const platform = i % 3 === 2 ? 'microsoft' : 'google';
  const tier = TIERS[h(root) % TIERS.length];
  const domain = `${root}.com`;
  const mailboxes = [0, 1, 2].map((k) => {
    const f = FIRST[(h(root) + k * 5) % FIRST.length];
    const l = LAST[(h(root) + k * 3) % LAST.length];
    return { address: `${f}@${domain}`, name: `${f[0].toUpperCase()}${f.slice(1)} ${l[0].toUpperCase()}${l.slice(1)}` };
  });
  return { domain, platform, tierKey: tier.key, warmupWeeks: tier.weeks, mailboxes, domainExpires: '2027-09-18', recommended: i < 6 };
});

export const mockPrewarmed: PrewarmedProvider = {
  id: 'inboxkit',
  async search({ platform, tierKey, q }) {
    return MOCK_PREWARMED.filter((l) => (!platform || l.platform === platform) && (!tierKey || l.tierKey === tierKey) && (!q || l.domain.includes(q.toLowerCase())));
  },
  async checkAvailability(domains) {
    return domains.map((d) => ({ domain: d, available: MOCK_PREWARMED.some((l) => l.domain === d) }));
  },
  async buy({ idempotencyKey }) {
    return { externalRef: ref('ik_prewarm', idempotencyKey), status: 'pending' };
  },
  async health() {
    return [{ name: 'Inventory lookup (read-only)', ok: true, detail: `Mock inventory has ${MOCK_PREWARMED.length} domains.` }];
  },
};

export const mockServers: ServerProvider = {
  id: 'ovh',
  async listPlans() {
    return [{ planCode: 'vps-starter-mock', label: 'VPS Starter (2 vCPU, 4 GB)', region: 'US-East', costCents: 800 }];
  },
  async orderServers({ idempotencyKey }) {
    return { externalRef: ref('ovh_order', idempotencyKey), status: 'pending' };
  },
  async health() {
    return [{ name: 'Credentials', ok: true, detail: 'Mock mode: no credentials needed.' }];
  },
};
