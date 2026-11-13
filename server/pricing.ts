import type { Product, Settings, Term } from './catalog.ts';
import { effectiveDiscount } from './catalog.ts';

/**
 * Server-side price calculation. The client never sends prices; it only sends
 * selections, and every total shown or charged is produced here.
 */

export type Cadence = 'one_time' | 'monthly' | 'annual' | 'yearly';

export interface QuoteLine {
  key: string;
  label: string;
  detail: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
  cadence: Cadence;
}

export interface Quote {
  productCode: string;
  term: Term;
  currency: 'USD';
  lines: QuoteLine[];
  subtotalCents: number;
  taxPct: number;
  taxCents: number;
  dueTodayCents: number;
  recurring: { label: string; amountCents: number; cadence: Cadence }[];
  mailboxCount: number;
  unitCount: number;
  domainCount: number;
  notes: string[];
  computedAt: string;
}

export interface FreshQuoteInput {
  term: Term;
  quantity: number;
  ratio: number;
  newDomains: string[];
  existingDomains?: string[];
}

export interface PrewarmedPick { domain: string; mailboxes: number; tierKey: string }

export const cents = (n: number) => Math.round(n);
export const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

export function unitMonthlyCents(product: Product, term: Term, settings: Settings, base = product.monthlyPriceCents): number {
  if (term === 'monthly') return base;
  return cents(base * (1 - effectiveDiscount(product, settings) / 100));
}

/** Number of billable units (mailboxes, tenants or servers) for a quantity. */
export function unitsFor(product: Product, quantity: number): number {
  if (product.unit === 'tenant') return Math.max(1, Math.ceil(quantity / (product.mailboxesPerUnit || 1)));
  return quantity;
}

/** Domains needed: mailboxes ÷ mailboxes-per-domain, or servers × domains-per-server. */
export function requiredDomains(product: Product, quantity: number, ratio: number): number {
  if (!product.needsDomains) return 0;
  if (product.unit === 'server') return quantity * ratio;
  return Math.ceil(quantity / Math.max(1, ratio));
}

function finish(productCode: string, term: Term, lines: QuoteLine[], settings: Settings, extra: Partial<Quote>): Quote {
  const subtotal = lines.reduce((s, l) => s + l.amountCents, 0);
  const taxPct = Number(settings.tax_pct ?? 0);
  const tax = cents((subtotal * taxPct) / 100);
  return {
    productCode, term, currency: 'USD', lines,
    subtotalCents: subtotal, taxPct, taxCents: tax, dueTodayCents: subtotal + tax,
    recurring: [], mailboxCount: 0, unitCount: 0, domainCount: 0, notes: [],
    computedAt: new Date().toISOString(),
    ...extra,
  };
}

