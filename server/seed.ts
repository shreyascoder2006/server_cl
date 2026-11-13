import type { DB } from './db.ts';
import { hashPassword } from './auth.ts';

/**
 * Starting catalogue. Every value here is only a seed: admins edit all of it in
 * Admin > Products & pricing. Prices are in US cents. Vendor (provider) names are
 * admin-only and never shown to customers.
 */
export const SEED_PROVIDERS = [
  { id: 'namesilo', name: 'NameSilo', purpose: 'Domain availability, pricing and registration (.com)', docs_url: 'https://www.namesilo.com/api-reference' },
  { id: 'mailpool', name: 'Mailpool', purpose: 'Google Workspace, Microsoft 365 and shared SMTP mailboxes', docs_url: 'https://docs.mailpool.ai/en/collections/11895805-api' },
  { id: 'inboxkit', name: 'InboxKit', purpose: 'Microsoft 365, Azure tenants and pre-warmed mailboxes', docs_url: 'https://docs.inboxkit.com/' },
  { id: 'cloudflare', name: 'Cloudflare', purpose: 'DNS zones and records automation', docs_url: 'https://developers.cloudflare.com/api/' },
  { id: 'ovh', name: 'OVHcloud', purpose: 'Raw SMTP servers (VPS)', docs_url: 'https://api.us.ovhcloud.com/console/' },
];

const commonFresh = ['Automated DNS setup (SPF, DKIM, DMARC)', 'Custom sender names', 'Works with Cloudlead sequences', 'Monthly or annual billing'];

export const SEED_PRODUCTS = [
  {
    code: 'google_workspace', category: 'fresh', name: 'Google Workspace', platform: 'google', provider_id: 'mailpool',
    tagline: 'Gmail inboxes on your own secondary domains', badge: 'Popular', featured: 0,
    description: 'Brand-new Google Workspace mailboxes on fresh .com domains, set up and DNS-configured for you.',
    features: commonFresh, unit: 'mailbox', monthly_price_cents: 425, cost_cents: 400, allowed_ratios: [1, 2, 3, 4, 5], default_ratio: 3, sort_order: 10,
  },
  {
    code: 'microsoft_365', category: 'fresh', name: 'Microsoft 365', platform: 'microsoft', provider_id: 'inboxkit',
    tagline: 'Outlook inboxes trusted by Microsoft recipients', badge: null, featured: 0,
    description: 'Brand-new Microsoft 365 (Outlook) mailboxes on fresh .com domains, set up and DNS-configured for you.',
    features: commonFresh, unit: 'mailbox', monthly_price_cents: 450, cost_cents: 300, allowed_ratios: [1, 2, 3, 4, 5], default_ratio: 3, sort_order: 20,
  },
  {
    code: 'azure_tenant', category: 'fresh', name: 'Microsoft Azure tenant', platform: 'azure', provider_id: 'inboxkit',
    tagline: 'A dedicated Microsoft tenant for high-volume teams', badge: 'High volume', featured: 0,
    description: 'Priced per dedicated tenant. Each tenant includes up to 50 mailboxes on Microsoft cloud infrastructure with isolated sending.',
    features: ['Up to 50 mailboxes per tenant', 'Dedicated, isolated tenant', 'Automated DNS setup', 'Monthly or annual billing'],
    unit: 'tenant', mailboxes_per_unit: 50, monthly_price_cents: 3900, cost_cents: 3000, allowed_ratios: [5, 10, 25, 50], default_ratio: 10,
    qty_presets: [50, 100, 150, 200], sort_order: 30,
  },
  {
    code: 'shared_smtp', category: 'fresh', name: 'Shared SMTP mailboxes', platform: 'smtp', provider_id: 'mailpool',
    tagline: 'Low-cost SMTP inboxes on managed shared servers', badge: null, featured: 0,
    description: 'SMTP/IMAP mailboxes hosted on managed shared sending servers with rotating IPs.',
    features: ['Managed shared servers', 'Automated DNS setup', 'Custom sender names', 'Monthly or annual billing'],
    unit: 'mailbox', monthly_price_cents: 350, cost_cents: 300, allowed_ratios: [1, 2, 3, 4, 5], default_ratio: 3, sort_order: 40,
  },
  {
    code: 'raw_smtp_server', category: 'server', name: 'Raw SMTP Server', platform: 'smtp_server', provider_id: 'ovh',
    tagline: 'Your own server. Build unlimited SMTP inboxes with Cloudlead’s free SMTP builder.', badge: 'Only on Cloudlead', featured: 1,
    description: 'A dedicated raw VPS with its own IP. Use Cloudlead’s free SMTP building tool to create as many sending inboxes as you need, at a fraction of per-mailbox pricing.',
    features: ['Dedicated server and IP', 'Unlimited inboxes with the free SMTP builder', 'Full control of your sending setup', 'Monthly or annual billing'],
    unit: 'server', monthly_price_cents: 1900, cost_cents: 800, allowed_ratios: [1, 2, 3, 5, 10], default_ratio: 3, qty_presets: [1, 2, 3, 5],
    needs_personas: 0, sort_order: 5,
  },
  {
    code: 'prewarmed_google', category: 'prewarmed', name: 'Pre-warmed Google Workspace', platform: 'google', provider_id: 'inboxkit',
    tagline: 'Ready to send from day one', badge: null, featured: 0,
    description: 'Google Workspace mailboxes on domains that already have a sending history.',
    features: ['Warmed domains and inboxes', 'No setup wait', 'Launch campaigns immediately'],
    unit: 'mailbox', monthly_price_cents: 900, cost_cents: 600, needs_personas: 0, sort_order: 60,
    price_tiers: [{ key: '2-4w', label: '2–4 weeks warmed', monthly_price_cents: 900 }, { key: '4-8w', label: '4–8 weeks warmed', monthly_price_cents: 1000 }, { key: '8w+', label: '8+ weeks warmed', monthly_price_cents: 1200 }],
  },
  {
    code: 'prewarmed_microsoft', category: 'prewarmed', name: 'Pre-warmed Microsoft 365', platform: 'microsoft', provider_id: 'inboxkit',
    tagline: 'Ready to send from day one', badge: null, featured: 0,
    description: 'Microsoft 365 mailboxes on domains that already have a sending history.',
    features: ['Warmed domains and inboxes', 'No setup wait', 'Launch campaigns immediately'],
    unit: 'mailbox', monthly_price_cents: 900, cost_cents: 600, needs_personas: 0, sort_order: 70,
    price_tiers: [{ key: '2-4w', label: '2–4 weeks warmed', monthly_price_cents: 900 }, { key: '4-8w', label: '4–8 weeks warmed', monthly_price_cents: 1000 }, { key: '8w+', label: '8+ weeks warmed', monthly_price_cents: 1200 }],
  },
];

