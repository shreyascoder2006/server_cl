# Cloudlead Infra Store

A self-service store where Cloudlead customers buy cold-email sending infrastructure:

- **Fresh mailboxes** on new .com domains: Google Workspace, Microsoft 365, Microsoft Azure tenants, shared SMTP mailboxes
- **Raw SMTP Servers** (Cloudlead-only offer): a dedicated VPS the customer fills with inboxes using Cloudlead's free SMTP builder
- **Pre-warmed mailboxes**: Google / Microsoft inboxes on domains that already have a sending history

It includes a guided checkout (quantity → domains → senders → DNS → domain owner → review → payment), server-side pricing, an admin panel where every price is editable, provider adapters with a safe **mock mode**, and a clean payment boundary for Stripe.

> Scope: this build ends at the payment handoff and at submitting orders to vendors. Showing delivered mailbox credentials to customers, and the operations work after delivery, are not included.

---

## 1. Run it on your computer (non-technical)

**Windows**
1. Install **Node.js LTS** from <https://nodejs.org> (version 22.13 or newer). Accept the defaults.
2. Unzip this folder anywhere, for example `Documents\cloudlead-infra-store`.
3. Double-click **`START-WINDOWS.bat`**. The first run installs everything (1–2 minutes). Your browser opens at <http://localhost:4000>.
4. Click **Customer demo** to try buying, or **Admin demo** to edit prices.
5. To stop, close the black window.

**Mac / Linux:** run `./start-mac-linux.sh` in Terminal.

Everything runs in **test mode**: vendors are simulated, nothing is bought, and payment is a "Simulate payment" button.

Demo accounts (local only):

| Role | Email | Password |
|---|---|---|
| Admin | admin@cloudlead.local | admin1234 |
| Customer (tenant: Acme) | demo@acme.local | demo1234 |
| Second customer (tenant: Globex) | other@globex.local | demo1234 |

To wipe all test orders and start fresh: `npm run db:reset`.

---

## 2. Developer guide (Akshay)

### Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run db:reset` | Create/reset the local SQLite DB with seed data |
| `npm run dev` | API on :4000 with reload + Vite on :5173 (proxying `/api`) |
| `npm start` | Build the frontend and serve everything on :4000 |
| `npm test` | Unit + API integration tests (Vitest + Supertest, in-memory DB) |
| `npm run typecheck` | TypeScript check of server, client and tests |

Requires Node ≥ 22.13 (uses the built-in `node:sqlite`, so there is no native build step).

### Architecture

```
server/
  index.ts            boot (seed on first run) + listen
  app.ts              express app, security headers, raw body for webhooks, error handler
  config.ts           env loading (.env), secrets list for redaction
  db.ts               SQLite schema (single file, idempotent) + helpers
  seed.ts             starting catalogue, settings, demo tenants/users
  auth.ts             scrypt passwords, hashed session tokens (cookie), role guards
  catalog.ts          products/settings access; publicProduct() strips vendor + cost
  pricing.ts          ALL price maths (server-side only)
  domains.ts          name-idea generator + live availability via registrar adapter
  orderModel.ts       order states/transitions, zod schemas, validation, mailbox generation
  orders.ts           drafts, quotes, checkout (idempotent), payment events, customer-safe views
  payments.ts         PAYMENT BOUNDARY: mock gateway + Stripe stub
  fulfillment.ts      step-by-step vendor submission with per-step idempotency
  providers/
    types.ts          provider interfaces + NotVerified/OutcomeUnknown errors
    registry.ts       chooses mock vs live per provider
    http.ts           fetch with timeout, backoff for idempotent calls, redacted logs
    mock.ts           deterministic fake vendors
    namesilo.ts  cloudflare.ts  mailpool.ts  inboxkit.ts  ovh.ts   live adapters
  routes/store.ts     customer API
  routes/admin.ts     admin API (role-guarded, audited)
client/src/           React + TypeScript (Vite), plain CSS with design tokens in styles.css
tests/                Vitest suites
docs/                 Stripe handoff, QA checklist
INTEGRATION_NOTES.md  per-vendor status, docs links, permissions, open items
```

**Production database:** SQLite is used for local development. The SQL is plain and portable; for production either keep SQLite on a persistent volume (fine for this workload) or port `db.ts` to Postgres (same tables, `TEXT` JSON columns → `jsonb`).

