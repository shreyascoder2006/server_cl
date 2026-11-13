import { getProduct } from './catalog.ts';
import { json, type DB } from './db.ts';
import { log, redact } from './log.ts';
import { generateMailboxes, type FreshConfig, type PrewarmedConfig } from './orderModel.ts';
import { transition, type OrderRow } from './orders.ts';
import { dns, mailboxProvider, modeFor, prewarmedProvider, registrar, serverProvider } from './providers/registry.ts';
import { OutcomeUnknownError, type Contact } from './providers/types.ts';

/**
 * Submits a paid order to vendors, one recorded step at a time.
 *
 * - Runs only for orders in payment_authorized (or failed/needs_review when an
 *   admin retries).
 * - Each step is stored in provider_requests with a unique (order, step) key.
 *   Steps that already succeeded are skipped on retry, so a retry never buys
 *   the same domain or mailbox twice.
 * - A step whose outcome is unknown (timeout after sending a purchase) stops the
 *   run and moves the order to needs_review. It is never retried automatically.
 * - Order status only advances on confirmed provider responses.
 */

interface StepDef { key: string; provider: string; operation: string; run: () => Promise<{ ref?: string; pending?: boolean; request?: unknown; response?: unknown }> }

function stepRow(db: DB, orderId: string, key: string) {
  return db.prepare('SELECT * FROM provider_requests WHERE order_id = ? AND step_key = ?').get(orderId, key) as any;
}

export async function fulfilOrder(db: DB, orderId: string, actor = 'system'): Promise<OrderRow> {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as unknown as OrderRow;
  if (!order) throw new Error('Order not found');
  if (!['payment_authorized', 'failed', 'needs_review'].includes(order.status)) {
    throw new Error(`Order ${orderId} is ${order.status}; only paid orders can be submitted.`);
  }
  const blocked = db.prepare("SELECT step_key FROM provider_requests WHERE order_id = ? AND status = 'unknown'").all(orderId) as any[];
  if (blocked.length && actor === 'system') throw new Error('Order has steps with unknown outcome; an admin must resolve them first.');

  transition(db, order, 'submitting', actor, 'Submitting to providers');
  const steps = order.journey === 'fresh' ? freshSteps(db, order) : prewarmedSteps(db, order);
  let anyPending = false;

  for (const step of steps) {
    const existing = stepRow(db, order.id, step.key);
    if (existing?.status === 'succeeded') { if (existing.response && json.parse<any>(existing.response, {})?.pending) anyPending = true; continue; }
    const mode = modeFor(db, step.provider).effective;
    if (!existing) {
      db.prepare('INSERT INTO provider_requests (order_id, step_key, provider, operation, mode, status) VALUES (?,?,?,?,?,?)').run(order.id, step.key, step.provider, step.operation, mode, 'pending');
    } else {
      db.prepare("UPDATE provider_requests SET status = 'pending', mode = ?, error = NULL, updated_at = datetime('now') WHERE id = ?").run(mode, existing.id);
    }
    db.prepare('UPDATE provider_requests SET attempts = attempts + 1 WHERE order_id = ? AND step_key = ?').run(order.id, step.key);
    try {
      const res = await step.run();
      if (res.pending) anyPending = true;
      db.prepare("UPDATE provider_requests SET status = 'succeeded', external_ref = ?, request = ?, response = ?, updated_at = datetime('now') WHERE order_id = ? AND step_key = ?")
        .run(res.ref ?? null, JSON.stringify(redact(res.request ?? null)), JSON.stringify(redact({ ...(res.response as object ?? {}), pending: !!res.pending })), order.id, step.key);
    } catch (e: any) {
      const unknown = e instanceof OutcomeUnknownError;
      db.prepare("UPDATE provider_requests SET status = ?, error = ?, updated_at = datetime('now') WHERE order_id = ? AND step_key = ?")
        .run(unknown ? 'unknown' : 'failed', String(redact(e.message)), order.id, step.key);
      log.error('fulfilment_step_failed', { orderId: order.id, step: step.key, error: e.message, code: e.code });
      transition(db, order, unknown ? 'needs_review' : 'failed', 'system', `${step.key}: ${redact(e.message)}`);
      return order;
    }
  }
  transition(db, order, anyPending ? 'provider_pending' : 'submitted', 'system', anyPending ? 'All requests accepted; waiting for providers to finish provisioning' : 'All provider requests completed');
  return order;
}

