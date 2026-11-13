# Manual QA checklist (mock mode)

Start with `START-WINDOWS.bat` (or `npm start`) and a fresh DB (`npm run db:reset`).

## Store
- [ ] Test-mode banner is visible at the top.
- [ ] Raw SMTP Server is featured; Google, Microsoft 365, Azure, Shared SMTP cards show the right prices.
- [ ] No vendor names appear anywhere a customer can see.
- [ ] "Never send cold emails via your primary domain" warning shows on the store, domain step and review.

## Fresh order (Google Workspace)
- [ ] Choose 10 mailboxes, ratio 5:1 → "2 new domains" shown with the calculation.
- [ ] Switch to Annual → summary shows 15% off and "billed annually".
- [ ] "Help me decide" calculator: goal and volume modes; "Use N mailboxes" fills the quantity.
- [ ] Domains: search a name → only available names appear; selecting more than needed is blocked; "Find more" loads more.
- [ ] Continue with too few domains → clear error.
- [ ] Senders: 5 senders on all domains → 10 of 10 mailboxes; duplicate names get unique addresses; "Paste a list" works.
- [ ] Remove a sender → mismatch error on Continue.
- [ ] DNS: forwarding site + auto DNS toggle.
- [ ] Domain owner: invalid email/phone/country shows field errors.
- [ ] Review: mailbox table, cost table, "what you pay after today", terms checkbox required.
- [ ] Simulate declined payment → message, order still awaiting payment.
- [ ] Simulate successful payment → order page shows each setup step as Done and status Provisioning.
- [ ] Refresh mid-wizard → you return to the same step with your data (draft is saved).

## Other products
- [ ] Azure: 120 mailboxes → 3 tenants priced per tenant.
- [ ] Raw SMTP Server: no Senders/DNS steps; domains = servers × domains per server.
- [ ] Pre-warmed: filter by platform/warmup, add/remove domains, annual toggle, details, review, pay. A domain in someone's checkout disappears for other customers.

## Admin (admin@cloudlead.local)
- [ ] Edit a price → the store and new quotes use it; Audit log shows before/after.
- [ ] Turn a product off → it disappears from the store.
- [ ] Integrations: run health checks; set a vendor to Live without credentials → stays mock and explains why.
- [ ] Orders: open an order and see each vendor step, mode and reference.

## Isolation
- [ ] Sign in as other@globex.local → cannot see Acme's orders (direct URL gives "not found").
