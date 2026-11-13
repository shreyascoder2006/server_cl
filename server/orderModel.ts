import { z } from 'zod';
import type { Product, Settings } from './catalog.ts';
import { isValidComDomain } from './domains.ts';
import { requiredDomains } from './pricing.ts';

/** Order lifecycle. Moves only on confirmed events (payment webhook, provider responses). */
export const ORDER_STATUSES = ['draft', 'awaiting_payment', 'payment_authorized', 'submitting', 'provider_pending', 'submitted', 'needs_review', 'failed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['awaiting_payment', 'cancelled'],
  awaiting_payment: ['draft', 'payment_authorized', 'cancelled'],
  payment_authorized: ['submitting', 'needs_review'],
  submitting: ['provider_pending', 'submitted', 'failed', 'needs_review'],
  provider_pending: ['submitted', 'failed', 'needs_review'],
  failed: ['submitting', 'cancelled'],
  needs_review: ['submitting', 'submitted', 'failed', 'cancelled'],
  submitted: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export const FRESH_STEPS = ['product', 'setup', 'domains', 'personas', 'dns', 'contact', 'review'] as const;
export const PREWARMED_STEPS = ['browse', 'contact', 'review'] as const;

const name = z.string().trim().min(1, 'Required').max(40).regex(/^[\p{L}][\p{L} .'-]*$/u, 'Letters only');

export const ContactSchema = z.object({
  firstName: name,
  lastName: name,
  company: z.string().trim().max(80).optional().default(''),
  email: z.string().trim().email('Enter a valid email'),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number with country code'),
  address1: z.string().trim().min(3, 'Required').max(120),
  address2: z.string().trim().max(120).optional().default(''),
  city: z.string().trim().min(2, 'Required').max(60),
  state: z.string().trim().min(2, 'Required').max(60),
  postalCode: z.string().trim().min(3, 'Required').max(12),
  country: z.string().trim().length(2, 'Use a 2-letter country code').transform((s) => s.toUpperCase()),
});

export const PersonaSchema = z.object({
  id: z.string().min(1).max(40),
  firstName: name,
  lastName: name,
  domains: z.union([z.literal('all'), z.array(z.string())]),
});

export const ADDRESS_PATTERNS = ['first', 'first.last', 'firstlast', 'flast', 'first_last'] as const;

export const FreshConfigSchema = z.object({
  productCode: z.string().optional(),
  term: z.enum(['monthly', 'annual']).optional(),
  quantity: z.number().int().positive().optional(),
  ratio: z.number().int().positive().optional(),
  primaryDomain: z.string().trim().max(120).optional(),
  domains: z.array(z.string().toLowerCase()).max(500).optional(),
  personas: z.array(PersonaSchema).max(200).optional(),
  addressPattern: z.enum(ADDRESS_PATTERNS).optional(),
  forwardingUrl: z.string().trim().max(200).optional(),
  autoDns: z.boolean().optional(),
  contact: ContactSchema.partial().optional(),
  acceptedTerms: z.boolean().optional(),
}).strict();
export type FreshConfig = z.infer<typeof FreshConfigSchema>;

export const PrewarmedPickSchema = z.object({ domain: z.string().toLowerCase(), platform: z.enum(['google', 'microsoft']), tierKey: z.string(), mailboxes: z.number().int().positive().max(10) });
export const PrewarmedConfigSchema = z.object({
  term: z.enum(['monthly', 'annual']).optional(),
  picks: z.array(PrewarmedPickSchema).max(200).optional(),
  forwardingUrl: z.string().trim().max(200).optional(),
  contact: ContactSchema.partial().optional(),
  acceptedTerms: z.boolean().optional(),
}).strict();
export type PrewarmedConfig = z.infer<typeof PrewarmedConfigSchema>;

export interface GeneratedMailbox { address: string; username: string; firstName: string; lastName: string; domain: string; personaId: string }

const slug = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

function usernameFor(pattern: string, first: string, last: string): string[] {
  const f = slug(first);
  const l = slug(last);
  const all: Record<string, string> = { first: f, 'first.last': `${f}.${l}`, firstlast: `${f}${l}`, flast: `${f[0] ?? ''}${l}`, first_last: `${f}_${l}` };
  // Preferred pattern first, then alternatives for collisions.
  return [all[pattern] ?? all['first.last'], all['first.last'], all.firstlast, all.flast, all.first_last, all.first].filter((u, i, a) => u && a.indexOf(u) === i);
}

/** Expands personas × assigned domains into concrete mailbox addresses (unique per domain). */
export function generateMailboxes(cfg: FreshConfig): GeneratedMailbox[] {
  const domains = cfg.domains ?? [];
  const pattern = cfg.addressPattern ?? 'first.last';
  const out: GeneratedMailbox[] = [];
  const used = new Set<string>();
  for (const p of cfg.personas ?? []) {
    const targets = p.domains === 'all' ? domains : p.domains.filter((d) => domains.includes(d));
    for (const domain of targets) {
      const candidates = usernameFor(pattern, p.firstName, p.lastName);
      let username = candidates.find((u) => !used.has(`${u}@${domain}`));
      for (let n = 2; !username; n++) if (!used.has(`${candidates[0]}${n}@${domain}`)) username = `${candidates[0]}${n}`;
      used.add(`${username}@${domain}`);
      out.push({ address: `${username}@${domain}`, username, firstName: p.firstName, lastName: p.lastName, domain, personaId: p.id });
    }
  }
  return out;
}

export interface StepIssue { step: string; field: string; message: string }

/** Validates a fresh order up to and including `upTo` step. Returns every issue found. */
export function validateFresh(cfg: FreshConfig, product: Product | null, settings: Settings, upTo: (typeof FRESH_STEPS)[number] = 'review'): StepIssue[] {
  const issues: StepIssue[] = [];
  const order = FRESH_STEPS;
  const reach = (s: (typeof FRESH_STEPS)[number]) => order.indexOf(s) <= order.indexOf(upTo);
  if (!product) { issues.push({ step: 'product', field: 'productCode', message: 'Choose a product.' }); return issues; }

  if (reach('setup')) {
    if (!cfg.term || !product.billingTerms.includes(cfg.term)) issues.push({ step: 'setup', field: 'term', message: 'Choose monthly or annual billing.' });
    const q = cfg.quantity ?? 0;
    if (q < product.minQty || q > product.maxQty) issues.push({ step: 'setup', field: 'quantity', message: `Quantity must be between ${product.minQty} and ${product.maxQty}.` });
    if (!cfg.ratio || !product.allowedRatios.includes(cfg.ratio)) issues.push({ step: 'setup', field: 'ratio', message: 'Choose a supported ratio.' });
  }
  const need = cfg.quantity && cfg.ratio ? requiredDomains(product, cfg.quantity, cfg.ratio) : 0;
  const domains = cfg.domains ?? [];

  if (reach('domains') && product.needsDomains) {
    const max = Number(settings.max_domains_per_order ?? 100);
    if (need > max) issues.push({ step: 'setup', field: 'quantity', message: `This needs ${need} domains; the maximum per order is ${max}. Choose a higher ratio or a smaller quantity.` });
    if (domains.length !== need) issues.push({ step: 'domains', field: 'domains', message: `Select exactly ${need} domain${need === 1 ? '' : 's'} (you have ${domains.length}).` });
    if (new Set(domains).size !== domains.length) issues.push({ step: 'domains', field: 'domains', message: 'Each domain can only be selected once.' });
    for (const d of domains) if (!isValidComDomain(d)) issues.push({ step: 'domains', field: 'domains', message: `${d} is not a valid .com domain.` });
    if (cfg.primaryDomain && domains.includes(cfg.primaryDomain.toLowerCase())) issues.push({ step: 'domains', field: 'domains', message: 'Do not use your primary domain for cold email.' });
  }

  if (reach('personas') && product.needsPersonas) {
    const personas = cfg.personas ?? [];
    if (!personas.length) issues.push({ step: 'personas', field: 'personas', message: 'Add at least one sender.' });
    for (const p of personas) {
      if (p.domains !== 'all' && p.domains.length === 0) issues.push({ step: 'personas', field: `persona.${p.id}`, message: `${p.firstName || 'A sender'} is not assigned to any domain.` });
      if (p.domains !== 'all') for (const d of p.domains) if (!domains.includes(d)) issues.push({ step: 'personas', field: `persona.${p.id}`, message: `${d} is not one of your selected domains.` });
    }
    const boxes = generateMailboxes(cfg);
    if (boxes.length !== cfg.quantity) issues.push({ step: 'personas', field: 'personas', message: `Your senders create ${boxes.length} mailboxes, but you are buying ${cfg.quantity}. Adjust senders or domain assignments.` });
    const perDomain = new Map<string, number>();
    for (const b of boxes) perDomain.set(b.domain, (perDomain.get(b.domain) ?? 0) + 1);
    for (const [d, n] of perDomain) if (cfg.ratio && n > cfg.ratio) issues.push({ step: 'personas', field: 'personas', message: `${d} would have ${n} mailboxes; the limit is ${cfg.ratio} per domain.` });
    for (const d of domains) if (!perDomain.has(d)) issues.push({ step: 'personas', field: 'personas', message: `${d} has no mailboxes. Assign a sender to it.` });
  }

  if (reach('dns')) {
    if (cfg.forwardingUrl && !/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(cfg.forwardingUrl)) issues.push({ step: 'dns', field: 'forwardingUrl', message: 'Enter a valid website, e.g. yourcompany.com' });
  }

  if (reach('contact') && product.needsDomains) {
    const r = ContactSchema.safeParse(cfg.contact ?? {});
    if (!r.success) for (const e of r.error.issues) issues.push({ step: 'contact', field: `contact.${e.path.join('.')}`, message: e.message });
  }

  if (reach('review') && upTo === 'review' && !cfg.acceptedTerms) issues.push({ step: 'review', field: 'acceptedTerms', message: 'Please accept the purchase terms.' });
  return issues;
}

export function validatePrewarmed(cfg: PrewarmedConfig, upTo: (typeof PREWARMED_STEPS)[number] = 'review'): StepIssue[] {
  const issues: StepIssue[] = [];
  const picks = cfg.picks ?? [];
  if (!picks.length) issues.push({ step: 'browse', field: 'picks', message: 'Select at least one pre-warmed domain.' });
  if (new Set(picks.map((p) => p.domain)).size !== picks.length) issues.push({ step: 'browse', field: 'picks', message: 'A domain is in your cart twice.' });
  if (!cfg.term) issues.push({ step: 'browse', field: 'term', message: 'Choose monthly or annual billing.' });
  if (upTo === 'browse') return issues;
  if (!cfg.forwardingUrl) issues.push({ step: 'contact', field: 'forwardingUrl', message: 'Enter the website your new domains should forward to.' });
  const r = ContactSchema.safeParse(cfg.contact ?? {});
  if (!r.success) for (const e of r.error.issues) issues.push({ step: 'contact', field: `contact.${e.path.join('.')}`, message: e.message });
  if (upTo === 'review' && !cfg.acceptedTerms) issues.push({ step: 'review', field: 'acceptedTerms', message: 'Please accept the purchase terms.' });
  return issues;
}
