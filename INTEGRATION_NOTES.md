# Integration notes

Status as of 13 Nov 2026. "Mock" means the deterministic fake is used and fully tested. "Implemented, not live-tested" means code exists against the vendor's documented API but no real call has been made (no real credentials were used in this build). Nothing below has been tested live.

The API keys in the original planning document were treated as compromised and were **not** used or copied. Rotate them and put fresh keys in `.env`.

## NameSilo (domains)

- Docs: <https://www.namesilo.com/api-reference>. Confirmed from the page: `https://www.namesilo.com/api/OPERATION?version=1&type=json&key=KEY`, GET only, HTTPS only. A sandbox exists; NameSilo issues sandbox credentials on request.
- The per-operation pages are JavaScript-rendered and could not be read from the build environment, so parameter names come from NameSilo's published operation list and must be confirmed in the sandbox.
- Payment: registrations are charged to the NameSilo **account funds** balance (or `NAMESILO_PAYMENT_ID`). Keep it topped up.

| Operation | Used for | Status |
|---|---|---|
| `checkRegisterAvailability` (`domains=a.com,b.com`) | live suggestions + re-check at checkout | Implemented, not live-tested |
| `getAccountBalance` | health check (read-only) | Implemented, not live-tested |
| `contactAdd` | customer as registrant | Implemented, not live-tested |
| `registerDomain` (`years=1, private=1, auto_renew=0, contact_id`) | purchase after payment | Implemented, not live-tested. Non-idempotent: timeouts → needs_review |
| `changeNameServers` | point domain to Cloudflare | Implemented, not live-tested |

Open: confirm response field names (`reply.available.domain[].price/renew/premium`), confirm whether `auto_renew` should be on (business decision), get sandbox access.

## Cloudflare (DNS)

- Docs: <https://developers.cloudflare.com/api/>. Base `https://api.cloudflare.com/client/v4`, `Authorization: Bearer <token>`.
- Token permissions needed (least privilege, account-owned token): **Zone → Zone: Edit**, **Zone → DNS: Edit**, scoped to the Cloudlead account. Set `CLOUDFLARE_ACCOUNT_ID` so new zones can be created.

| Operation | Status |
|---|---|
| `GET /accounts/{id}/tokens/verify` (or `/user/tokens/verify`) | Implemented, not live-tested (health check) |
| `GET /zones?name=` / `POST /zones {name, account:{id}, type:"full"}` → `name_servers` | Implemented, not live-tested |
| `GET/POST/PUT /zones/{id}/dns_records` | Implemented, not live-tested |

Open: DKIM records come from the mailbox vendor per domain; wire them in once Mailpool/InboxKit expose them. Forwarding uses a proxied A record placeholder; a Cloudflare Redirect Rule (or the vendor's forwarding) still has to be chosen.

## Mailpool (Google Workspace, shared SMTP; alternative for Microsoft 365)

- Help centre: <https://docs.mailpool.ai/en/collections/11895805-api> explains how to request API access and create keys (Settings → Workspace → API Keys). **No public endpoint reference was found.**
- Status: **mock only.** The live adapter raises `NotVerifiedError`, so live orders fail safely (order → failed, admin notified) rather than pretending.
- Billing model: not confirmed publicly. Ask Mailpool whether API orders draw from a prepaid wallet/credits or bill a card on file.
- To finish: get the API reference (base URL, auth header, create-mailbox endpoint, DNS records it needs, order status endpoint) and implement `createMailboxes` in `server/providers/mailpool.ts`.

## InboxKit (Microsoft 365 default, Azure, pre-warmed)

- Docs: <https://docs.inboxkit.com/> (public). Auth `Authorization: Bearer <key>`; domain/mailbox calls also need `X-Workspace-Id`. Rate limits: 5,000 req/min/IP; domain search 50/min; 429 with Retry-After.
- Billing: plan mailbox slots or **wallet** (`use_wallet_balance`). Azure and SMTP mailboxes are wallet-only. Pre-warmed purchases are charged to the wallet at order time. 402 = insufficient wallet balance.

| Operation | Status |
|---|---|
| Pre-warmed buy `POST /v1/api/prewarm/buy-domain` → `data.order_uid` | Implemented, not live-tested (body field names to confirm) |
| Pre-warmed search / check availability | Path not captured → `NotVerifiedError` (mock inventory used) |
| Buy mailboxes (`username, domain, platform`) | Path not captured → `NotVerifiedError` |
| Account details (health check) | Path not captured |

Open: the docs disagree on the `/v1` prefix; confirm each path in the docs with the real key, then fill `PATHS` in `server/providers/inboxkit.ts`. Note: InboxKit can also register domains and returns nameservers, which could replace NameSilo + Cloudflare for InboxKit products if preferred.

## OVHcloud US (Raw SMTP Servers)

- Console: <https://api.us.ovhcloud.com/console/>. Base `https://api.us.ovhcloud.com/1.0`; `GET /auth/time` confirmed reachable during the build.
- Signing implemented: `X-Ovh-Signature = "$1$" + sha1(AS+CK+METHOD+URL+BODY+TS)` with server time delta (standard OVH scheme; guide page was not reachable, unit-tested only).
- Credentials need rights for `GET /me`, `GET /order/*`, `POST /order/cart*` (and later `/vps/*`).

| Operation | Status |
|---|---|
| `GET /auth/time`, signed `GET /me` | Implemented, not live-tested (health check) |
| VPS catalogue `/order/catalog/public/vps?ovhSubsidiary=US` | Request failed during build → not implemented |
| Order via `/order/cart` → add VPS → configure → checkout | Not implemented (`NotVerifiedError`) |

Open: choose the VPS plan(s) to resell, confirm cart payload, decide payment method on the OVH account (checkout auto-pay vs manual).

## Stripe

Intentionally not connected. See `docs/STRIPE_HANDOFF.md`.

## Tests run in this build

- `npm test`: 20 automated tests (unit + API), all passing, mock mode.
- Full browser click-through (Playwright) of: fresh Google Workspace order end to end (10 mailboxes, 2 domains, 5 senders, DNS, owner, review, simulated payment, status page), pre-warmed cart, mobile store page, admin products/integrations/orders. No console errors.
- **No live vendor API was called.**
