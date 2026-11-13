import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.ts';
import { getSettings, listProducts, getProduct } from '../catalog.ts';
import { config } from '../config.ts';
import { audit, getDb, json } from '../db.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { fulfilOrder } from '../fulfillment.ts';
import { loadOrder, publicOrder } from '../orders.ts';
import { gateway } from '../payments.ts';
import { healthFor, modeFor } from '../providers/registry.ts';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const money = z.number().int().min(0).max(10_000_000);
const ProductPatch = z.object({
  name: z.string().trim().min(2).max(80),
  tagline: z.string().trim().max(160),
  description: z.string().trim().max(600),
  features: z.array(z.string().trim().min(1).max(100)).max(10),
  provider_id: z.string(),
  enabled: z.boolean(),
  featured: z.boolean(),
  badge: z.string().trim().max(30).nullable(),
  mailboxes_per_unit: z.number().int().positive().max(1000).nullable(),
  monthly_price_cents: money,
  annual_discount_pct: z.number().min(0).max(90).nullable(),
  setup_fee_cents: money,
  cost_cents: money.nullable(),
  billing_terms: z.array(z.enum(['monthly', 'annual'])).min(1),
  min_qty: z.number().int().min(1),
  max_qty: z.number().int().min(1).max(100000),
  qty_presets: z.array(z.number().int().positive()).max(8),
  allowed_ratios: z.array(z.number().int().positive().max(100)).min(1).max(10),
  default_ratio: z.number().int().positive(),
  price_tiers: z.array(z.object({ key: z.string().min(1).max(20), label: z.string().min(1).max(60), monthly_price_cents: money })).max(10).nullable(),
  sort_order: z.number().int(),
}).partial().strict();

const JSON_COLS = new Set(['features', 'billing_terms', 'qty_presets', 'allowed_ratios', 'price_tiers']);
const BOOL_COLS = new Set(['enabled', 'featured']);

adminRouter.get('/products', (_req, res) => {
  const db = getDb();
  res.json({ products: listProducts(db, { includeDisabled: true }), providers: db.prepare('SELECT id, name, enabled FROM providers ORDER BY id').all(), settings: getSettings(db) });
});

adminRouter.patch('/products/:code', (req, res) => {
  const db = getDb();
  const before = getProduct(db, String(req.params.code), { includeDisabled: true });
  if (!before) throw notFound('Product');
  const parsed = ProductPatch.safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid product settings.', parsed.error.issues);
  const p = parsed.data;
  const ratios = p.allowed_ratios ?? before.allowedRatios;
  const def = p.default_ratio ?? before.defaultRatio;
  if (!ratios.includes(def)) throw badRequest('Default ratio must be one of the allowed ratios.');
  if ((p.min_qty ?? before.minQty) > (p.max_qty ?? before.maxQty)) throw badRequest('Minimum quantity cannot exceed maximum.');
  if (p.provider_id && !db.prepare('SELECT 1 FROM providers WHERE id = ?').get(p.provider_id)) throw badRequest('Unknown provider.');
  if (before.category === 'prewarmed' && p.price_tiers === null) throw badRequest('Pre-warmed products need at least one warmup tier.');
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(p)) {
    sets.push(`${k} = ?`);
    vals.push(JSON_COLS.has(k) ? (v === null ? null : JSON.stringify(v)) : BOOL_COLS.has(k) ? (v ? 1 : 0) : v);
  }
  if (!sets.length) return res.json({ product: before });
  db.prepare(`UPDATE products SET ${sets.join(', ')}, updated_at = datetime('now') WHERE code = ?`).run(...vals, String(req.params.code));
  const after = getProduct(db, String(req.params.code), { includeDisabled: true });
  audit(db, req.user!.id, 'product', String(req.params.code), 'update', before, after);
  res.json({ product: after });
});

adminRouter.get('/settings', (_req, res) => {
  res.json({ settings: getDb().prepare('SELECT key, value, label, kind FROM settings ORDER BY key').all().map((r: any) => ({ ...r, value: json.parse(r.value, null) })) });
});

adminRouter.patch('/settings', (req, res) => {
  const db = getDb();
  const body = z.record(z.string(), z.number().min(0).max(10_000_000)).safeParse(req.body);
  if (!body.success) throw badRequest('Settings must be numbers.');
  const before = getSettings(db);
  for (const [k, v] of Object.entries(body.data)) {
    if (!(k in before)) throw badRequest(`Unknown setting ${k}.`);
    if (k.endsWith('_pct') && v > 90) throw badRequest(`${k} looks too high.`);
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(v), k);
  }
  audit(db, req.user!.id, 'settings', 'global', 'update', before, getSettings(db));
  res.json({ settings: getSettings(db) });
});

adminRouter.get('/providers', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM providers ORDER BY id').all() as any[];
  res.json({
    globalMode: config.providerMode,
    paymentGateway: gateway().name,
    providers: rows.map((r) => ({ ...r, enabled: !!r.enabled, modeInfo: modeFor(db, r.id) })),
  });
});