export function quoteFresh(product: Product, input: FreshQuoteInput, settings: Settings): Quote {
  const { term } = input;
  const qty = input.quantity;
  const units = unitsFor(product, qty);
  const perUnitMonth = unitMonthlyCents(product, term, settings);
  const unitWord = product.unit === 'mailbox' ? 'mailbox' : product.unit === 'tenant' ? 'tenant' : 'server';
  const lines: QuoteLine[] = [];
  const recurring: Quote['recurring'] = [];

  if (term === 'monthly') {
    lines.push({ key: 'service', label: `${product.name} (first month)`, detail: `${units} ${unitWord}${units === 1 ? '' : 's'} × ${fmt(perUnitMonth)} / month`, quantity: units, unitCents: perUnitMonth, amountCents: units * perUnitMonth, cadence: 'monthly' });
    recurring.push({ label: `${product.name}, billed monthly`, amountCents: units * perUnitMonth, cadence: 'monthly' });
  } else {
    const perUnitYear = perUnitMonth * 12;
    lines.push({ key: 'service', label: `${product.name} (12 months, ${effectiveDiscount(product, settings)}% off)`, detail: `${units} ${unitWord}${units === 1 ? '' : 's'} × ${fmt(perUnitMonth)} / month × 12`, quantity: units, unitCents: perUnitYear, amountCents: units * perUnitYear, cadence: 'annual' });
    recurring.push({ label: `${product.name}, billed annually`, amountCents: units * perUnitYear, cadence: 'annual' });
  }

  if (product.setupFeeCents > 0) {
    lines.push({ key: 'setup', label: 'One-time setup', detail: `${units} × ${fmt(product.setupFeeCents)}`, quantity: units, unitCents: product.setupFeeCents, amountCents: units * product.setupFeeCents, cadence: 'one_time' });
  }

  const nNew = input.newDomains.length;
  if (nNew > 0) {
    const dp = Number(settings.domain_price_cents);
    lines.push({ key: 'domains', label: 'New .com domains (1 year)', detail: `${nNew} domain${nNew === 1 ? '' : 's'} × ${fmt(dp)} / year`, quantity: nNew, unitCents: dp, amountCents: nNew * dp, cadence: 'yearly' });
    recurring.push({ label: 'Domain renewals, billed yearly', amountCents: nNew * Number(settings.domain_renewal_cents), cadence: 'yearly' });
  }

  const mailboxCount = product.unit === 'server' ? 0 : qty;
  const notes: string[] = [];
  if (term === 'monthly') notes.push(`After today you pay ${fmt(units * perUnitMonth)} each month for ${product.name}.`);
  else notes.push(`After today, ${product.name} renews at ${fmt(units * perUnitMonth * 12)} once a year.`);
  if (nNew > 0) notes.push(`Domains renew yearly at ${fmt(Number(settings.domain_renewal_cents))} each.`);
  if (product.unit === 'tenant') notes.push(`${qty} mailboxes need ${units} tenant${units === 1 ? '' : 's'} (up to ${product.mailboxesPerUnit} mailboxes each).`);

  const q = finish(product.code, term, lines, settings, {
    recurring, mailboxCount, unitCount: units, domainCount: nNew + (input.existingDomains?.length ?? 0), notes,
  });
  if (q.taxCents > 0) q.recurring.forEach((r) => (r.amountCents = r.amountCents + cents((r.amountCents * q.taxPct) / 100)));
  return q;
}

export function quotePrewarmed(product: Product, picks: PrewarmedPick[], term: Term, settings: Settings): Quote {
  const tiers = product.priceTiers ?? [];
  const lines: QuoteLine[] = [];
  let monthlyTotal = 0;
  let mailboxes = 0;
  const byTier = new Map<string, number>();
  for (const p of picks) byTier.set(p.tierKey, (byTier.get(p.tierKey) ?? 0) + p.mailboxes);
  for (const [tierKey, count] of byTier) {
    const tier = tiers.find((t) => t.key === tierKey);
    if (!tier) throw new Error(`Unknown warmup tier ${tierKey}`);
    const perMonth = unitMonthlyCents(product, term, settings, tier.monthly_price_cents);
    const amount = term === 'monthly' ? count * perMonth : count * perMonth * 12;
    monthlyTotal += count * perMonth;
    mailboxes += count;
    lines.push({
      key: `mailboxes_${tierKey}`,
      label: `${product.name}, ${tier.label}${term === 'annual' ? ' (12 months)' : ' (first month)'}`,
      detail: `${count} mailbox${count === 1 ? '' : 'es'} × ${fmt(perMonth)} / month${term === 'annual' ? ' × 12' : ''}`,
      quantity: count, unitCents: term === 'monthly' ? perMonth : perMonth * 12, amountCents: amount, cadence: term === 'monthly' ? 'monthly' : 'annual',
    });
  }
  const fee = Number(settings.prewarmed_domain_fee_cents ?? 0);
  if (picks.length && fee > 0) {
    lines.push({ key: 'prewarmed_domains', label: 'Pre-warmed domains (1 year)', detail: `${picks.length} × ${fmt(fee)} / year`, quantity: picks.length, unitCents: fee, amountCents: picks.length * fee, cadence: 'yearly' });
  }
  const recurring: Quote['recurring'] = [
    { label: `${product.name}, billed ${term === 'monthly' ? 'monthly' : 'annually'}`, amountCents: term === 'monthly' ? monthlyTotal : monthlyTotal * 12, cadence: term === 'monthly' ? 'monthly' : 'annual' },
  ];
  if (picks.length && fee > 0) recurring.push({ label: 'Domain renewals, billed yearly', amountCents: picks.length * fee, cadence: 'yearly' });
  return finish(product.code, term, lines, settings, {
    recurring, mailboxCount: mailboxes, unitCount: mailboxes, domainCount: picks.length,
    notes: [term === 'monthly' ? `After today you pay ${fmt(monthlyTotal)} each month.` : `Renews at ${fmt(monthlyTotal * 12)} once a year.`],
  });
}
