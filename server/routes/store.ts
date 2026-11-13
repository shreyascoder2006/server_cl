import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { clearSessionCookie, createSession, destroySession, readSessionToken, requireUser, setSessionCookie, verifyPassword } from '../auth.ts';
import { getProduct, getSettings, listProducts, publicProduct } from '../catalog.ts';
import { config } from '../config.ts';
import { getDb, json } from '../db.ts';
import { searchDomains } from '../domains.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import { fulfilOrder } from '../fulfillment.ts';
import { log } from '../log.ts';
import {
  applyPaymentEvent, cancelOrder, computeQuote, createDraft, listOrders, loadOrder, publicOrder, startCheckout, updateDraft, validateOrder,
} from '../orders.ts';
import { gateway, mockGateway, signMockWebhook } from '../payments.ts';
import { unitMonthlyCents } from '../pricing.ts';
import { modeFor, prewarmedProvider } from '../providers/registry.ts';

export const storeRouter = Router();

/* ---------------- auth ---------------- */

const loginAttempts = new Map<string, { n: number; until: number }>();
storeRouter.post('/auth/login', (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!body.success) throw badRequest('Enter your email and password.');
  const key = body.data.email.toLowerCase();
  const att = loginAttempts.get(key);
  if (att && att.n >= 5 && att.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in a minute.');
  const user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(key) as any;
  if (!user || !verifyPassword(body.data.password, user.password_hash)) {
    loginAttempts.set(key, { n: (att?.n ?? 0) + 1, until: Date.now() + 60_000 });
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  loginAttempts.delete(key);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id } });
});

storeRouter.post('/auth/logout', (req, res) => {
  const t = readSessionToken(req);
  if (t) destroySession(t);
  clearSessionCookie(res);
  res.json({ ok: true });
});

storeRouter.get('/auth/me', (req, res) => {
  res.json({ user: req.user ?? null, demoAccounts: config.isTest || process.env.NODE_ENV !== 'production' });
});

/* ---------------- catalogue ---------------- */

storeRouter.get('/catalog', requireUser, (_req, res) => {
  const db = getDb();
  const settings = getSettings(db);
  const anyLive = ['namesilo', 'mailpool', 'inboxkit', 'cloudflare', 'ovh'].some((p) => modeFor(db, p).effective === 'live');
  res.json({
    products: listProducts(db).map((p) => publicProduct(p, settings)),
    pricing: {
      annualDiscountPct: settings.annual_discount_pct, domainPriceCents: settings.domain_price_cents, domainRenewalCents: settings.domain_renewal_cents,
      prewarmedDomainFeeCents: settings.prewarmed_domain_fee_cents, taxPct: settings.tax_pct, maxDomainsPerOrder: settings.max_domains_per_order,
    },
    environment: { mode: anyLive ? 'live' : 'mock', paymentGateway: gateway().name },
  });
});

/* ---------------- domain search (rate limited) ---------------- */

const searchHits = new Map<string, number[]>();
function rateLimit(req: Request, max: number, windowMs: number) {
  const key = req.user!.id;
  const now = Date.now();
  const hits = (searchHits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) throw new HttpError(429, 'You are searching very quickly. Please wait a few seconds.');
  hits.push(now);
  searchHits.set(key, hits);
}

storeRouter.post('/domains/search', requireUser, async (req, res) => {
  rateLimit(req, 30, 60_000);
  const body = z.object({ query: z.string().trim().min(2).max(60), offset: z.number().int().min(0).max(1000).optional(), exclude: z.array(z.string()).max(500).optional(), primaryDomain: z.string().max(120).optional(), limit: z.number().int().min(1).max(40).optional() }).safeParse(req.body);
  if (!body.success) throw badRequest('Type at least 2 characters to search.');
  res.json(await searchDomains(getDb(), body.data.query, body.data));
});

/* ---------------- pre-warmed inventory ---------------- */

storeRouter.get('/prewarmed', requireUser, async (req, res) => {
  const db = getDb();
  const settings = getSettings(db);
  const platform = typeof req.query.platform === 'string' && req.query.platform ? req.query.platform : undefined;
  const tierKey = typeof req.query.tier === 'string' && req.query.tier ? req.query.tier : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 60) : undefined;
  const products = listProducts(db).filter((p) => p.category === 'prewarmed');
  const listings = await prewarmedProvider(db).search({ platform, tierKey, q });
  const held = new Set((db.prepare("SELECT domain FROM prewarmed_holds WHERE expires_at > datetime('now')").all() as any[]).map((r) => r.domain));
  const items = listings.flatMap((l) => {
    const product = products.find((p) => p.platform === l.platform);
    const tier = product?.priceTiers?.find((t) => t.key === l.tierKey);
    if (!product || !tier || held.has(l.domain)) return [];
    return [{ ...l, tierLabel: tier.label, monthlyPerMailboxCents: tier.monthly_price_cents, annualPerMailboxMonthlyCents: unitMonthlyCents(product, 'annual', settings, tier.monthly_price_cents), domainFeeCents: settings.prewarmed_domain_fee_cents }];
  });
  res.json({ items, tiers: products[0]?.priceTiers ?? [], platforms: products.map((p) => ({ platform: p.platform, name: p.name })) });
});

