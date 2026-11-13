import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONTACT, freshApp, login } from './helpers.ts';

let app: any;
let db: any;
let customer: string;
let other: string;
let admin: string;

beforeEach(async () => {
  ({ app, db } = freshApp());
  customer = await login(app, 'demo@acme.local', 'demo1234');
  other = await login(app, 'other@globex.local', 'demo1234');
  admin = await login(app, 'admin@cloudlead.local', 'admin1234');
});

async function pickDomains(cookie: string, n: number) {
  const r = await request(app).post('/api/domains/search').set('Cookie', cookie).send({ query: 'talenthire', limit: n });
  expect(r.status).toBe(200);
  expect(r.body.results.length).toBeGreaterThanOrEqual(n);
  return r.body.results.slice(0, n).map((d: any) => d.domain);
}

async function buildGoogleOrder(cookie: string) {
  const created = await request(app).post('/api/orders').set('Cookie', cookie).send({ journey: 'fresh', productCode: 'google_workspace' });
  expect(created.status).toBe(201);
  const id = created.body.order.id;
  await request(app).patch(`/api/orders/${id}`).set('Cookie', cookie).send({ config: { term: 'monthly', quantity: 10, ratio: 5 }, step: 'domains' }).expect(200);
  const domains = await pickDomains(cookie, 2);
  const personas = ['Sonal Shah', 'Kedar Tapikar', 'Amol Kale', 'Manoj Tiwari', 'Rajesh Joshi'].map((n, i) => ({ id: `p${i}`, firstName: n.split(' ')[0], lastName: n.split(' ')[1], domains: 'all' as const }));
  const r = await request(app).patch(`/api/orders/${id}`).set('Cookie', cookie).send({ config: { domains, personas, forwardingUrl: 'acme.example', autoDns: true, contact: CONTACT, acceptedTerms: true }, step: 'review' });
  expect(r.status).toBe(200);
  return { id, domains, preview: r.body.preview };
}

describe('fresh mailbox journey (mock mode)', () => {
  it('prices server-side, takes payment handoff, and submits to providers', async () => {
    const { id, preview } = await buildGoogleOrder(customer);
    // 10 Google mailboxes x $4.25 + 2 domains x $12
    expect(preview.dueTodayCents).toBe(10 * 425 + 2 * 1200);

    const issues = await request(app).post(`/api/orders/${id}/validate`).set('Cookie', customer).send({});
    expect(issues.body.issues).toEqual([]);

    const co = await request(app).post(`/api/orders/${id}/checkout`).set('Cookie', customer).set('Idempotency-Key', 'checkout-test-0001');
    expect(co.status).toBe(200);
    expect(co.body.order.status).toBe('awaiting_payment');
    expect(co.body.payment.amountCents).toBe(6650);

    // Same key replays the same session; nothing is duplicated.
    const again = await request(app).post(`/api/orders/${id}/checkout`).set('Cookie', customer).set('Idempotency-Key', 'checkout-test-0001');
    expect(again.body.replayed).toBe(true);
    expect(db.prepare('SELECT COUNT(*) n FROM payments WHERE order_id = ?').get(id).n).toBe(1);

    const paid = await request(app).post(`/api/dev/simulate-payment/${id}`).set('Cookie', customer).send({});
    expect(paid.status).toBe(200);
    expect(paid.body.order.status).toBe('provider_pending');
    const steps = paid.body.order.progress.map((p: any) => p.status);
    expect(steps.every((s: string) => s === 'succeeded')).toBe(true);
    // Customer view must not leak vendor names.
    expect(JSON.stringify(paid.body.order)).not.toMatch(/namesilo|mailpool|inboxkit|cloudflare|ovh/i);
  });

  it('annual billing applies the 15% discount', async () => {
    const { id } = await buildGoogleOrder(customer);
    const r = await request(app).patch(`/api/orders/${id}`).set('Cookie', customer).send({ config: { term: 'annual' } });
    // 425 * 0.85 = 361.25 -> 361 cents per month, x12 x10 + domains
    expect(r.body.preview.dueTodayCents).toBe(361 * 12 * 10 + 2 * 1200);
  });

  it('rejects mismatched mailbox counts with a helpful message', async () => {
    const { id } = await buildGoogleOrder(customer);
    await request(app).patch(`/api/orders/${id}`).set('Cookie', customer).send({ config: { personas: [{ id: 'a', firstName: 'Solo', lastName: 'Sender', domains: 'all' }] } });
    const co = await request(app).post(`/api/orders/${id}/checkout`).set('Cookie', customer).set('Idempotency-Key', 'checkout-test-0002');
    expect(co.status).toBe(422);
    expect(JSON.stringify(co.body.details)).toMatch(/create 2 mailboxes, but you are buying 10/);
  });

  it('never trusts client prices', async () => {
    const created = await request(app).post('/api/orders').set('Cookie', customer).send({ journey: 'fresh', productCode: 'google_workspace' });
    const r = await request(app).patch(`/api/orders/${created.body.order.id}`).set('Cookie', customer).send({ config: { priceCents: 1 } });
    expect(r.status).toBe(400);
  });
});

