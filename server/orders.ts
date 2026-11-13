import crypto from 'node:crypto';
import type { AuthUser } from './auth.ts';
import { getProduct, getSettings, listProducts, type Product, type Settings, type Term } from './catalog.ts';
import { audit, json, tx, type DB } from './db.ts';
import { recheckDomains } from './domains.ts';
import { badRequest, conflict, HttpError, notFound } from './errors.ts';
import { log } from './log.ts';
import {
  canTransition, FreshConfigSchema, generateMailboxes, PrewarmedConfigSchema, validateFresh, validatePrewarmed,
  type FreshConfig, type OrderStatus, type PrewarmedConfig, type StepIssue,
} from './orderModel.ts';
import { gateway, type GatewayEvent } from './payments.ts';
import { quoteFresh, quotePrewarmed, type Quote } from './pricing.ts';
import { prewarmedProvider } from './providers/registry.ts';

export interface OrderRow {
  id: string; tenant_id: string; user_id: string; journey: 'fresh' | 'prewarmed'; status: OrderStatus; product_code: string | null;
  step: string; config: string; quote: string | null; total_due_cents: number | null; currency: string; checkout_key: string | null;
  payment_ref: string | null; created_at: string; updated_at: string;
}

const newId = (p: string) => `${p}_${crypto.randomBytes(9).toString('base64url')}`;

export function transition(db: DB, order: OrderRow, to: OrderStatus, actor: string, note?: string) {
  if (!canTransition(order.status, to)) throw conflict(`Order cannot move from ${order.status} to ${to}.`);
  const r = db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?").run(to, order.id, order.status);
  if (Number(r.changes) !== 1) throw conflict('Order changed in the meantime. Please refresh.');
  db.prepare('INSERT INTO order_events (order_id, from_status, to_status, actor, note) VALUES (?,?,?,?,?)').run(order.id, order.status, to, actor, note ?? null);
  order.status = to;
}

/** Tenant-scoped load. A customer can never load another tenant's order (404, not 403). */
export function loadOrder(db: DB, user: AuthUser, id: string, opts: { asAdmin?: boolean } = {}): OrderRow {
  const row = (opts.asAdmin && user.role === 'admin')
    ? db.prepare('SELECT * FROM orders WHERE id = ?').get(id)
    : db.prepare('SELECT * FROM orders WHERE id = ? AND tenant_id = ?').get(id, user.tenantId);
  if (!row) throw notFound('Order');
  return row as unknown as OrderRow;
}

