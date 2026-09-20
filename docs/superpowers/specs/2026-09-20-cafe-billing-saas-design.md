# Cafe Billing SaaS — Multi-Tenant, Offline-First Design

**Date:** 2026-09-20
**Status:** Design approved in conversation; revised 2026-09-20 to add mall-style QR self-ordering (section 9) and the cafe/bakery operations review (sections 10–13, appendix A); Wave A confirmed as the first post-beta wave; spec approved for planning
**Scope:** Turn `thangai-pos` (single-cafe, single-till) into a subscription product sold to many cafes, with several billing devices per cafe syncing live, on Supabase.

---

## 1. Goals and non-goals

### Goals
1. Many independent cafes ("shops") use one hosted backend with hard data isolation.
2. Each shop runs several billing devices (counter, second till, waiter phones, kitchen screen) that stay in sync.
3. Billing keeps working with no internet (full offline-first), and reconciles exactly once when connectivity returns.
4. Cafes subscribe per shop; access follows the subscription without ever stranding a till mid-service.
5. Runs on Supabase's free plan for development and the pilot, with an explicit trigger for moving to paid plans.
6. Client and server stay fast at realistic volume (about 200 bills/day/shop, years of history).
7. Mall-style self-service: a diner scans a QR for that cafe, orders and pays on their own phone, the kitchen gets the KOT the moment payment succeeds (no waiting for a waiter or cashier), and the diner is billed and notified without staff involvement (section 9).
8. Fit the real operations of cafes, bakeries and related food shops: table service, weight-based and advance/custom orders, stock, GST tax regimes, cash control, customers and credit (sections 10–11).
9. Payment integrity: no reliance on a customer's screenshot or a cashier's word that UPI arrived (section 10.3).
10. Growth features: aggregator/ONDC and WhatsApp channels, AI assistance, and a legal/trust pack sufficient to charge customers (sections 12–13).

### Non-goals (this spec)
- A single QR listing many stalls in a mall (marketplace with split settlement). This spec covers one QR set per cafe/counter/table. The account → shop hierarchy does not preclude a later marketplace layer.
- Plan tiers and per-shop pricing (separate decision).
- Native wrappers (Capacitor/Tauri) and a LAN hub for cross-device sync during internet outages. Planned as later phases; the data model does not preclude them. (Direct ESC/POS printing from Chrome/Edge via web APIs is in scope, section 11.7.)
- Recipes, ingredient-level costing and purchasing/supplier management. Stock-lite (finished-goods counts, batch/expiry, wastage) **is** in scope (section 11.3); the `recipeId` hook stays reserved.
- Building every module before the first beta. The schema for all in-scope modules is designed up front (Phase 1), but features ship in waves (section 16).

### Assumptions
- India-first: INR, GST, UPI, Razorpay.
- Subscription is billed per shop; an account can own several shops.
- Existing Thanjai Cafe data migrates in as shop #1.

---

## 2. Current state (analysis of `main` at commit `d2cb1d1`)

**Stack:** React 19, Vite 8, TypeScript, Zustand, Dexie (IndexedDB), vite-plugin-pwa, Supabase (Postgres, Realtime, Edge Functions), Razorpay. 207 unit tests, Playwright verification scripts in `.verify/`.

**Strengths to keep:** integer-paise money engine with largest-remainder discount apportioning and per-slab GST (`services/billing/calc.ts`); offline till on Dexie; QR-order payment path (single writer of `PAID` after HMAC verification, idempotent webhook on `razorpay_payment_id`, server-side repricing, unpaid carts held in `pending_orders`); Realtime with polling fallback; role/permission model enforced at route level; shared client/server calc with a parity test.

**Gaps against the goals:**

| # | Gap | Where |
|---|---|---|
| 1 | Single-tenant: no `shop_id` anywhere; one global menu and token counter | `supabase/migrations/0001_qr_ordering.sql` |
| 2 | Staff have no server identity; login is a 4-digit PIN stored in plaintext in IndexedDB | `useAppStore.login`, `types/index.ts` `User.pin` |
| 3 | Sync is a one-way bill mirror; nothing pulls; products, settings and users do not sync | `services/api/sync.ts`, `0005_bill_backup.sql` |
| 4 | Bill numbers come from a per-device local counter, so a second device collides | `db.ts` `nextBillSeq` |
| 5 | `init()` loads every bill into Zustand and reports run in JS over all of them | `useAppStore.init`, `reports/analytics.ts` |
| 6 | No subscription, plan, entitlement or licence layer | — |
| 7 | Migration hygiene: no `0003`, applied by pasting root `apply-migrations*.sql` into the dashboard; Dexie still at `version(1)` | `supabase/`, `db.ts` |
| 8 | KOT is manual: a "Print KOT" button on the kitchen and online-orders pages. The `autoPrint` setting covers customer receipts only. Nothing fires a KOT when payment succeeds. | `KitchenPage.tsx`, `OnlineOrdersPage.tsx`, `defaults.ts` |
| 9 | A paid QR order becomes a bill only if a till has the Online Orders page open: `useOrderIntake` claims it and spends an invoice number on that till. With no till open, a paid order has no bill. | `features/orders/useOrderIntake.ts` |
| 10 | QR ordering knows only tables (`t=T04`): no counter/pickup or takeaway type, no kitchen stations, no kitchen acknowledgement, no token board, no ready notification beyond the status page | `0001_qr_ordering.sql`, `pages/Customer/` |
| 11 | No item variants or modifiers (size, extra shot, add-ons); a bill line has only a free-text note | `types/index.ts` `BillLine` |

**Security findings**
1. `VITE_PUBLISH_TOKEN` is inlined into the public JS bundle by Vite. It guards `publish-menu` and `backup-bills`, both of which use the service-role key. Because `create-order` trusts `menu_items` prices, holding the token allows publishing a ₹1 menu and ordering at ₹1 through real Razorpay, wiping the menu, or injecting fake bills.
2. `DEPLOY-STEPS.md` (gitignored, never committed) holds plaintext secret values and notes that a live Razorpay secret was pasted into a chat and remains exposed. Rotate it.
3. `create-order` is anonymous with `CORS: *` and no rate limit.
4. `deleteBill` hard-deletes financial records with no audit trail.
5. Sync gates on `navigator.onLine`, which misses captive-portal Wi-Fi.

---

## 3. Decisions