/* ---------------- orders ---------------- */

storeRouter.get('/orders', requireUser, (req, res) => res.json({ orders: listOrders(getDb(), req.user!) }));

storeRouter.post('/orders', requireUser, (req, res) => {
  const body = z.object({ journey: z.enum(['fresh', 'prewarmed']), productCode: z.string().optional() }).safeParse(req.body);
  if (!body.success) throw badRequest('Choose what you want to buy.');
  const order = createDraft(getDb(), req.user!, body.data.journey, body.data.productCode);
  res.status(201).json({ order: publicOrder(getDb(), order) });
});

storeRouter.get('/orders/:id', requireUser, (req, res) => {
  const db = getDb();
  const order = loadOrder(db, req.user!, String(req.params.id));
  const { quote, issues } = order.status === 'draft' ? computeQuote(db, order) : { quote: null, issues: [] };
  res.json({ order: publicOrder(db, order), preview: quote, issues });
});

storeRouter.patch('/orders/:id', requireUser, (req, res) => {
  const db = getDb();
  const body = z.object({ config: z.record(z.string(), z.unknown()).default({}), step: z.string().max(20).optional() }).safeParse(req.body);
  if (!body.success) throw badRequest('Invalid update.');
  const order = updateDraft(db, req.user!, String(req.params.id), body.data.config, body.data.step);
  const { quote } = computeQuote(db, order);
  res.json({ order: publicOrder(db, order), preview: quote });
});

storeRouter.post('/orders/:id/validate', requireUser, (req, res) => {
  const db = getDb();
  const order = loadOrder(db, req.user!, String(req.params.id));
  const step = typeof req.body?.step === 'string' ? req.body.step : undefined;
  res.json({ issues: validateOrder(db, order, step) });
});

storeRouter.post('/orders/:id/checkout', requireUser, async (req, res) => {
  const key = String(req.headers['idempotency-key'] ?? '');
  const result = await startCheckout(getDb(), req.user!, String(req.params.id), key);
  res.json(result);
});

storeRouter.post('/orders/:id/cancel', requireUser, (req, res) => {
  res.json({ order: cancelOrder(getDb(), req.user!, String(req.params.id)) });
});

/* ---------------- payments ---------------- */

/** Gateway webhook. Body must be raw for signature verification (see app.ts). */
storeRouter.post('/payments/webhook', async (req, res) => {
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  let evt;
  try { evt = gateway().parseWebhook(raw, req.headers); } catch (e: any) {
    log.warn('webhook_rejected', { error: e.message });
    throw new HttpError(400, 'Invalid webhook.');
  }
  const db = getDb();
  const { orderId, startFulfilment } = applyPaymentEvent(db, evt);
  res.json({ received: true });
  if (startFulfilment) setImmediate(() => fulfilOrder(db, orderId).catch((e) => log.error('fulfilment_crash', { orderId, error: e.message })));
});

/**
 * LOCAL DEVELOPMENT ONLY: pretends the customer completed payment by sending a
 * correctly signed mock webhook. Disabled when the Stripe gateway is active.
 */
storeRouter.post('/dev/simulate-payment/:id', requireUser, async (req, res) => {
  if (gateway().name !== 'mock') throw notFound('Route');
  const db = getDb();
  const order = loadOrder(db, req.user!, String(req.params.id));
  if (order.status !== 'awaiting_payment') throw badRequest('Start checkout first.');
  const payment = db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(order.id) as any;
  if (!payment) throw badRequest('No pending payment session.');
  const outcome = req.body?.outcome === 'fail' ? 'payment.failed' : 'payment.authorized';
  const { body, signature } = signMockWebhook({ id: `evt_${crypto.randomBytes(8).toString('hex')}`, type: outcome, orderId: order.id, sessionId: payment.id, amountCents: payment.amount_cents, currency: payment.currency, gatewayRef: `mock_pi_${crypto.randomBytes(6).toString('hex')}` });
  const evt = mockGateway.parseWebhook(Buffer.from(body), { 'x-mock-signature': signature });
  const { startFulfilment } = applyPaymentEvent(db, evt);
  if (startFulfilment) await fulfilOrder(db, order.id).catch((e) => log.error('fulfilment_crash', { orderId: order.id, error: e.message }));
  res.json({ order: publicOrder(db, loadOrder(db, req.user!, order.id)) });
});

/* ---------------- misc ---------------- */

storeRouter.get('/products/:code', requireUser, (req, res) => {
  const db = getDb();
  const p = getProduct(db, String(req.params.code));
  if (!p) throw notFound('Product');
  res.json({ product: publicProduct(p, getSettings(db)) });
});

export const _internals = { json };