adminRouter.patch('/providers/:id', (req, res) => {
  const db = getDb();
  const before = db.prepare('SELECT * FROM providers WHERE id = ?').get(String(req.params.id));
  if (!before) throw notFound('Provider');
  const p = z.object({ enabled: z.boolean().optional(), mode: z.enum(['mock', 'live']).optional(), notes: z.string().max(500).optional() }).strict().safeParse(req.body);
  if (!p.success) throw badRequest('Invalid provider settings.');
  if (p.data.enabled !== undefined) db.prepare('UPDATE providers SET enabled = ? WHERE id = ?').run(p.data.enabled ? 1 : 0, String(req.params.id));
  if (p.data.mode) db.prepare('UPDATE providers SET mode = ? WHERE id = ?').run(p.data.mode, String(req.params.id));
  if (p.data.notes !== undefined) db.prepare('UPDATE providers SET notes = ? WHERE id = ?').run(p.data.notes, String(req.params.id));
  const after = db.prepare('SELECT * FROM providers WHERE id = ?').get(String(req.params.id));
  audit(db, req.user!.id, 'provider', String(req.params.id), 'update', before, after);
  res.json({ provider: { ...(after as any), modeInfo: modeFor(db, String(req.params.id)) } });
});

adminRouter.post('/providers/:id/health', async (req, res) => {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM providers WHERE id = ?').get(String(req.params.id))) throw notFound('Provider');
  res.json(await healthFor(db, String(req.params.id)));
});

adminRouter.get('/orders', (req, res) => {
  const db = getDb();
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
  const rows = db.prepare(`SELECT o.id, o.status, o.journey, o.product_code, o.total_due_cents, o.created_at, o.updated_at, t.name AS tenant, u.email
    FROM orders o JOIN tenants t ON t.id = o.tenant_id JOIN users u ON u.id = o.user_id
    WHERE (? IS NULL OR o.status = ?) AND NOT (o.status = 'draft' AND o.config = '{}') ORDER BY o.created_at DESC LIMIT 200`).all(status, status);
  res.json({ orders: rows });
});

adminRouter.get('/orders/:id', (req, res) => {
  const db = getDb();
  const order = loadOrder(db, req.user!, String(req.params.id), { asAdmin: true });
  const requests = db.prepare('SELECT * FROM provider_requests WHERE order_id = ? ORDER BY id').all(order.id);
  const payments = db.prepare('SELECT * FROM payments WHERE order_id = ?').all(order.id);
  res.json({ order: publicOrder(db, order, { admin: true }), providerRequests: requests, payments });
});

adminRouter.post('/orders/:id/retry', async (req, res) => {
  const db = getDb();
  const order = loadOrder(db, req.user!, String(req.params.id), { asAdmin: true });
  if (!['failed', 'needs_review'].includes(order.status)) throw conflict('Only failed or needs-review orders can be retried.');
  const unknown = db.prepare("SELECT step_key FROM provider_requests WHERE order_id = ? AND status = 'unknown'").all(order.id) as any[];
  if (unknown.length) throw conflict(`Resolve steps with unknown outcome first: ${unknown.map((u) => u.step_key).join(', ')}.`);
  audit(db, req.user!.id, 'order', order.id, 'retry', { status: order.status }, null);
  await fulfilOrder(db, order.id, req.user!.email);
  res.json({ order: publicOrder(db, loadOrder(db, req.user!, order.id, { asAdmin: true }), { admin: true }) });
});

/** After checking the vendor dashboard manually, an admin records what really happened to an "unknown" step. */
adminRouter.post('/orders/:id/resolve-step', (req, res) => {
  const db = getDb();
  const order = loadOrder(db, req.user!, String(req.params.id), { asAdmin: true });
  const body = z.object({ stepKey: z.string(), outcome: z.enum(['succeeded', 'failed']), externalRef: z.string().max(200).optional() }).safeParse(req.body);
  if (!body.success) throw badRequest('stepKey and outcome are required.');
  const row = db.prepare('SELECT * FROM provider_requests WHERE order_id = ? AND step_key = ?').get(order.id, body.data.stepKey) as any;
  if (!row || row.status !== 'unknown') throw conflict('That step is not waiting for manual resolution.');
  db.prepare("UPDATE provider_requests SET status = ?, external_ref = COALESCE(?, external_ref), error = COALESCE(error, '') || ' | resolved manually', updated_at = datetime('now') WHERE id = ?")
    .run(body.data.outcome, body.data.externalRef ?? null, row.id);
  audit(db, req.user!.id, 'provider_request', String(row.id), `resolve:${body.data.outcome}`, row, null);
  res.json({ order: publicOrder(db, order, { admin: true }) });
});

adminRouter.get('/audit', (_req, res) => {
  res.json({ entries: getDb().prepare('SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200').all() });
});