| Decision | Choice | Reason |
|---|---|---|
| Offline model | Full offline-first | Cafes cannot stop billing when Wi-Fi drops |
| Client stack | Keep React 19 + Vite PWA | Existing, tested implementation |
| Multi-device | Several billing devices sync live | Required product capability |
| Sync engine | **PowerSync** on Supabase, gated by a spike; **fallback: custom sync on Dexie** | Mature offline sync with per-tenant partial sync; SQL on device fixes the scaling gap |
| Tenancy | Pooled: one Supabase project, `shop_id` on every row | Free plan allows two projects; per-cafe projects do not scale operationally |
| Diner payments | **Bring-your-own Razorpay keys per shop** (Vault-encrypted) | Money settles to the cafe; avoids the operator handling payouts. Alternative: Razorpay Route (needs onboarding). To confirm. |
| Distribution | Installable PWA first | Covers Windows, Android and iOS without wrappers; wrappers only if needed |
| QR order billing | Created **server-side** at payment confirmation, from a server-allocated online invoice series | Removes the dependency on a till being open and the burned-invoice-number problem |
| Kitchen | Kitchen display (KDS) per station is the primary path; auto-print is optional | Browsers cannot silently print to a network thermal printer, so a screen needs no printer or bridge |
| Diner ready notice | Live status page and token board free; WhatsApp/SMS optional paid add-ons | Push is unreliable for diners on iOS; messaging has a per-message cost |
| Tax | Data-driven: shop tax regime, HSN/SAC, order-type rules, effective dates, per-line rule snapshot | Rates changed recently, and dine-in versus takeaway can change the treatment; hard-coded rates would need a release for each change |
| Refunds and amendments | Credit note with its own series, and cancel-and-reissue for corrections | Post-invoice adjustments are a compliance matter (CA to confirm) |
| Walk-in UPI | Verified by gateway webhook (per-bill dynamic QR or link); manual attestation is a flagged fallback | Fake payment screenshots are a documented scam; the cashier's word is not proof |
| Manager authority | Signed approval tokens from a manager's own device; manager credentials never on counters | A 4-digit PIN hash on a shared tablet is offline-brute-forceable |
| Scope shape | Schema for every module up front, features shipped in waves | Schema changes are the expensive ones to retrofit; features are not |

---

## 4. Tenancy and identity

**Hierarchy:** `account` (owner, pays) → `shop` (one cafe/outlet; unit of sync scope, RLS and pricing) → `devices`, `staff`.

**Who authenticates how**
- **Owner / manager:** real Supabase Auth account (email or Google). Dashboard, device enrolment, billing.
- **Device:** enrolled once by the owner via an edge function that creates a device identity. Its JWT carries `shop_id`, `device_id`, `role=device` in `app_metadata` (never `user_metadata`, which users can edit), injected by a custom access-token hook. Sync and RLS use this token.
- **Cashier / kitchen:** select themselves with a PIN on an enrolled device. Cashier and kitchen PINs are stored as salted slow hashes, synced with the shop's data, verified locally so login works offline, with lockout and backoff. A short PIN is only a convenience gate, because anyone who can read the local database can brute-force a 4-digit hash offline, so **owner and manager credentials are never synced to counter devices** (section 4.1). Every write records `staff_id` and `device_id`.

**Enforcement**
- Tenant isolation is a hard guarantee: RLS on `shop_id` from the JWT claim, indexed, using `(select auth.jwt())` so Postgres caches it; no per-row subqueries.
- Role permissions (refund, delete, price edit) are checked in the app and again in the upload path using the synced staff/permission rows.
- Revocation: issued tokens stay valid until expiry, so keep access tokens short-lived and have the upload RPC re-check `devices.revoked_at`.
- The service-role key is never in a client. `VITE_PUBLISH_TOKEN` is removed.

### 4.1 Memberships, approvals and PIN policy
- **Memberships.** `memberships(user, shop, role, active)` lets one person hold different roles in different shops (a manager covering two outlets). Roles and permissions are evaluated per shop.
- **Owner security.** Owner accounts require TOTP two-factor authentication. Enrolling or revoking a device, changing plans, and exporting all data require a recent MFA check.
- **Elevated actions need an approval.** Refund, void after the KOT was sent, discount above the shop limit, price override, and a no-sale drawer open each require an **approval token**. It is signed with a key held on a manager's own enrolled device, after the manager unlocks that device, and it names the action, the bill and a short expiry (for example 2 minutes) plus a nonce. The counter device verifies it against the managers' public keys, which are the only manager material it holds, and stores the token with the resulting event. Offline hand-off is by QR scan between the two devices. If no manager is reachable, low-risk actions queue as "pending approval" and never block a sale.
- **Deactivation lag.** A device that is offline keeps its last staff list, so bills made by a deactivated person after the deactivation time are flagged for review once synced.
- **Two rule sets, one behaviour.** PowerSync Sync Streams decide what a device may read, and Postgres RLS decides what it may write. An automated test asserts both agree, for every table, so they cannot drift.

---

## 5. Data model and sync

### Conventions
- IDs: UUIDv7 generated on the device, so offline creation needs no server.
- Money: integer paise (`bigint`) end to end, matching `calc.ts`; removes today's float / `numeric(10,2)` mismatch.
- Quantities: `numeric(12,3)` with a unit (pcs, kg, g, plate…), replacing today's integer `qty`, so weight-priced bakery and sweets items are exact. Line amounts are still rounded to whole paise.
- Tax is data, not code: rates, HSN/SAC codes and order-type rules are effective-dated rows, and each bill line snapshots the rule it used (section 10.1).
- Every bill carries `business_date`, computed in the shop's timezone with a configurable day cut-over.
- Every row: `shop_id`, `device_id`, `staff_id`, timestamps; soft delete via `deleted_at`.

### Two data classes, two conflict rules
| Class | Tables | Rule |
|---|---|---|
| Transactions (append-only) | `bills`, `bill_lines`, `bill_payments`, `bill_events`, `credit_notes`, `tab_lines`, `advance_payments`, `stock_movements`, `cash_movements`, `loyalty_ledger`, `credit_ledger`, `day_closes`, `audit_log` | Never edited after finalizing. Refund/cancel = new `bill_events` rows plus a credit note where tax applies (section 10.2). Uploads are `insert … on conflict do nothing`. No UPDATE/DELETE policies; a trigger also blocks updates. |
| Config (mutable) | `products`, `categories`, `staff`, `settings` | Server wins per row. A `rev` column rejects a stale edit with a visible message. Only owner/manager write. |

Consequences for the current app: `deleteBill` is removed (void, never delete); `refundBill` appends an event instead of mutating; held carts stay device-local drafts until finalized.

### Invoice numbering
Per-device series `{device}/{fy}/{seq}`, e.g. `T1/2627/000123` (14 chars). Unique on `(shop, device, fy, seq)`. Voided bills keep their number. A re-enrolled or restored device asks the server for its highest used number and continues. Series resets on 1 April. Kitchen tokens are separate and device-prefixed (`A-01`, `B-01`), so counters never clash. Online (QR) orders use a server-side virtual series `W/{fy}/{seq}`, allocated under a row lock in the same transaction that creates the bill, so it is gapless and needs no device. GST expects unique, consecutive serials of at most 16 characters per financial year — **confirm with a CA before launch**.

### Tables
- Platform: `accounts`, `shops`, `devices`, `plans`, `subscriptions`, `entitlements`, `webhook_events`, `payment_events`
- Catalog: `categories`, `products`, `product_costs`, `menu_publications`, `product_variants`, `modifier_groups`, `modifiers`
- Sales: `bills` (with `source`: till or qr), `bill_lines`, `bill_payments`, `bill_events`, `day_closes`, `invoice_series`
- QR ordering and kitchen: `qr_points`, `qr_orders`, `qr_order_lines`, `pending_orders`, `stations`, `category_stations`, `kots`, `order_events`
- Reporting/ops: `shop_daily_stats`, `audit_log`, `sync_errors`