**Merging into the Cloudlead codebase:** the store is self-contained. Reuse your existing auth by replacing `loadUser()` in `server/auth.ts` (it only needs to set `req.user = { id, tenantId, email, name, role }`). Mount `createApp()` routers under your API, or copy `server/` modules into your backend. The React pages in `client/src/pages` use only `lib/api.ts` and `components/ui.tsx`.

### Order lifecycle

```
draft ──checkout──▶ awaiting_payment ──payment webhook──▶ payment_authorized ──▶ submitting
  ▲                       │                                                        │
  └──── customer edits ───┘                                       ┌────────────────┼──────────────┐
                                                                  ▼                ▼              ▼
                                                          provider_pending      failed       needs_review
                                                                  │          (admin retry)  (unknown outcome:
                                                                  ▼                          admin resolves)
                                                              submitted
```

- Status only moves on confirmed events: a verified payment webhook or a provider response.
- Nothing is bought from a vendor before `payment_authorized`.
- Each vendor call is a recorded step (`provider_requests`, unique per order+step). Retries skip finished steps, so a domain or mailbox is never bought twice.
- A purchase call that times out after sending is marked **unknown**, never retried automatically, and the order goes to `needs_review`. An admin checks the vendor dashboard and records what happened.

### Pricing rules (all editable in Admin)

- Mailbox products: price per mailbox per month. Annual = monthly × (1 − discount) × 12, billed once a year. Default discount 15%.
- Azure: price per **tenant**; tenants = ceil(mailboxes ÷ mailboxes per tenant).
- Raw SMTP Server: price per server; domains = servers × domains-per-server.
- Domains: one flat .com price per year (default $12) regardless of small registrar cost differences. Names whose registrar cost is above a cap (default $15) or premium are hidden.
- Pre-warmed: price per mailbox by warmup tier + a yearly domain fee.
- Optional tax %. All totals are computed on the server; the client never sends prices.

### Mock vs live

A vendor only makes real calls when **all three** are true:
1. `PROVIDER_MODE=live` in `.env`
2. the vendor is switched to **Live** in Admin → Integrations
3. its credentials are set in `.env`

Admin → Integrations shows the effective mode and why, and runs read-only health checks. Checks that could cost money are listed but never run automatically. See `INTEGRATION_NOTES.md` for exactly what is verified per vendor.

### How to test real APIs without deploying

1. Copy `.env.example` to `.env`, set `PROVIDER_MODE=live`, and add one vendor's credentials.
2. `npm start`, sign in as admin, set that vendor to Live and press **Run health check**. These calls are read-only (account balance, token verify, `/auth/time` + `/me`, etc.).
3. For a real purchase test, deliberately buy one domain / one mailbox with the simulated payment button, then watch Admin → Orders. Do this with a small balance on the vendor account.

### Environment variables

See `.env.example`. Never commit `.env` (it is gitignored). Secrets are only read on the server and are redacted from logs and stored request/response records.

### Security notes

- Tenant isolation: every customer query filters by `tenant_id`; other tenants' orders return 404. Covered by tests.
- Admin API requires `role = admin`; every admin change is written to `audit_log` with before/after values.
- Sessions: random 256-bit tokens, stored hashed, HttpOnly + SameSite=Lax cookie.
- Checkout requires an `Idempotency-Key` header; replays return the same payment session.
- Webhooks are verified (HMAC for mock; Stripe signature for Stripe) and de-duplicated by event id.
- Customer responses never include vendor names, costs, or raw vendor errors.
- **Credentials that appeared in the original planning document must be treated as exposed and rotated** before any live testing.

### Known limitations

- Stripe charging is intentionally not implemented (see `docs/STRIPE_HANDOFF.md`).
- Mailpool has no public API reference; its live adapter refuses to run until the endpoints are confirmed.
- InboxKit: only the pre-warmed purchase path is confirmed from its docs; other paths are TODOs.
- OVH server ordering (cart flow) is not implemented until plan codes are confirmed.
- Profile photos for mailboxes are not collected yet.
- Existing-domain ("add mailboxes to a domain I already own") is modelled (`allow_existing_domain`) but switched off until a vendor flow is verified.
- Provider "pending → active" status polling after submission is not built (delivery is out of scope).