export const SEED_SETTINGS: { key: string; value: unknown; label: string; kind: string }[] = [
  { key: 'annual_discount_pct', value: 15, label: 'Default annual discount (%)', kind: 'number' },
  { key: 'domain_price_cents', value: 1200, label: 'New .com domain price (cents / year)', kind: 'cents' },
  { key: 'domain_renewal_cents', value: 1200, label: '.com renewal price (cents / year)', kind: 'cents' },
  { key: 'domain_max_registrar_cost_cents', value: 1500, label: 'Hide domains whose registrar cost exceeds (cents)', kind: 'cents' },
  { key: 'prewarmed_domain_fee_cents', value: 1800, label: 'Pre-warmed domain fee (cents / year)', kind: 'cents' },
  { key: 'tax_pct', value: 0, label: 'Tax rate applied at checkout (%)', kind: 'number' },
  { key: 'max_domains_per_order', value: 100, label: 'Maximum domains per order', kind: 'number' },
  { key: 'checkout_hold_minutes', value: 30, label: 'Minutes a quote stays valid at checkout', kind: 'number' },
];

export function seed(db: DB) {
  const now = db.prepare('SELECT COUNT(*) AS n FROM providers').get() as { n: number };
  if (now.n > 0) return false;

  const insProvider = db.prepare('INSERT INTO providers (id, name, purpose, enabled, mode, docs_url) VALUES (?,?,?,?,?,?)');
  for (const p of SEED_PROVIDERS) insProvider.run(p.id, p.name, p.purpose, 1, 'mock', p.docs_url);

  const insProduct = db.prepare(`INSERT INTO products (code, category, name, tagline, description, features, platform, provider_id, enabled, featured, badge, unit,
    mailboxes_per_unit, monthly_price_cents, annual_discount_pct, cost_cents, min_qty, max_qty, qty_presets, allowed_ratios, default_ratio, needs_domains, needs_personas, price_tiers, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const p of SEED_PRODUCTS as any[]) {
    insProduct.run(p.code, p.category, p.name, p.tagline, p.description, JSON.stringify(p.features), p.platform, p.provider_id, 1, p.featured ?? 0, p.badge ?? null, p.unit,
      p.mailboxes_per_unit ?? null, p.monthly_price_cents, null, p.cost_cents ?? null, 1, p.unit === 'server' ? 50 : 2000,
      JSON.stringify(p.qty_presets ?? [10, 20, 50, 100]), JSON.stringify(p.allowed_ratios ?? [1]), p.default_ratio ?? 1,
      p.category === 'prewarmed' ? 0 : 1, p.needs_personas ?? 1, p.price_tiers ? JSON.stringify(p.price_tiers) : null, p.sort_order);
  }

  const insSetting = db.prepare('INSERT INTO settings (key, value, label, kind) VALUES (?,?,?,?)');
  for (const s of SEED_SETTINGS) insSetting.run(s.key, JSON.stringify(s.value), s.label, s.kind);

  const insTenant = db.prepare('INSERT INTO tenants (id, name) VALUES (?,?)');
  const insUser = db.prepare('INSERT INTO users (id, tenant_id, email, name, role, password_hash) VALUES (?,?,?,?,?,?)');
  insTenant.run('t_cloudlead', 'Cloudlead (internal)');
  insTenant.run('t_acme', 'Acme Growth Agency');
  insTenant.run('t_globex', 'Globex Outbound');
  insUser.run('u_admin', 't_cloudlead', 'admin@cloudlead.local', 'Cloudlead Admin', 'admin', hashPassword('admin1234'));
  insUser.run('u_demo', 't_acme', 'demo@acme.local', 'Priya Demo', 'customer', hashPassword('demo1234'));
  insUser.run('u_other', 't_globex', 'other@globex.local', 'Sam Other', 'customer', hashPassword('demo1234'));
  return true;
}