function freshSteps(db: DB, order: OrderRow): StepDef[] {
  const cfg = json.parse<FreshConfig>(order.config, {});
  const product = getProduct(db, cfg.productCode!, { includeDisabled: true });
  if (!product) throw new Error('Product missing');
  const contact = cfg.contact as Contact;
  const steps: StepDef[] = [];
  const reg = registrar(db);
  const dnsP = dns(db);
  const zones = new Map<string, string>();

  for (const domain of cfg.domains ?? []) {
    steps.push({
      key: `register:${domain}`, provider: 'namesilo', operation: 'registerDomain',
      run: async () => {
        const r = await reg.registerDomain({ domain, years: 1, contact, idempotencyKey: `${order.id}:${domain}` });
        return { ref: r.externalRef, request: { domain, years: 1 }, response: r };
      },
    });
    if (cfg.autoDns !== false) {
      steps.push({
        key: `zone:${domain}`, provider: 'cloudflare', operation: 'ensureZone',
        run: async () => { const z = await dnsP.ensureZone(domain); zones.set(domain, z.zoneId); return { ref: z.zoneId, response: z }; },
      });
      steps.push({
        key: `ns:${domain}`, provider: 'namesilo', operation: 'setNameservers',
        run: async () => {
          const z = await dnsP.ensureZone(domain); // idempotent lookup
          await reg.setNameservers(domain, z.nameservers);
          return { request: { nameservers: z.nameservers } };
        },
      });
    }
  }

  if (product.unit === 'server') {
    steps.push({
      key: 'servers:order', provider: product.providerId, operation: 'orderServers',
      run: async () => { const r = await serverProvider(db).orderServers({ quantity: cfg.quantity!, idempotencyKey: `${order.id}:servers` }); return { ref: r.externalRef, pending: r.status !== 'delivered', request: { quantity: cfg.quantity }, response: r }; },
    });
  } else {
    const mp = mailboxProvider(db, product.providerId);
    const boxes = generateMailboxes(cfg);
    const byDomain = new Map<string, typeof boxes>();
    for (const b of boxes) byDomain.set(b.domain, [...(byDomain.get(b.domain) ?? []), b]);
    for (const [domain, list] of byDomain) {
      if (cfg.autoDns !== false) {
        steps.push({
          key: `dns:${domain}`, provider: 'cloudflare', operation: 'upsertRecords',
          run: async () => {
            const zoneId = zones.get(domain) ?? (await dnsP.ensureZone(domain)).zoneId;
            const records = mp.requiredDnsRecords(product.platform, domain, cfg.forwardingUrl || undefined);
            const r = await dnsP.upsertRecords(zoneId, domain, records);
            return { request: { records: records.length }, response: r };
          },
        });
      }
      steps.push({
        key: `mailboxes:${domain}`, provider: product.providerId, operation: 'createMailboxes',
        run: async () => {
          const r = await mp.createMailboxes({ platform: product.platform, domain, term: cfg.term!, idempotencyKey: `${order.id}:${domain}`, mailboxes: list.map((m) => ({ username: m.username, firstName: m.firstName, lastName: m.lastName, address: m.address })) });
          return { ref: r.externalRef, pending: r.status !== 'active', request: { domain, count: list.length }, response: r };
        },
      });
    }
  }
  return steps;
}

function prewarmedSteps(db: DB, order: OrderRow): StepDef[] {
  const cfg = json.parse<PrewarmedConfig>(order.config, {});
  return [{
    key: 'prewarm:buy', provider: 'inboxkit', operation: 'buyPrewarmed',
    run: async () => {
      const domains = (cfg.picks ?? []).map((p) => p.domain);
      const r = await prewarmedProvider(db).buy({ domains, forwardingDomain: cfg.forwardingUrl, idempotencyKey: `${order.id}:prewarm` });
      db.prepare('DELETE FROM prewarmed_holds WHERE order_id = ?').run(order.id);
      return { ref: r.externalRef, pending: r.status !== 'completed', request: { domains }, response: r };
    },
  }];
}