export function createDraft(db: DB, user: AuthUser, journey: 'fresh' | 'prewarmed', productCode?: string): OrderRow {
  const id = newId('ord');
  let cfg: any = {};
  let step = journey === 'fresh' ? 'product' : 'browse';
  if (journey === 'fresh' && productCode) {
    const product = getProduct(db, productCode);
    if (!product || product.category === 'prewarmed') throw badRequest('Unknown product.');
    cfg = defaultsFor(product);
    step = 'setup';
  }
  if (journey === 'prewarmed') cfg = { term: 'monthly', picks: [] };
  db.prepare('INSERT INTO orders (id, tenant_id, user_id, journey, status, product_code, step, config) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, user.tenantId, user.id, journey, 'draft', productCode ?? null, step, JSON.stringify(cfg));
  db.prepare('INSERT INTO order_events (order_id, from_status, to_status, actor, note) VALUES (?,?,?,?,?)').run(id, null, 'draft', user.email, `Started ${journey} order`);
  return loadOrder(db, user, id);
}

export function defaultsFor(product: Product): FreshConfig {
  const quantity = product.qtyPresets[0] ?? product.minQty;
  return {
    productCode: product.code, term: 'monthly', quantity, ratio: product.defaultRatio, domains: [], personas: [],
    addressPattern: 'first.last', autoDns: true, forwardingUrl: '', acceptedTerms: false,
  };
}

/** Merges a partial config patch into a draft. Changing selections invalidates any held quote. */
export function updateDraft(db: DB, user: AuthUser, id: string, patch: unknown, step?: string): OrderRow {
  const order = loadOrder(db, user, id);
  if (order.status === 'awaiting_payment') transition(db, order, 'draft', user.email, 'Edited after checkout started; quote released');
  if (order.status !== 'draft') throw conflict('Only draft orders can be edited.');
  const current = json.parse<any>(order.config, {});
  let next: any;
  if (order.journey === 'fresh') {
    const parsed = FreshConfigSchema.safeParse(patch);
    if (!parsed.success) throw badRequest('Invalid order details.', parsed.error.issues);
    next = { ...current, ...parsed.data };
    if (parsed.data.productCode && parsed.data.productCode !== current.productCode) {
      const product = getProduct(db, parsed.data.productCode);
      if (!product || product.category === 'prewarmed') throw badRequest('Unknown product.');
      next = { ...defaultsFor(product), primaryDomain: current.primaryDomain, contact: current.contact, forwardingUrl: current.forwardingUrl, ...parsed.data };
    }
  } else {
    const parsed = PrewarmedConfigSchema.safeParse(patch);
    if (!parsed.success) throw badRequest('Invalid order details.', parsed.error.issues);
    next = { ...current, ...parsed.data };
  }
  next.acceptedTerms = (patch as any)?.acceptedTerms === true ? true : (patch as any)?.acceptedTerms === false ? false : current.acceptedTerms && !Object.keys(patch as object).some((k) => k !== 'acceptedTerms');
  db.prepare("UPDATE orders SET config = ?, product_code = ?, step = COALESCE(?, step), quote = NULL, total_due_cents = NULL, checkout_key = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(next), next.productCode ?? order.product_code, step ?? null, id);
  return loadOrder(db, user, id);
}

function prewarmedProducts(db: DB) {
  const all = listProducts(db).filter((p) => p.category === 'prewarmed');
  return { google: all.find((p) => p.platform === 'google') ?? null, microsoft: all.find((p) => p.platform === 'microsoft') ?? null };
}

/** Builds the quote shown to the customer (and charged) from server-side data only. */
export function computeQuote(db: DB, order: OrderRow): { quote: Quote | null; issues: StepIssue[] } {
  const settings = getSettings(db);
  if (order.journey === 'fresh') {
    const cfg = json.parse<FreshConfig>(order.config, {});
    const product = cfg.productCode ? getProduct(db, cfg.productCode) : null;
    const issues = validateFresh(cfg, product, settings, 'setup');
    if (!product || issues.length) return { quote: null, issues };
    const quote = quoteFresh(product, { term: cfg.term as Term, quantity: cfg.quantity!, ratio: cfg.ratio!, newDomains: cfg.domains ?? [] }, settings);
    return { quote, issues: [] };
  }
  const cfg = json.parse<PrewarmedConfig>(order.config, {});
  const issues = validatePrewarmed(cfg, 'browse');
  if (issues.length) return { quote: null, issues };
  return { quote: mergedPrewarmedQuote(db, cfg, settings), issues: [] };
}

function mergedPrewarmedQuote(db: DB, cfg: PrewarmedConfig, settings: Settings): Quote {
  const products = prewarmedProducts(db);
  const quotes: Quote[] = [];
  for (const platform of ['google', 'microsoft'] as const) {
    const picks = (cfg.picks ?? []).filter((p) => p.platform === platform);
    if (!picks.length) continue;
    const product = products[platform];
    if (!product) throw badRequest(`Pre-warmed ${platform} mailboxes are not available right now.`);
    quotes.push(quotePrewarmed(product, picks, cfg.term as Term, settings));
  }
  const lines = quotes.flatMap((q) => q.lines);
  const subtotal = lines.reduce((s, l) => s + l.amountCents, 0);
  const taxPct = Number(settings.tax_pct ?? 0);
  const tax = Math.round((subtotal * taxPct) / 100);
  return {
    productCode: 'prewarmed', term: cfg.term as Term, currency: 'USD', lines, subtotalCents: subtotal, taxPct, taxCents: tax, dueTodayCents: subtotal + tax,
    recurring: quotes.flatMap((q) => q.recurring), mailboxCount: quotes.reduce((s, q) => s + q.mailboxCount, 0), unitCount: quotes.reduce((s, q) => s + q.unitCount, 0),
    domainCount: (cfg.picks ?? []).length, notes: quotes.flatMap((q) => q.notes), computedAt: new Date().toISOString(),
  };
}

export function validateOrder(db: DB, order: OrderRow, upTo?: string): StepIssue[] {
  const settings = getSettings(db);
  if (order.journey === 'fresh') {
    const cfg = json.parse<FreshConfig>(order.config, {});
    const product = cfg.productCode ? getProduct(db, cfg.productCode) : null;
    return validateFresh(cfg, product, settings, (upTo as any) ?? 'review');
  }
  return validatePrewarmed(json.parse<PrewarmedConfig>(order.config, {}), (upTo as any) ?? 'review');
}

/**
 * Starts payment: full validation, live re-check of domains, fresh server quote,
 * then a payment session from the gateway. Idempotent per (order, checkoutKey).
 */
export async function startCheckout(db: DB, user: AuthUser, id: string, checkoutKey: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(checkoutKey)) throw badRequest('Missing or invalid Idempotency-Key header.');
  let order = loadOrder(db, user, id);

  if (order.status === 'awaiting_payment' && order.checkout_key === checkoutKey) {
    const payment = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(order.id) as any;
    return { order: publicOrder(db, order), payment: { gateway: payment.gateway, sessionId: payment.id, amountCents: payment.amount_cents, currency: payment.currency }, replayed: true };
  }
  if (order.status === 'awaiting_payment') { transition(db, order, 'draft', user.email, 'Checkout restarted'); }
  if (order.status !== 'draft') throw conflict(`This order is ${order.status.replace('_', ' ')} and cannot be checked out again.`);

  const issues = validateOrder(db, order);
  if (issues.length) throw new HttpError(422, 'Please fix the highlighted details before paying.', issues, 'VALIDATION');

  // Re-check availability right before payment.
  if (order.journey === 'fresh') {
    const cfg = json.parse<FreshConfig>(order.config, {});
    const check = await recheckDomains(db, cfg.domains ?? []);
    if (!check.ok) throw new HttpError(409, `Some domains were just taken: ${check.unavailable.join(', ')}. Please pick replacements.`, { unavailable: check.unavailable }, 'DOMAINS_UNAVAILABLE');
  } else {
    const cfg = json.parse<PrewarmedConfig>(order.config, {});
    const domains = (cfg.picks ?? []).map((p) => p.domain);
    const avail = await prewarmedProvider(db).checkAvailability(domains);
    const gone = avail.filter((a) => !a.available).map((a) => a.domain);
    const heldElsewhere = db.prepare(`SELECT domain FROM prewarmed_holds WHERE order_id != ? AND expires_at > datetime('now') AND domain IN (${domains.map(() => '?').join(',') || "''"})`).all(order.id, ...domains) as any[];
    const unavailable = [...gone, ...heldElsewhere.map((h) => h.domain)];
    if (unavailable.length) throw new HttpError(409, `Some pre-warmed domains are no longer available: ${unavailable.join(', ')}.`, { unavailable }, 'DOMAINS_UNAVAILABLE');
  }

  const { quote } = computeQuote(db, order);
  if (!quote) throw badRequest('Could not price this order.');
  const holdMinutes = Number(getSettings(db).checkout_hold_minutes ?? 30);

  const session = await gateway().createSession({
    orderId: order.id, tenantId: order.tenant_id, checkoutKey, amountCents: quote.dueTodayCents, currency: quote.currency,
    description: `Cloudlead infrastructure order ${order.id}`, customerEmail: user.email,
    lineItems: quote.lines.map((l) => ({ label: l.label, amountCents: l.amountCents, cadence: l.cadence })),
  });

  tx(db, () => {
    try {
      db.prepare("UPDATE orders SET quote = ?, total_due_cents = ?, checkout_key = ?, step = 'review', updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify({ ...quote, expiresAt: new Date(Date.now() + holdMinutes * 60_000).toISOString() }), quote.dueTodayCents, checkoutKey, order.id);
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) throw conflict('This checkout was already used for another order.');
      throw e;
    }
    db.prepare('INSERT INTO payments (id, order_id, gateway, status, amount_cents, currency) VALUES (?,?,?,?,?,?)')
      .run(session.sessionId, order.id, session.gateway, 'pending', quote.dueTodayCents, quote.currency);
    order = loadOrder(db, user, id);
    transition(db, order, 'awaiting_payment', user.email, `Payment session ${session.sessionId} for $${(quote.dueTodayCents / 100).toFixed(2)}`);
    if (order.journey === 'prewarmed') {
      const cfg = json.parse<PrewarmedConfig>(order.config, {});
      const ins = db.prepare("INSERT INTO prewarmed_holds (domain, order_id, expires_at) VALUES (?,?,datetime('now', ?)) ON CONFLICT(domain) DO UPDATE SET order_id = excluded.order_id, expires_at = excluded.expires_at");
      for (const p of cfg.picks ?? []) ins.run(p.domain, order.id, `+${holdMinutes} minutes`);
    }
  });
  return { order: publicOrder(db, loadOrder(db, user, id)), payment: session, replayed: false };
}

/**
 * Applies a verified gateway event. Idempotent: the same event id is processed once.
 * Returns the order id when fulfilment should start.
 */
export function applyPaymentEvent(db: DB, evt: GatewayEvent): { orderId: string; startFulfilment: boolean } {
  return tx(db, () => {
    const seen = db.prepare('SELECT id FROM webhook_events WHERE id = ?').get(evt.id);
    if (seen) return { orderId: evt.orderId, startFulfilment: false };
    db.prepare('INSERT INTO webhook_events (id, gateway, type) VALUES (?,?,?)').run(evt.id, gateway().name, evt.type);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(evt.orderId) as unknown as OrderRow | undefined;
    if (!order) throw notFound('Order');
    const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND order_id = ?').get(evt.sessionId, order.id) as any;
    if (!payment) throw badRequest('Payment session does not belong to this order.');
    if (evt.type === 'payment.failed') {
      db.prepare("UPDATE payments SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(payment.id);
      db.prepare('INSERT INTO order_events (order_id, from_status, to_status, actor, note) VALUES (?,?,?,?,?)').run(order.id, order.status, order.status, 'payment-gateway', 'Payment failed');
      return { orderId: order.id, startFulfilment: false };
    }
    if (evt.type !== 'payment.authorized') return { orderId: order.id, startFulfilment: false };
    if (order.status !== 'awaiting_payment') {
      log.warn('payment_for_non_waiting_order', { orderId: order.id, status: order.status });
      return { orderId: order.id, startFulfilment: false };
    }
    db.prepare("UPDATE payments SET status = 'authorized', gateway_ref = ?, updated_at = datetime('now') WHERE id = ?").run(evt.gatewayRef, payment.id);
    db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?').run(evt.gatewayRef, order.id);
    if (evt.amountCents !== order.total_due_cents || evt.currency !== order.currency) {
      transition(db, order, 'payment_authorized', 'payment-gateway', `Authorized ${evt.amountCents} ${evt.currency}`);
      transition(db, order, 'needs_review', 'system', `Amount mismatch: expected ${order.total_due_cents} ${order.currency}`);
      return { orderId: order.id, startFulfilment: false };
    }
    transition(db, order, 'payment_authorized', 'payment-gateway', `Payment authorized (${evt.gatewayRef})`);
    return { orderId: order.id, startFulfilment: true };
  });
}

export function cancelOrder(db: DB, user: AuthUser, id: string) {
  const order = loadOrder(db, user, id, { asAdmin: true });
  if (!['draft', 'awaiting_payment'].includes(order.status) && user.role !== 'admin') throw conflict('Paid orders can only be cancelled by Cloudlead support.');
  transition(db, order, 'cancelled', user.email, 'Cancelled');
  db.prepare('DELETE FROM prewarmed_holds WHERE order_id = ?').run(order.id);
  audit(db, user.id, 'order', id, 'cancel', null, null);
  return publicOrder(db, loadOrder(db, user, id, { asAdmin: true }));
}

/** Customer-safe view of an order: no vendor names, no costs, no raw provider payloads. */
export function publicOrder(db: DB, order: OrderRow, opts: { admin?: boolean } = {}) {
  const cfg = json.parse<any>(order.config, {});
  const product = order.product_code ? getProduct(db, order.product_code, { includeDisabled: true }) : null;
  const steps = db.prepare('SELECT step_key, provider, operation, status, error, external_ref, updated_at, mode FROM provider_requests WHERE order_id = ? ORDER BY id').all(order.id) as any[];
  const events = db.prepare('SELECT from_status, to_status, actor, note, created_at FROM order_events WHERE order_id = ? ORDER BY id').all(order.id) as any[];
  return {
    id: order.id,
    journey: order.journey,
    status: order.status,
    step: order.step,
    productCode: order.product_code,
    productName: product?.name ?? (order.journey === 'prewarmed' ? 'Pre-warmed mailboxes' : null),
    config: cfg,
    mailboxes: order.journey === 'fresh' ? generateMailboxes(cfg) : [],
    quote: json.parse(order.quote, null),
    totalDueCents: order.total_due_cents,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    progress: steps.map((s) => ({
      key: s.step_key,
      label: stepLabel(s.step_key),
      status: s.status,
      ...(opts.admin ? { provider: s.provider, operation: s.operation, error: s.error, externalRef: s.external_ref, mode: s.mode } : { error: s.status === 'failed' || s.status === 'unknown' ? 'Our team has been notified and will follow up.' : undefined }),
      updatedAt: s.updated_at,
    })),
    events: opts.admin ? events : events.map(({ actor, ...e }) => ({ ...e, note: customerNote(actor, e.to_status, e.note) })),
  };
}

/** Event notes written by the system can contain vendor details; customers get a plain summary. */
function customerNote(actor: string, to: string, note: string | null): string | null {
  if (actor !== 'system' && actor !== 'payment-gateway') return note;
  const plain: Record<string, string> = {
    payment_authorized: 'Payment received', submitting: 'Setup started', provider_pending: 'All requests accepted; provisioning in progress',
    submitted: 'Setup requests completed', needs_review: 'Setup paused for a manual check by our team', failed: 'Setup hit a problem; our team has been notified',
  };
  return plain[to] ?? note;
}

export function stepLabel(key: string): string {
  const [kind, target] = key.split(':');
  const map: Record<string, string> = {
    register: `Register ${target}`, zone: `Prepare DNS for ${target}`, ns: `Point ${target} to DNS`, dns: `Configure DNS records for ${target}`,
    mailboxes: `Create mailboxes on ${target}`, servers: 'Provision SMTP servers', prewarm: 'Reserve pre-warmed domains and mailboxes',
  };
  return map[kind] ?? key;
}

export function listOrders(db: DB, user: AuthUser) {
  const rows = db.prepare("SELECT * FROM orders WHERE tenant_id = ? AND NOT (status = 'draft' AND config = '{}') ORDER BY created_at DESC LIMIT 100").all(user.tenantId) as unknown as OrderRow[];
  return rows.map((o) => {
    const cfg = json.parse<any>(o.config, {});
    const product = o.product_code ? getProduct(db, o.product_code, { includeDisabled: true }) : null;
    return { id: o.id, journey: o.journey, status: o.status, step: o.step, productName: product?.name ?? (o.journey === 'prewarmed' ? 'Pre-warmed mailboxes' : 'Not chosen yet'),
      quantity: cfg.quantity ?? (cfg.picks ?? []).reduce((s: number, p: any) => s + p.mailboxes, 0), totalDueCents: o.total_due_cents, createdAt: o.created_at, updatedAt: o.updated_at };
  });
}