describe('tenant isolation', () => {
  it('another customer cannot read, edit, check out or pay for an order', async () => {
    const { id } = await buildGoogleOrder(customer);
    expect((await request(app).get(`/api/orders/${id}`).set('Cookie', other)).status).toBe(404);
    expect((await request(app).patch(`/api/orders/${id}`).set('Cookie', other).send({ config: { quantity: 20 } })).status).toBe(404);
    expect((await request(app).post(`/api/orders/${id}/checkout`).set('Cookie', other).set('Idempotency-Key', 'checkout-test-0003')).status).toBe(404);
    expect((await request(app).post(`/api/dev/simulate-payment/${id}`).set('Cookie', other)).status).toBe(404);
    const list = await request(app).get('/api/orders').set('Cookie', other);
    expect(list.body.orders.find((o: any) => o.id === id)).toBeUndefined();
  });

  it('customers cannot reach admin APIs', async () => {
    expect((await request(app).get('/api/admin/products').set('Cookie', customer)).status).toBe(403);
    expect((await request(app).get('/api/admin/products')).status).toBe(401);
  });
});

describe('payment boundary', () => {
  it('rejects unsigned or forged webhooks', async () => {
    const { id } = await buildGoogleOrder(customer);
    await request(app).post(`/api/orders/${id}/checkout`).set('Cookie', customer).set('Idempotency-Key', 'checkout-test-0004');
    const forged = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-mock-signature', 'deadbeef')
      .send(JSON.stringify({ id: 'evt_x', type: 'payment.authorized', orderId: id, sessionId: 'x', amountCents: 1, currency: 'USD', gatewayRef: 'x' }));
    expect(forged.status).toBe(400);
    const o = await request(app).get(`/api/orders/${id}`).set('Cookie', customer);
    expect(o.body.order.status).toBe('awaiting_payment');
  });

  it('editing after checkout releases the quote and returns to draft', async () => {
    const { id } = await buildGoogleOrder(customer);
    await request(app).post(`/api/orders/${id}/checkout`).set('Cookie', customer).set('Idempotency-Key', 'checkout-test-0005');
    const r = await request(app).patch(`/api/orders/${id}`).set('Cookie', customer).send({ config: { term: 'annual' } });
    expect(r.body.order.status).toBe('draft');
    expect(r.body.order.quote).toBeNull();
  });
});

describe('pre-warmed journey', () => {
  it('browses inventory, prices per tier and submits', async () => {
    const inv = await request(app).get('/api/prewarmed').set('Cookie', customer);
    expect(inv.status).toBe(200);
    const picks = inv.body.items.slice(0, 3).map((i: any) => ({ domain: i.domain, platform: i.platform, tierKey: i.tierKey, mailboxes: i.mailboxes.length }));
    const created = await request(app).post('/api/orders').set('Cookie', customer).send({ journey: 'prewarmed' });
    const id = created.body.order.id;
    const r = await request(app).patch(`/api/orders/${id}`).set('Cookie', customer).send({ config: { picks, term: 'monthly', forwardingUrl: 'acme.example', contact: CONTACT, acceptedTerms: true } });
    expect(r.status).toBe(200);
    expect(r.body.preview.domainCount).toBe(3);
    const co = await request(app).post(`/api/orders/${id}/checkout`).set('Cookie', customer).set('Idempotency-Key', 'checkout-test-0006');
    expect(co.status).toBe(200);
    // Held domains disappear for other customers.
    const inv2 = await request(app).get('/api/prewarmed').set('Cookie', other);
    expect(inv2.body.items.find((i: any) => i.domain === picks[0].domain)).toBeUndefined();
    const paid = await request(app).post(`/api/dev/simulate-payment/${id}`).set('Cookie', customer).send({});
    expect(paid.body.order.status).toBe('provider_pending');
  });
});

describe('raw SMTP server', () => {
  it('needs domains per server but no senders', async () => {
    const created = await request(app).post('/api/orders').set('Cookie', customer).send({ journey: 'fresh', productCode: 'raw_smtp_server' });
    const id = created.body.order.id;
    await request(app).patch(`/api/orders/${id}`).set('Cookie', customer).send({ config: { term: 'monthly', quantity: 2, ratio: 3 } });
    const domains = await pickDomains(customer, 6);
    const r = await request(app).patch(`/api/orders/${id}`).set('Cookie', customer).send({ config: { domains, contact: CONTACT, acceptedTerms: true } });
    expect(r.body.preview.dueTodayCents).toBe(2 * 1900 + 6 * 1200);
    const v = await request(app).post(`/api/orders/${id}/validate`).set('Cookie', customer).send({});
    expect(v.body.issues).toEqual([]);
  });
});

describe('admin', () => {
  it('edits prices with audit trail and customers see the new price', async () => {
    const r = await request(app).patch('/api/admin/products/google_workspace').set('Cookie', admin).send({ monthly_price_cents: 499 });
    expect(r.status).toBe(200);
    const cat = await request(app).get('/api/catalog').set('Cookie', customer);
    const g = cat.body.products.find((p: any) => p.code === 'google_workspace');
    expect(g.monthlyPriceCents).toBe(499);
    expect(g.providerId).toBeUndefined();
    expect(g.costCents).toBeUndefined();
    const audit = await request(app).get('/api/admin/audit').set('Cookie', admin);
    expect(audit.body.entries[0].entity_id).toBe('google_workspace');
  });

  it('disabling a provider hides its products', async () => {
    await request(app).patch('/api/admin/providers/ovh').set('Cookie', admin).send({ enabled: false }).expect(200);
    const cat = await request(app).get('/api/catalog').set('Cookie', customer);
    expect(cat.body.products.find((p: any) => p.code === 'raw_smtp_server')).toBeUndefined();
  });

  it('live mode without credentials stays mock and says why', async () => {
    await request(app).patch('/api/admin/providers/namesilo').set('Cookie', admin).send({ mode: 'live' }).expect(200);
    const h = await request(app).post('/api/admin/providers/namesilo/health').set('Cookie', admin);
    expect(h.body.effective).toBe('mock');
    expect(h.body.reason).toMatch(/PROVIDER_MODE|credentials/);
  });
});