`order_events` is append-only (about five rows per order, roughly 100 KB/day for a 200-order shop, negligible against the free quota) and feeds SLA and ETA analytics.

**Tables added by the operations review (sections 10–13)** — all created in Phase 1 (schema-first) even though features ship in waves:
- Identity and tax: `memberships`, `tax_profiles`, `tax_rules`, `credit_notes`, `approvals`
- Table service: `tables`, `tabs`, `tab_lines`
- Bakery and stock: `advance_orders`, `advance_payments`, `stock_items`, `stock_batches`, `stock_movements`, `wastage_entries`
- Pricing and cash: `charges`, `promotions`, `price_lists`, `availability_schedules`, `shifts`, `cash_movements`, `exceptions`
- Customers: `customers`, `loyalty_ledger`, `credit_accounts`, `credit_ledger`
- Channels and messaging: `channels`, `channel_orders`, `message_templates`, `message_log`, `consents`

Every migration includes explicit `GRANT`s (Supabase stops auto-exposing new `public` tables to the Data API from 30 Oct 2026) and RLS.

### Sync scoping (PowerSync Sync Streams)
- Each device syncs only its own shop's catalog, staff and settings.
- Sales sync a **rolling 90-day window**, bounding device size and the free sync quota. Older history and long-range reports come from server `shop_daily_stats`.
- `product_costs` syncs only to devices the owner marks "back-office", so a shared counter tablet does not carry margins.

### Free-tier fit
- Estimated ~1.5 KB per bill including lines and indexes (**to be measured in the spike**). At 200 bills/day that is roughly 110 MB/year/shop, so 500 MB holds only a handful of cafe-years.
- Retention: after about 13 months, bills move to compressed monthly archives in Storage; rollups stay in Postgres. Archive, never purge (GST record-keeping spans years).
- Diner status pages poll a cheap RPC instead of using Realtime (200 free concurrent connections shared by all cafes). Only staff use live sync.
- Bill uploads go through PostgREST/RPC with RLS, not edge functions (500k free invocations/month).

---

## 6. Subscriptions, entitlements and licence

**Two separate Razorpay flows**
1. *Operator subscription billing:* the operator's own Razorpay account, Razorpay Subscriptions, one subscription per shop. States: `trialing → active → past_due → suspended → cancelled`. The webhook handler verifies the HMAC on the raw body, records each event in `webhook_events` keyed on `x-razorpay-event-id` (idempotency), tolerates out-of-order delivery, and reconciles against the Razorpay API on ambiguity plus a nightly reconcile job.
2. *Diner payments:* each shop's own Razorpay keys (Vault-encrypted, used server-side) with a per-shop webhook secret; webhook URL scoped per shop.

**Entitlements** derive from the plan (device limit, staff limit, QR ordering, history window) and sync read-only.

**Licence lease.** The server issues each device a signed lease (default 14 days) refreshed on every sync, verified on-device against an embedded public key. The licence check uses the highest time ever seen, not the current clock.

**Lapse behaviour**
- `past_due`: 7-day grace, banner only.
- After grace: block new device enrolment and QR ordering; **the till keeps billing offline until the lease ends**.
- Lease expired: read-only with data export allowed.
- Downgrade over limit: flag oldest devices; never delete data.
- Uploads of bills, events and payments that were already created on a device are **never blocked** by a lapsed subscription. A cafe must not lose sales it already made.
- Cancellation: read-only export window, then archive.

---

## 7. Security and authorization summary
- RLS on every table; transactions are append-only at the database level; views use `security_invoker = true`.
- `SECURITY DEFINER` functions only in a non-exposed schema, each with an explicit `auth.uid()`/claim check.
- `backup-bills` is replaced by PowerSync upload; `publish-menu` becomes an RLS-guarded upsert from back-office devices. Remaining edge functions: `create-order`, `verify-payment` (per-shop; now also creates the bill and fires the KOT, section 9.3), `refund-order`, `enrol-device`, `subscription-webhook`. Diner order status is a rate-limited, cached RPC that returns minimal fields (token, status, items) and never personal data.
- QR `t=` links carry an HMAC-signed table token; pending orders are rate-limited per table and capped per shop.
- Design principle: **the server accepts and flags, and never rejects a completed sale.** A bill is refused only for tenant mismatch or a revoked device; anything else (over-limit discount, late bill for a closed day) is stored and raised for owner review.
- **Noisy-neighbour control** on the shared database: per-shop request rate limits, statement timeouts, bulk imports queued and chunked, and heavy reports served from `shop_daily_stats` rollups only.
- **Per-shop recovery.** Pooled tenancy means a whole-database backup cannot restore one cafe. Soft deletes, the audit log, a self-serve per-shop export and an operator-run per-shop restore tool cover "we deleted everything". Point-in-time recovery is added at go-live.

---

## 8. Client architecture

**Unchanged:** `calc.ts`, `receipt.ts`, `qr.ts`, `upi.ts`, `kot.ts`, permission rules, UI components, the 207 tests.

**Changed**
- Zustand keeps only UI state (cart, session, theme). Data comes from live SQL queries on PowerSync's client SQLite, with keyset pagination for bill history and indexed search.
- Pages depend on repository interfaces (`BillRepo`, `CatalogRepo`, `StaffRepo`), which contain the swap and enable the Option B fallback.
- Dashboard and reports use on-device SQL aggregates (90-day window) and server rollups beyond it.
- Product images move from base64 data URLs to Supabase Storage with content-hashed paths cached by the service worker; bundled seed photos stay in the app.
- First run: no fake seeded history and no demo PINs for real tenants. Onboarding wizard: create shop, set owner PIN, enrol device. Demo mode is optional and clearly labelled.
- Thanjai migration: a one-time importer reads Dexie, converts to paise, assigns the device series, excludes seeded demo history, and keeps Dexie until upload is confirmed.
- Distribution: installable PWA; request persistent storage; iOS eviction behaviour is tested in the spike.
- New surfaces for section 9: a kitchen display (KDS) page per station, a public token board page for a counter TV, the diner receipt page, and QR-point management in Settings (replacing the current table-QR generator).

---

## 9. QR self-ordering, KOT and pickup

**Requirement (client feedback).** In malls and large cafes, a diner scans a QR, sees that cafe's menu, orders and pays; the kitchen receives the KOT immediately, so nobody waits for a waiter or a cashier, and the customer effectively bills themselves.

**Assumption.** One QR set per cafe, counter or table. A single QR spanning many stalls is a non-goal (section 1).

