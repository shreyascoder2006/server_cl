import { describe, expect, it } from 'vitest';
import { generateCandidates, isValidComDomain, normalizeRoot } from '../server/domains.ts';
import { generateMailboxes, canTransition } from '../server/orderModel.ts';
import { redact } from '../server/log.ts';
import { ovhSignature } from '../server/providers/ovh.ts';
import { quoteFresh, requiredDomains } from '../server/pricing.ts';
import { rowToProduct } from '../server/catalog.ts';
import { openDb } from '../server/db.ts';
import { seed } from '../server/seed.ts';

const db = openDb(':memory:');
seed(db);
const product = (code: string) => rowToProduct(db.prepare('SELECT * FROM products WHERE code = ?').get(code));
const settings = { annual_discount_pct: 15, domain_price_cents: 1200, domain_renewal_cents: 1200, tax_pct: 0 };

describe('domain ideas', () => {
  it('normalizes input and generates only valid .com names', () => {
    expect(normalizeRoot('https://www.Talent HR.in/about')).toBe('talenthr');
    const c = generateCandidates('talenthr', 'talenthr.com');
    expect(c.length).toBeGreaterThan(20);
    expect(c.every(isValidComDomain)).toBe(true);
    expect(c).not.toContain('talenthr.com');
    expect(new Set(c).size).toBe(c.length);
  });
});

describe('pricing', () => {
  it('azure is priced per tenant', () => {
    const q = quoteFresh(product('azure_tenant'), { term: 'monthly', quantity: 120, ratio: 10, newDomains: [] }, settings);
    expect(q.unitCount).toBe(3); // 120 mailboxes / 50 per tenant
    expect(q.dueTodayCents).toBe(3 * 3900);
  });
  it('required domains follow the ratio', () => {
    expect(requiredDomains(product('google_workspace'), 10, 3)).toBe(4);
    expect(requiredDomains(product('raw_smtp_server'), 2, 5)).toBe(10);
  });
});

describe('mailbox generation', () => {
  it('creates unique addresses per domain even for same names', () => {
    const boxes = generateMailboxes({ domains: ['a.com'], addressPattern: 'first', personas: [
      { id: '1', firstName: 'Sam', lastName: 'Lee', domains: 'all' }, { id: '2', firstName: 'Sam', lastName: 'Lee', domains: 'all' },
    ] });
    expect(boxes.map((b) => b.address)).toEqual(['sam@a.com', 'sam.lee@a.com']);
  });
});

describe('state machine', () => {
  it('cannot skip payment', () => {
    expect(canTransition('draft', 'submitting')).toBe(false);
    expect(canTransition('awaiting_payment', 'submitting')).toBe(false);
    expect(canTransition('payment_authorized', 'submitting')).toBe(true);
  });
});

describe('security helpers', () => {
  it('redacts secret fields and query keys', () => {
    const r = redact({ key: 'abc', nested: { Authorization: 'Bearer x' }, url: 'https://x/api?key=SECRET123&a=1' });
    expect(JSON.stringify(r)).not.toMatch(/abc|Bearer x|SECRET123/);
  });
  it('signs OVH requests with the documented $1$ sha1 scheme', () => {
    const sig = ovhSignature('AS', 'CK', 'GET', 'https://api.us.ovhcloud.com/1.0/me', '', 1700000000);
    expect(sig).toMatch(/^\$1\$[0-9a-f]{40}$/);
  });
});
