import crypto from 'node:crypto';
import { config } from './config.ts';

/**
 * PAYMENT BOUNDARY (for Akshay)
 * ----------------------------
 * The store never charges cards itself. At checkout the server calls
 * `gateway().createSession(order)` with a server-computed amount, stores the
 * returned session, and waits for the gateway to confirm authorization through
 * the webhook at POST /api/payments/webhook. Only that confirmed webhook moves an
 * order to `payment_authorized`, which is the only state that can start vendor
 * purchases.
 *
 * To go live with Stripe, implement `stripeGateway` below:
 *   - createSession: create a Stripe Checkout Session (mode "payment" for the
 *     first charge, or "subscription" if you model recurring billing in Stripe)
 *     with metadata { order_id, tenant_id, checkout_key }, amount = order total.
 *   - parseWebhook: verify the `Stripe-Signature` header with STRIPE_WEBHOOK_SECRET
 *     (stripe.webhooks.constructEvent on the RAW body) and map
 *     checkout.session.completed / payment_intent.succeeded to
 *     { type: 'payment.authorized', ... }.
 * See docs/STRIPE_HANDOFF.md for the exact payloads.
 */

export interface PaymentSessionInput {
  orderId: string;
  tenantId: string;
  checkoutKey: string;
  amountCents: number;
  currency: string;
  description: string;
  customerEmail?: string;
  lineItems: { label: string; amountCents: number; cadence: string }[];
}

export interface PaymentSession {
  gateway: 'mock' | 'stripe';
  sessionId: string;
  /** URL to redirect the customer to (Stripe Checkout), when applicable. */
  redirectUrl?: string;
  amountCents: number;
  currency: string;
}

export interface GatewayEvent {
  id: string;
  type: 'payment.authorized' | 'payment.failed' | 'payment.ignored';
  orderId: string;
  sessionId: string;
  amountCents: number;
  currency: string;
  gatewayRef: string;
}

export interface PaymentGateway {
  name: 'mock' | 'stripe';
  createSession(input: PaymentSessionInput): Promise<PaymentSession>;
  /** Must verify authenticity. Throws on bad signature. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): GatewayEvent;
}

const hmac = (body: Buffer | string) => crypto.createHmac('sha256', config.appSecret).update(body).digest('hex');

/** Local-only gateway. The "Simulate payment" button posts a signed fake webhook. */
export const mockGateway: PaymentGateway = {
  name: 'mock',
  async createSession(input) {
    return { gateway: 'mock', sessionId: `mock_cs_${input.checkoutKey}`, amountCents: input.amountCents, currency: input.currency };
  },
  parseWebhook(rawBody, headers) {
    const sig = String(headers['x-mock-signature'] ?? '');
    const expected = hmac(rawBody);
    if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Invalid mock webhook signature');
    const evt = JSON.parse(rawBody.toString('utf8'));
    return evt as GatewayEvent;
  },
};

export function signMockWebhook(event: GatewayEvent) {
  const body = JSON.stringify(event);
  return { body, signature: hmac(body) };
}

export const stripeGateway: PaymentGateway = {
  name: 'stripe',
  async createSession() {
    throw new Error('Stripe is not connected yet. Akshay: implement stripeGateway.createSession in server/payments.ts (see docs/STRIPE_HANDOFF.md).');
  },
  parseWebhook() {
    throw new Error('Stripe webhook verification not implemented yet (see docs/STRIPE_HANDOFF.md).');
  },
};

export function gateway(): PaymentGateway {
  return config.paymentGateway === 'stripe' ? stripeGateway : mockGateway;
}