**Market pattern (research).** Dine-in cafes use one QR per table. Food courts and counters use one QR per counter or brand, with a pickup token flashed on a display. The order fires to a KOT printer or kitchen screen, and the bill settles through the normal POS flow. Vendors report orders reaching the kitchen faster than waiter-taken orders. ([Petpooja scan-and-order guide](https://blog.petpooja.com/industry-business-guides/what-is-scan-and-order-qr-ordering-indian-restaurants/))

### 9.1 What exists, what changes
| Need | Today | Change |
|---|---|---|
| QR per table | Yes (`t=T04`) | Generalize to `qr_points` of type table / counter (pickup) / takeaway, each with an HMAC-signed token bound to `shop_id` |
| That cafe's menu | One global `menu_items` | Per-shop `menu_publications`, plus variants and modifiers (9.5) |
| Pay before the kitchen sees it | Yes; only the signed webhook writes `PAID` | Kept. Per-shop Razorpay keys (section 6) |
| KOT to the kitchen | Manual "Print KOT" button | Fires automatically on payment, per station (9.4) |
| Bill / invoice | Created on whichever till claims the order | Created server-side at payment (9.3) |
| Kitchen sees the order | Realtime plus 30 s poll | Enrolled kitchen devices receive it over the shop's sync stream and acknowledge it |
| Diner knows it is ready | Status page | Status page, token board, optional message (9.5) |

### 9.2 Order lifecycle
`PAID` (signed webhook) → `FIRED` (KOT created per station) → `ACKNOWLEDGED` (a kitchen device confirmed it has the ticket) → `PREPARING` → `READY` (token shown on the board, diner notified) → `COLLECTED` (pickup) or `SERVED` (dine-in).
Failure branches: `REJECTED` (item unavailable, refund), `UNACKNOWLEDGED` (no kitchen device confirmed within the timeout, alert), `EXPIRED` (uncollected).
Every transition appends an `order_events` row. The rule stands that nothing reaches the kitchen until `PAID`, and `PAID` is written only by the verified webhook.

### 9.3 Billing online orders on the server
The per-shop `verify-payment` handler, in one transaction: promotes the draft to an order; creates `bills`, `bill_lines` and `bill_payments` (method online/UPI, gateway payment id); allocates the `W` invoice number; creates one `kots` row per station; and appends `FIRED`. It uses the shared calculation module already in `supabase/functions/_shared/calc.ts`, with its parity test. Tills only display these bills. This removes today's dependency on an open till and the burned-invoice-number handling in `useOrderIntake`. If validation fails after money was captured, the order is held, the owner is alerted, and a refund is offered. It is never silently lost. The diner receives an unguessable receipt link (`/r/<token>`), printable from the browser.

### 9.4 Kitchen
- **Stations.** A `category_stations` mapping routes items to stations (for example kitchen, beverages/bar, bakery). Each station gets its own KOT.
- **KDS first.** A full-screen kitchen display for enrolled `kitchen` devices: audible alert on arrival, per-order elapsed timer, tap to bump to Preparing or Ready. It needs no printer.
- **Printing is optional and has three tiers.** (1) No printing, KDS only. (2) Dialog-less printing through the shared `PrinterPort` (section 11.7): **direct ESC/POS over WebUSB, Web Bluetooth or Web Serial** on Chrome/Edge (Android and Windows; not iOS), or the browser's kiosk-printing flag. Both reuse the existing `kot.ts` template and need verification in the spike. (3) A native print bridge (Tauri/Capacitor, ESC/POS to a LAN printer) as a later phase. Cloud print services such as [PrintNode](https://www.printnode.com/en) also work but are paid and need a local agent, so they are not planned for v1.
- **Acknowledgement.** The device that displays a ticket writes `ACKNOWLEDGED`. Two kitchen devices are safe: the acknowledgement is idempotent and the first bump wins.
- **Kitchen offline while the diner pays.** The diner pays over mobile data, so the order can be `PAID` while the cafe's internet is down and no kitchen device sees it. The diner's status reads "Paid, waiting for the kitchen to confirm". After a timeout (default 3 minutes) the order is flagged to the owner, with an optional per-shop auto-refund (off by default).
- **Load control.** A per-shop "busy" switch pauses new online orders, an optional cap limits open orders, and sold-out items stop being orderable within seconds. ETA is computed from open orders per station and average prep time from `order_events`.

### 9.5 Diner experience (no account)
- Scan → that shop's menu (veg/non-veg marker, images, variants, add-ons, notes) → cart → Razorpay Checkout with UPI intent first. No sign-in, consistent with the current design.
- The order page URL contains an unguessable id and is remembered in the phone's storage; the token (for example `A-12`) is shown large. A phone number is collected only if the shop turns on messaging, with consent text.
- **Order types** per QR point: dine-in (table), pickup (counter token), takeaway.
- **Ready notification.** The free baseline is the live status page plus a public **token board** page for a TV at the counter (Preparing / Ready tokens). Optional per-shop add-ons: Web Push (free, but on iOS it works only for installed home-screen apps, so unreliable for diners); WhatsApp utility messages (reported at roughly ₹0.11–0.80 per conversation); SMS (reported at roughly ₹0.15–0.20, and India SMS needs sender and template registration). ([cost comparison](https://richautomate.in/blog/whatsapp-business-api-vs-sms-cost-india-2026)) I recommend the baseline first and WhatsApp as a paid add-on later, with its cost passed through in plan pricing.
- **Menu depth for big cafes.** Add `product_variants` (S/M/L, each with its own price) and `modifier_groups`/`modifiers` (single or multi-select, min/max, price delta). A bill line snapshots the chosen options, with the delta included in the line price under the item's tax slab, and `calc.ts` stays the single shared implementation for till and server. This is not in the current product plan, so it is called out as scope.

### 9.6 Payments and fees
Diners pay through the cafe's own Razorpay account. Razorpay's own pricing pages state that UPI carries zero network MDR but the gateway charges a platform fee of about 2% + GST per transaction (verify the rate on the cafe's account). News reports in September 2026 also describe a 0.4% MDR on person-to-merchant UPI payments above ₹2,000 from 15 October, capped at ₹300; most cafe orders are below that. ([Razorpay UPI charges](https://razorpay.com/learn/upi-transaction-charges/), [PYMNTS report](https://www.pymnts.com/news/payment-methods/2026/india-brings-merchant-fees-to-popular-upi-payment-system)) The fee is the cafe's cost. A per-shop `pass_fee_to_customer` (convenience fee) setting is possible, defaults to off, and needs a tax/legal check first. An optional "pay at counter" mode (the order is held and the KOT fires when a cashier confirms) exists as a per-shop flag, off by default, because prepayment is what guarantees no walk-outs.

### 9.7 Abuse and load at mall scale
- QR tokens are HMAC-signed per QR point. `create-order` is rate-limited per QR point and per IP; pending drafts are capped per shop and purged when stale.
- A fake sticker pasted over a real QR is outside the system's control. Mitigate by showing the verified shop name and logo on the menu and checkout, using tamper-evident stickers, and using a short branded domain.
- Capacity: each order costs about two edge-function calls (`create-order` and the webhook), so the free 500k monthly invocations allow on the order of 250,000 orders. Status polling goes through a cached RPC, not edge functions. The realistic bottleneck on the free plan is the shared-CPU database at a rush, so Phase 3 includes a mall-peak load test (for example 30 orders in one minute for one shop).

### 9.8 Edge cases for QR self-ordering
| Case | Handling |
|---|---|
| Diner pays, kitchen device offline | Status "waiting for the kitchen", owner alert after 3 minutes, optional auto-refund |
| Item runs out after payment | Kitchen marks it unavailable; partial refund through `refund-order` (Razorpay refund API) with a reason and diner notice |
| Limited stock (for example 10 cakes) | Optional `stock_qty` decremented atomically in `create-order`, so no oversell |
| Double tap or pays twice for one cart | Payment is bound to the draft; a second capture is flagged and auto-refunded |
| Diner closes the page after paying | Order URL kept in storage; staff can look up by token or the last digits of the payment id |
| Prices or modifiers change between viewing and paying | Price locked at `create-order`; the diner sees the updated total before paying |
| Shop closed, busy or out of hours | Menu shows closed; `create-order` rejects with a clear message; in-flight payments still complete |
| Ready order is never collected | Reminder, then `EXPIRED` after a configurable time (default 30 min); no auto-refund because the food was made |
| Refund after cooking started | Owner-only, recorded as an append-only event |
| QR point disabled or token forged | `create-order` rejects it |
| Another diner reads an order | Orders have no public read; only the minimal status RPC exists, keyed by an unguessable id |
| Webhook delivered twice | Idempotent on the gateway payment id (already true today) |

---

## 10. Tax, compliance and payment integrity

### 10.1 Data-driven tax
- `tax_profiles` per shop: regime (regular, composition, unregistered), GSTIN, state, FSSAI licence number.
- `tax_rules`: HSN/SAC code, applicable order types (dine-in, takeaway, delivery, any), rate, cess, `valid_from`/`valid_to`. Products reference an HSN/SAC and a tax class. Cafe and bakery presets ship as **editable defaults with a source date**, never as hard-coded rates.
- Each bill line snapshots the rule used, the taxable value, and the CGST/SGST (intra-state) or IGST (inter-state B2B) amounts. Composition and unregistered shops issue a bill of supply with no tax lines. Tax-inclusive and exclusive pricing stay supported.
- The **order type is set when items are added, but tax is computed at settlement**. If a diner switches from dine-in to takeaway, the bill is re-taxed, since the treatment can differ between restaurant service and goods.
- Why this matters: sources report that cakes and pastries moved to 5% from 22 September 2025, that bread is nil-rated, that dine-in is restaurant service at 5% without input credit, and that a bakery selling only goods may use HSN rates or the composition scheme ([Masters India](https://www.mastersindia.co/blog/gst-on-bakery-products-cakes-pastries-biscuits/), [Busy](https://busy.in/gst-rates/bakery-products/)). **A CA must confirm the defaults before launch.**

### 10.2 Credit notes and amendments
Refunds and price reductions after an invoice produce a **credit note** in its own series (`C/{fy}/{seq}` per device, `WC/…` for online), linked to the original bill, plus the payment refund event. A correction (wrong payment mode, GSTIN added later, wrong item) is a cancel-with-credit-note and a reissued invoice carrying `amends_bill_id`. Nothing is edited in place. Time limits and formats follow the CA's advice.

### 10.3 Verified UPI at the till
Walk-in UPI is currently confirmed by the cashier tapping "paid". That is exactly what fake payment-screenshot scams exploit ([Razorpay](https://razorpay.com/learn/fake-payment-screenshot-scam/)); only a gateway callback, soundbox or your own bank credit is proof.
- At the payment step the till asks a `create-till-payment` function (using the shop's own Razorpay keys) for a **per-bill dynamic QR or payment link**, shown on the cashier screen and any customer-facing display. The webhook writes a verified `bill_payments` row carrying the gateway id, and the till learns of it over the sync stream.
- Three modes, recorded on the payment: `verified` (gateway), `manual` (cashier attests, for example from a soundbox, and must enter a reference; appears in the exception report), and `offline_unverified` (no internet, reconciled by the owner later).
- Per-shop policy: require verified UPI above a set amount, or always.
- Offline UPI can never be verified at the moment of sale. That is inherent, and the design makes it visible instead of hiding it.

### 10.4 B2B invoices and identifiers
A bill can carry a buyer name, GSTIN and address, with IGST when inter-state. The FSSAI licence number is printed on receipts and invoices (rule to be verified). Invoice and receipt language is selectable (English or Tamil).

---

## 11. Cafe and bakery operations

### 11.1 Table service
- `tables` (zone, seats) and `tabs`. A tab is a set of **append-only `tab_lines` events** (add, void, transfer, merge). Two waiters adding to one table offline merge by simple union, with no edit conflicts, and totals are derived.
- Each fired line produces a **delta KOT**, so the kitchen sees only the new items. Voiding an item after firing requires an approval (section 4.1) and shows a cancelled line on the KOT.
- Settlement creates the bill(s). **Split** by item, person or equal shares; **merge** and **transfer** tables as events.
- A prepaid QR order for a table with an open tab stays a separate bill by default, with an optional merge.

### 11.2 Bakery pack
- **Weight and units.** Decimal quantities (section 5) and price per unit; weight captured from a connected scale (11.7) or typed. Barcode labels for loose and packed goods.
- **Advance and custom orders.** `advance_orders` capture flavour, size or weight, cake message, reference photo, pickup/delivery date and time, discount and notes. `advance_payments` are append-only receipts in their own series. The balance is collected at pickup, and the final invoice consumes the advances (**tax timing on advances: CA to confirm**). Cancellation rules are per shop (forfeit or refund percentage).
- **Batch and expiry.** Optional per product: batches with production date, MRP and expiry, first-expiry-first-out deduction, and alerts ahead of expiry so items can be pushed on offer.
- **Production sheet.** A daily bake list built from advance orders plus per-item par levels.

### 11.3 Stock-lite
`stock_items` (finished goods; ingredients can come later), append-only `stock_movements` (sale, receipt, adjustment, wastage, production) with a reason, and derived on-hand. Opening and closing counts, low-stock alerts, and automatic **sold-out** at zero. QR limited-stock is decremented atomically on the server. Offline tills can drive stock negative, which is accepted and flagged, then reconciled at day end. Recipes and purchasing remain out of scope.

### 11.4 Pricing and charges engine
`charges` (service charge, packaging, delivery), tips (post-bill and untaxed), `promotions` (coupon codes, combos and bundles, buy-one-get-one, happy-hour windows, minimum order), `price_lists` per order type, channel or zone, and `availability_schedules` (breakfast menu). Everything evaluates in the **shared `calc.ts` on both client and server**, with the parity tests extended. Precedence is fixed and documented: item price → price list → promotion (default: best single promotion, configurable stacking) → manager-limited discount → charges → tax → round-off. Service charge is optional and shown on the bill as voluntary.

### 11.5 Cash control and loss prevention
`shifts` (per cashier per device, with opening float and a blind closing count), `cash_movements` (paid-in, paid-out, expenses, cash drops, each with a reason), and day close aggregating shifts. An **exceptions report** built from the append-only events lists: voids after payment, discounts above a threshold, refunds by staff, no-sale drawer opens, manual or unverified UPI, and bills by deactivated staff.

### 11.6 Customers, loyalty and credit accounts
- `customers` (phone unique per shop), attached to a bill optionally, with consent flags.
- Loyalty is an append-only points ledger (earn and redeem) plus coupons.
- **Credit accounts** ("khata") for regulars and offices: a credit limit, ledger, statements and ageing. A credit sale creates a normal bill with payment method `credit`, and later payments settle the account.
- Privacy: collect only what is needed, log consent, and support deletion or anonymization on request while keeping tax records.

### 11.7 Hardware
A single **`PrinterPort`** interface with interchangeable back ends: (a) the browser print dialog (default and universal); (b) direct ESC/POS over WebUSB, Web Bluetooth or Web Serial on Chrome/Edge for Android and Windows (HTTPS and a user gesture required, works offline after permission is granted, not available on iOS) ([example](https://github.com/yunarmedia/YUPOS)); (c) kiosk-printing where the dialog is suppressed; (d) a native bridge later. On Windows a vendor driver may claim the printer and block WebUSB, so support is decided per printer model in the spike. The same port kicks the **cash drawer** through the printer and prints label templates for bakery items. Barcode scanners work as keyboard input and through the camera. Scales connect via Web Serial or HID adapters (model-specific, list decided in the spike). A **customer-facing display** shows the cart and the dynamic UPI QR. A supported-hardware matrix is published per device type.

### 11.8 Reports and exports
GST summaries by rate, HSN and order type; sales by item, category, hour, staff, channel and shift; stock and wastage; credit-account ageing; the exceptions report; an owner daily summary by email or WhatsApp. Exports as CSV and Excel, and an accounting export (Tally-compatible format to be verified).

### 11.9 Fast onboarding
A sign-up wizard: choose a business type preset (cafe, bakery, quick-service) that seeds categories, units, editable tax rules and a receipt template; **CSV/Excel menu import** with validation and a dry run; **AI photo-to-menu import**, where a photo of a printed menu is read by a model on the server and always shown to a human for review before anything is published (images are processed transiently, and never used to train anything); device enrolment; and a test bill. **Target: first real bill within 30 minutes of sign-up.**

---

## 12. Channels, growth and AI

### 12.1 Order channels
`channels` and `channel_orders` normalize external orders into the same server-side pipeline as QR orders (section 9.3): a bill on the `W` series, a KOT fired automatically, and `order_events` recorded. Channels: till, QR, phone, WhatsApp, and aggregators (Swiggy, Zomato, ONDC, magicpin). Menu and availability sync outward where a platform supports it, commissions are recorded as an expense line, and each channel can have its own price list. Sources say modern POS systems integrate directly with these platforms so orders land with an automatic KOT ([E-Cybertech](https://www.ecybertech.com/blog-restaurant-pos-india-2026-guide)). Each aggregator gets its own adapter spec, and the integration route (a partner or middleware versus direct API) is verified per platform.

### 12.2 WhatsApp commerce and marketing
Opt-in only, with consent logged. Template messages for order ready, receipt, loyalty and birthday; ordering through a WhatsApp Business catalogue that feeds the same order pipeline. It uses a WhatsApp Business provider, with per-message costs passed through in plan pricing ([cost comparison](https://richautomate.in/blog/whatsapp-business-api-vs-sms-cost-india-2026)).

### 12.3 AI assistance
- Photo-to-menu import (11.9).
- **Demand forecasting and prep suggestions** from `order_events` and sales history: suggested bake or prep quantities by day and hour, and low-stock reorder hints.
- **Voice phone-ordering**, later and heavier.
- Guardrails: no customer personal data sent to models, human confirmation on anything that changes the menu, prices or stock, forecasts computed from server rollups, and a per-shop cost cap.

---

## 13. Legal, trust and non-functional requirements

### 13.1 Legal and trust pack
Terms of service, privacy policy, a data-processing agreement (the operator processes cafes' customer data), subscription refund and cancellation policy, acceptable-use policy, and an SLA statement (best effort until on paid infrastructure). Self-serve data export, account deletion with tax-record retention exceptions, consent logs, a breach-notification procedure, and a grievance contact for India's DPDP obligations. **Lawyer and CA review before charging anyone.**

### 13.2 Non-functional targets (proposed; confirm after a device survey of real cafes)
- **Billing hot path** on a baseline device (a low-end Android tablet, a Windows 10 PC with 4 GB RAM): add item under 100 ms, complete bill under 300 ms, first page of history under 200 ms, cold start under 3 seconds.
- **Recovery:** RPO up to 24 hours (nightly dump during the pilot, then daily backups on Pro), tightening with point-in-time recovery as volume justifies; RTO up to 4 hours.
- **Availability:** best effort during the pilot; a stated target once paid infrastructure and monitoring exist.
- **Accessibility and language:** touch targets of at least 44 px, adequate contrast, English and Tamil UI, and a menu and receipt language chosen per shop.
- **Security:** owner MFA, audit trail on all privileged actions, and an external security test before go-live.
- A supported-device and browser matrix, decided from the device survey.

### 13.3 Support and operability
An operator console showing per-tenant and per-device status (last sync, pending count, app version), impersonation only with owner consent and a full audit log, feature flags per plan or shop, staged rollout using `min_client_version`, in-app announcements, error tracking (client errors to `sync_errors` or an external tool), and a public status page.

### 13.4 Unit economics
| Cost | Type | Note |
|---|---|---|
| Supabase Pro ($25) and PowerSync Pro ($49) | Fixed | About $74/month from go-live |
| Domain, custom SMTP (the free auth email limit is 2 per hour), error monitoring | Fixed | Needed before the first external cafe |
| Storage, egress, database growth | Variable per shop | Measured in the spike |
| Razorpay fee on your own subscription (about 2% + GST, verify) | Variable | Comes out of plan revenue |
| WhatsApp/SMS, AI calls | Variable | Passed through or capped per shop |

Plan prices are set from this table (open item).

---

## 14. Edge-case catalogue

| Area | Case | Handling |
|---|---|---|
| Sync | Duplicate / partial upload | Insert on primary key; mark synced only confirmed ids |
| | Captive-portal Wi-Fi | Health = successful round trip, not `navigator.onLine` |
| | Wrong device clock | Server stamps `received_at`; warn when the device clock differs by more than 5 minutes; licence uses highest time seen |
| | Wipe/logout with unsynced bills | Block clear-data/logout while pending > 0; always show pending count |
| | Two tabs on one device | PowerSync shared worker; invoice counter allocated in one transaction |
| | App update mid-shift | Defer prompt until idle; server publishes `min_client_version`; force only when nothing pending |
| | Slow first sync | Catalog first, then sales |
| Billing | Price changed mid-bill | Line price locked when added; past bills are snapshots |
| | Product archived on another device | Soft delete; open cart can finish with a warning |
| | Refunds | Partial refunds must sum ≤ total (trigger); refunds are events |
| | Refund after day close | Recorded as an event in the current day; closed days never reopen |
| | Rounding | One shared calc client/server, paise only, parity test kept |
| | Split payment / tip | Separate `bill_payments` rows and a round-off line |
| | UPI confirmed on trust | Optional UTR reference now; verified dynamic QR via the cafe's Razorpay later |
| | Day close with several devices | Per-device cash drawer plus shop rollup; warn on other devices' unsynced bills; late bills flagged, never silently added |
| | Financial-year rollover | Series resets 1 April; a bill made before midnight and synced later keeps its FY |
| Security | Stolen device | Remote revoke, lease lapses, wipe on next contact |
| | PIN brute force | Lockout and backoff; owner-only reset |
| | Ownership transfer / staff leaves | Deactivate, don't delete; audit trail keeps the id |
| | Stale claims | Short JWT lifetime plus server-side revoke check |
| Subscription | Duplicate/missed/out-of-order webhook | Event ledger plus nightly reconcile |
| | Card fails mid-cycle | `past_due` grace; till never blocked |
| | GST invoices for the operator's own subscription | Collect the cafe's GSTIN; confirm with a CA |
| QR orders | Payment captured, no order visible | Reconciliation queue in the owner UI |
| | Order sits unclaimed | Alert after 5 minutes (per-shop setting) |
| | Two tills or kitchen devices act on one order | No till claims orders any more (bills are created server-side); kitchen acknowledgement is idempotent and the first bump wins |
| | Shop suspended | QR page says "not accepting orders"; in-flight payments still complete |
| | Menu changes during payment | Price locked at `create-order` |
| Data | Free-tier growth | Archive after about 13 months; keep rollups |
| | Supabase paused/unreachable | Behaves as offline; alert the operator |
| | Customer phone numbers | Consider India's DPDP Act: retention limit, deletion on request, export |

### Combination scenarios
Failures usually come from two features meeting. Each row is a required test case.

| Combination | Required behaviour |
|---|---|
| Prepaid QR order for table T4 while a cashier's open tab exists on T4 | Separate bills by default with an optional merge; both KOTs show the table |
| Split bill (verified UPI + cash), then a partial refund after day close | Refund apportioned across the payment methods and recorded as an event and credit note in the current day; a closed day is never reopened |
| Happy hour ends while a cart is open, or a held bill is resumed next day | The price is locked when the item is added; held bills expire at day close and appear in a report |
| A tax rule changes mid-day with held bills and open QR carts | Tax is computed at finalization by effective date; QR carts stay locked at `create-order` |
| Custom cake with advance, discount at pickup, then cancellation | Advance-receipt ledger kept separate from the invoice; the final invoice consumes the advance; cancellation follows the shop's forfeit/refund rule (tax timing per CA) |
| Dine-in switched to takeaway mid-order | Re-taxed at settlement using the order-type rule |
| Weight item, scale reading offline, price per kg edited on another device | The line snapshots weight and unit price at sale; a later price edit never changes past bills |
| Subscription lapses with unsynced offline bills and QR payments in flight | Uploads of existing records are never blocked; new QR orders are refused; in-flight payments complete |
| A tablet dies holding unsynced bills | Devices report pending counts in a heartbeat; the owner is alerted when a device goes silent with pending items |
| Two offline tills both sell the last slices of a cake | Stock is eventually consistent; negative stock is accepted and flagged; QR limited stock stays server-atomic |
| Refund of a QR order when the cafe's Razorpay balance is short, or a chargeback arrives | The refund is queued with an alert; dispute events flag the bill and appear on the owner dashboard |
| A staff member is deactivated while a device is offline | Bills after the deactivation time are flagged for review after sync |
| A corporate customer gives a GSTIN after payment | Cancel with credit note and reissue a B2B invoice within the allowed window (CA to confirm) |
| Verified UPI requested while the till is offline | The payment records as `offline_unverified` and enters the owner's reconciliation list |
| Approval needed offline and no manager present | Low-risk actions queue as pending approval; high-risk actions are blocked; the sale itself is never blocked |
| Financial year rolls over with an advance order created on 31 March and delivered in April | The final invoice takes the new financial year's series; the advance receipt keeps the old one |

---

## 15. Operations

**Free-tier limits (official pages, September 2026):** Supabase Free — 500 MB database (shared CPU, 500 MB RAM), 1 GB storage, 5 GB egress, 500k edge invocations, 200 concurrent Realtime connections, 2 active projects, **no automatic backups**, paused after 1 week of low activity, 1-day log retention. PowerSync Free — 50 concurrent clients, 2 GB synced/month, 500 MB hosted, deactivated after a week of inactivity.

**Free tier is for build and pilot, not for selling.** Pilot stopgaps: nightly encrypted `pg_dump` via a scheduled GitHub Action (through the pooler; direct connections moved to IPv6), an uptime ping, errors written to `sync_errors`, and the Supabase advisors run on every migration.

**Go-live trigger: upgrade before the first external paying cafe**, or earlier if the database passes about 350 MB, concurrent clients approach 40, or egress passes about 4 GB. Supabase Pro is $25/month (daily backups) and PowerSync Pro $49/month, about $74/month fixed.

**Environments:** production plus dev/staging use both free project slots. Migrations are code under `supabase/migrations`, applied with `supabase db push` from CI.

**Testing:** database tests that attempt cross-tenant reads and writes and must fail; the client/server calc parity test; sync chaos tests (duplicate uploads, partial batches, clock skew); Playwright e2e from `.verify/`; a backup **restore drill** before go-live.

---

## 16. Rollout

### Phase 0 — harden the current app (no restructuring)
1. Rotate the exposed live Razorpay secret.
2. Do not deploy `publish-menu` / `backup-bills` to a public URL until Phase 1 replaces them (or use Vercel deployment protection).
3. Rate-limit `create-order` and tighten CORS.
4. Move the schema to migrations-as-code (fix the missing `0003`; retire root `apply-migrations*.sql`).
5. Optional quick win for the Thanjai pilot, small and independent of the restructuring: fire the KOT automatically when a `PAID` order arrives on the kitchen screen, reusing `printKot`, with the browser's kiosk-printing mode on the kitchen device so no dialog appears. This gives the client a working "pay → KOT" demonstration now.

### Spike (2–3 days, throwaway branch, free Supabase + free PowerSync)
Passes only if tests 1–5 all hold; failure of any of 1–4 falls back to custom sync on Dexie (Option B).

| # | Test | Pass condition |
|---|---|---|
| 1 | PowerSync web SDK in the Vite 8 / React 19 app | Builds and syncs |
| 2 | Persistence on Android Chrome, Windows Edge PWA, iOS Safari (home-screen) | Data survives restart, offline use and a week idle; persistent storage granted |
| 3 | Two test shops, claim from the access-token hook | Each device syncs only its own shop; cross-tenant upload rejected by RLS |
| 4 | Two devices create bills offline, then reconnect | No duplicates or losses; per-device series unique |
| 5 | 100k seeded bills on a low-end Android | Proposed: first history page < 200 ms, today's dashboard < 300 ms; measure real bytes per bill vs 1.5 KB |
| 6 | Kitchen printing: Chrome/Edge kiosk-printing on a Windows kitchen PC, and Android Chrome | Prints a KOT with no dialog, or we fall back to KDS-only for that platform |
| 7 | Direct ESC/POS over WebUSB, Web Bluetooth and Web Serial on Windows and Android with the printers cafes commonly own, including cash-drawer kick | Prints and kicks the drawer for the tested models, or that model is marked "browser print only" |
| 8 | Verified UPI: per-bill dynamic QR or link with webhook confirmation on a test Razorpay account | Confirmation reaches the till within a few seconds online; offline records `offline_unverified` |
| 9 | Record only | WAL growth on an idle instance, `pg_cron` on free, UPI AutoPay recurring limit |

### Phases (each ends at a gate the owner approves)
| Phase | Scope | Size | Gate |
|---|---|---|---|
| 1. Foundation | Tenant schema, RLS, access-token hook, device enrolment, memberships, owner MFA, approval tokens, PIN policy, migrations and CI, cross-tenant DB tests **plus the schema for every in-scope module** (tax rules, credit notes, decimal quantities, tabs, stock, advances, channels; tables created early, features later) and the Sync Streams vs RLS agreement test | L | Isolation and agreement tests pass |
| 2. Client data layer | Repository seam, PowerSync swap, SQL reports, Storage images, invoice series, onboarding wizard, Thanjai importer; the data-driven tax engine and decimal quantities in `calc.ts` with extended parity tests; credit notes; `PrinterPort` with the browser-print back end | L | 207 tests + e2e pass; Thanjai runs on it as the pilot with nightly backups |
| 3. Multi-device and QR self-ordering | Second till live, per-device day close; **QR self-ordering (section 9):** `qr_points` (table/counter/takeaway), per-shop menu with variants and modifiers, bring-your-own Razorpay keys, **verified UPI at the till (section 10.3)**, server-side online billing on the `W` series, stations and KDS with acknowledgement, auto-fired KOT (optional kiosk-print), token board, refund flow, busy/sold-out controls, reconciliation queue | **L** | Two-device chaos tests pass; a mall-peak load test (for example 30 orders in a minute) meets the latency targets; a paid order with no till open still gets a bill and a KOT |
| 4. SaaS layer | Plans, Razorpay Subscriptions, entitlements, leases, operator admin console with consent-based impersonation and feature flags, owner remote dashboard, **legal and trust pack (13.1), unit-economics and plan pricing (13.4)** | M–L | Webhook replay and out-of-order tests pass; legal pack reviewed |
| 5. Go-live | Upgrade to paid tiers, load test, restore drill, per-shop restore tool, external security test, GST/CA and DPDP review, beta with 2–3 cafes | M | Restore drill succeeds; beta cafes live |

### Post-beta waves
The schema for all of these exists from Phase 1, so each wave adds features and never migrations of historical bills. **Decision (2026-09-20): Wave A ships first**, then B, C, D in the order below (open item 11).

| Wave | Scope | Size |
|---|---|---|
| A. Cafe operations | Table service (11.1), pricing and charges engine (11.4), cash control and loss prevention (11.5), GST reports and exports (11.8) | L |
| B. Bakery | Weight billing and scale, advance/custom orders, stock-lite with batch/expiry/wastage, label printing, direct ESC/POS and cash-drawer hardware (11.2, 11.3, 11.7) | L |
| C. Growth | Customers, loyalty and credit accounts (11.6), fast onboarding with CSV and photo-to-menu import (11.9), WhatsApp commerce and marketing (12.2) | L |
| D. Channels and AI | Aggregator and ONDC adapters (12.1), demand forecasting and prep suggestions, voice ordering (12.3) | L |
| Later | Capacitor/Tauri wrappers, native print bridge, LAN hub, multi-stall mall QR with split settlement | — |

---

## 17. Open items
1. Confirm bring-your-own Razorpay keys for diner payments (versus Razorpay Route).
2. Plan tiers and per-shop pricing.
3. CA review: GST invoice series format and subscription invoicing. Legal review: DPDP.
4. Choose the 2–3 beta cafes.
5. Measure in the spike: bytes per bill, `pg_cron` on free, UPI AutoPay recurring limit, WAL growth, kiosk-printing behaviour.
6. Diner ready-notification channel and pricing: free baseline only for v1, or offer WhatsApp/SMS as a paid add-on from the start?
7. Gateway fee handling: cafe absorbs it, or an optional convenience fee (needs a tax/legal check)?
8. "Pay at counter" mode: ship in v1 or leave out (prepayment only)?
9. Confirm scope: one QR set per cafe (assumed) versus a multi-stall mall QR.
10. Confirm variants and modifiers are in scope for the big-cafe requirement (they are not in the current product plan).
11. **Beta segment and wave order: decided 2026-09-20 — Wave A (cafe operations) ships first,** then B, C, D. Bakery features (Wave B) follow; the Phase 1 schema already includes their tables, so nothing is retrofitted.
12. CA review of: the tax defaults, credit notes and amendments, tax timing on advances, service charge presentation, invoice series, and subscription invoicing. Verify the FSSAI-on-invoice requirement.
13. Aggregator route per platform (partner or middleware versus direct API) and the WhatsApp Business provider.
14. AI photo-to-menu provider, data-handling terms and per-shop cost cap.
15. A device survey of the real cafes (tablets, PCs, printers, scales) to fix the supported-device matrix and the non-functional targets.
16. Whether a customer-facing display is needed for the beta.

## 18. Risks
- **PowerSync fit** (web SDK, iOS storage): mitigated by the spike and the Option B fallback behind the repository seam.
- **Data-layer rewrite** (Phase 2 is the largest): mitigated by keeping `calc.ts`, UI and tests, and by the feature-parity gate.
- **Free-tier pause or no backups**: acceptable for the pilot only; go-live trigger in section 15.
- **Cross-device outage gap**: with cloud-only sync, devices in one shop cannot see each other's orders while the internet is down. Accepted for v1; LAN hub is the planned answer.
- **Scope breadth.** The spec now covers a full cafe-plus-bakery product. Mitigated by schema-first design, waves with gates, and choosing the beta segment early. The main danger is trying to ship several waves before the first beta.
- **Tax and compliance correctness.** Rates and rules change and vary by how an item is sold. Mitigated by data-driven, effective-dated tax with per-line snapshots and CA sign-off, but a wrong default still produces wrong invoices, so it is a launch gate.
- **Hardware variety.** Web printing, scale and drawer support differ by model and OS. Mitigated by the `PrinterPort` abstraction, a published support matrix, and browser print as the universal fallback.

---

## Appendix A. Review log (2026-09-20)
| Finding | Addressed in |
|---|---|
| W1 Walk-in UPI on trust | 10.3 |
| W2 Refunds need credit notes; amendments | 10.2 |
| W3 Thin tax model | 10.1, section 3 |
| W4 Integer quantity | section 5 conventions |
| W5 PIN hashes and manager credentials on counters | 4, 4.1 |
| W6 Per-cafe restore under pooled tenancy | section 7 |
| W7 Noisy neighbour | section 7 |
| W8 Read/write rule drift | 4.1 |
| W9 Memberships, non-functional targets, older bills | 4.1, 13.2 |
| W10 Incomplete cost model | 13.4 |
| Missed requirements (table service, bakery, stock, pricing, cash, customers, reports, onboarding, legal) | 11, 13 |
| Trends (aggregators, WhatsApp, AI, kiosk) | 12, 9.5 |
| Combination edge cases | section 14 |
