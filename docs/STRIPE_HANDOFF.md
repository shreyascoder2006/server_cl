# Stripe handoff (for Akshay)

The store never charges cards itself. Everything up to "ready to take payment" and everything after "payment confirmed" is built. You only implement two functions in `server/payments.ts` (`stripeGateway.createSession` and `stripeGateway.parseWebhook`) and set `PAYMENT_GATEWAY=stripe`.

## 1. Checkout request (already built)

`POST /api/orders/:id/checkout` with header `Idempotency-Key: <client-generated, 8–80 chars>`

The server: validates every step → re-checks domain availability live → re-prices → calls `gateway().createSession(input)` → stores the session in `payments` (status `pending`) → moves the order to `awaiting_payment`. Same key = same session (no duplicates).

`createSession` receives:

```ts
{
  orderId: 'ord_…',
  tenantId: 't_…',
  checkoutKey: 'co_…',          // use as Stripe idempotency key
  amountCents: 6650,            // server-computed total due today
  currency: 'USD',
  description: 'Cloudlead infrastructure order ord_…',
  customerEmail: 'priya@acme.example',
  lineItems: [
    { label: 'Google Workspace (first month)', amountCents: 4250, cadence: 'monthly' },
    { label: 'New .com domains (1 year)', amountCents: 2400, cadence: 'yearly' }
  ]
}
```

It must return:

```ts
{ gateway: 'stripe', sessionId: 'cs_…', redirectUrl: 'https://checkout.stripe.com/…', amountCents: 6650, currency: 'USD' }
```

The frontend redirects to `redirectUrl` when present. Put `order_id`, `tenant_id` and `checkout_key` in the Stripe session `metadata`. Success/cancel URLs: `/orders/{orderId}?new=1` and `/store/order/{orderId}`.

Recurring billing: the quote also contains `recurring[]` (monthly/annual service + yearly domain renewals). Either create Stripe Subscriptions (mode `subscription`, one price per cadence) or charge the first period now and handle renewals in your billing system. The order stores the full quote JSON for this.

## 2. Webhook (already wired)

`POST /api/payments/webhook` receives the **raw body** (configured in `app.ts`). Implement `parseWebhook(rawBody, headers)`:

```ts
const event = stripe.webhooks.constructEvent(rawBody, headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
// map checkout.session.completed (payment_status = 'paid') or payment_intent.succeeded to:
return {
  id: event.id,                         // de-duplicated by the server
  type: 'payment.authorized',           // or 'payment.failed' / 'payment.ignored'
  orderId: session.metadata.order_id,
  sessionId: session.id,                // must match the stored payment id
  amountCents: session.amount_total,
  currency: session.currency.toUpperCase(),
  gatewayRef: session.payment_intent,
};
```

The server then: ignores repeated event ids → checks the session belongs to the order → checks the amount and currency equal the stored total (mismatch → `needs_review`, nothing ordered) → moves to `payment_authorized` → starts vendor fulfilment in the background.

## 3. Local testing

`stripe listen --forward-to localhost:4000/api/payments/webhook` and use test cards. With `PAYMENT_GATEWAY=mock` (default), the "Simulate payment" buttons post a correctly signed mock webhook through the same code path.

## 4. Order states you may want to surface in billing

`awaiting_payment`, `payment_authorized`, `submitting`, `provider_pending`, `submitted`, `needs_review`, `failed`, `cancelled`. Refund policy decisions for `failed` orders are a business call; the admin panel shows which vendor steps succeeded.
