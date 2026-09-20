# Cafe Billing SaaS — Multi-Tenant, Offline-First Design

**Date:** 2026-09-20
**Status:** Design approved in conversation; revised 2026-09-20 to add the mall-style QR self-ordering requirement (section 9); awaiting written-spec review
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

### Non-goals (this spec)
- A single QR listing many stalls in a mall (marketplace with split settlement). This spec covers one QR set per cafe/counter/table. The account → shop hierarchy does not preclude a later marketplace layer.
- Plan tiers and per-shop pricing (separate decision).
- Native wrappers (Capacitor/Tauri), direct ESC/POS printing, and a LAN hub for cross-device sync during internet outages. Planned as later phases; the data model does not preclude them.
- Inventory, recipes, purchases (already deferred by the current product plan §29).

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

---

## 4. Tenancy and identity

**Hierarchy:** `account` (owner, pays) → `shop` (one cafe/outlet; unit of sync scope, RLS and pricing) → `devices`, `staff`.

**Who authenticates how**
- **Owner / manager:** real Supabase Auth account (email or Google). Dashboard, device enrolment, billing.
- **Device:** enrolled once by the owner via an edge function that creates a device identity. Its JWT carries `shop_id`, `device_id`, `role=device` in `app_metadata` (never `user_metadata`, which users can edit), injected by a custom access-token hook. Sync and RLS use this token.
- **Cashier / kitchen:** select themselves with a PIN on an enrolled device. PINs are stored as salted hashes, synced with the shop's data, verified locally so login works offline, with lockout and backoff. Every write records `staff_id` and `device_id`.

**Enforcement**
- Tenant isolation is a hard guarantee: RLS on `shop_id` from the JWT claim, indexed, using `(select auth.jwt())` so Postgres caches it; no per-row subqueries.
- Role permissions (refund, delete, price edit) are checked in the app and again in the upload path using the synced staff/permission rows.
- Revocation: issued tokens stay valid until expiry, so keep access tokens short-lived and have the upload RPC re-check `devices.revoked_at`.
- The service-role key is never in a client. `VITE_PUBLISH_TOKEN` is removed.

---

## 5. Data model and sync

### Conventions
- IDs: UUIDv7 generated on the device, so offline creation needs no server.
- Money: integer paise (`bigint`) end to end, matching `calc.ts`; removes today's float / `numeric(10,2)` mismatch.
- Every bill carries `business_date`, computed in the shop's timezone with a configurable day cut-over.
- Every row: `shop_id`, `device_id`, `staff_id`, timestamps; soft delete via `deleted_at`.

### Two data classes, two conflict rules
| Class | Tables | Rule |
|---|---|---|
| Transactions (append-only) | `bills`, `bill_lines`, `bill_payments`, `bill_events`, `day_closes`, `audit_log` | Never edited after finalizing. Refund/cancel = new `bill_events` rows. Uploads are `insert … on conflict do nothing`. No UPDATE/DELETE policies; a trigger also blocks updates. |
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
- Cancellation: read-only export window, then archive.

---

## 7. Security and authorization summary
- RLS on every table; transactions are append-only at the database level; views use `security_invoker = true`.
- `SECURITY DEFINER` functions only in a non-exposed schema, each with an explicit `auth.uid()`/claim check.
- `backup-bills` is replaced by PowerSync upload; `publish-menu` becomes an RLS-guarded upsert from back-office devices. Remaining edge functions: `create-order`, `verify-payment` (per-shop; now also creates the bill and fires the KOT, section 9.3), `refund-order`, `enrol-device`, `subscription-webhook`. Diner order status is a rate-limited, cached RPC that returns minimal fields (token, status, items) and never personal data.
- QR `t=` links carry an HMAC-signed table token; pending orders are rate-limited per table and capped per shop.
- Design principle: **the server accepts and flags, and never rejects a completed sale.** A bill is refused only for tenant mismatch or a revoked device; anything else (over-limit discount, late bill for a closed day) is stored and raised for owner review.

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
- **Printing is optional and has three tiers.** (1) No printing, KDS only. (2) Auto-print on a kitchen Windows PC or tablet running Chrome/Edge with its kiosk-printing flag, which skips the print dialog (**verify in the spike**), reusing the existing `kot.ts` template. (3) A native print bridge (Tauri/Capacitor, ESC/POS to a LAN printer) as a later phase. Cloud print services such as [PrintNode](https://www.printnode.com/en) also work but are paid and need a local agent, so they are not planned for v1.
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

## 10. Edge-case catalogue

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

---

## 11. Operations

**Free-tier limits (official pages, September 2026):** Supabase Free — 500 MB database (shared CPU, 500 MB RAM), 1 GB storage, 5 GB egress, 500k edge invocations, 200 concurrent Realtime connections, 2 active projects, **no automatic backups**, paused after 1 week of low activity, 1-day log retention. PowerSync Free — 50 concurrent clients, 2 GB synced/month, 500 MB hosted, deactivated after a week of inactivity.

**Free tier is for build and pilot, not for selling.** Pilot stopgaps: nightly encrypted `pg_dump` via a scheduled GitHub Action (through the pooler; direct connections moved to IPv6), an uptime ping, errors written to `sync_errors`, and the Supabase advisors run on every migration.

**Go-live trigger: upgrade before the first external paying cafe**, or earlier if the database passes about 350 MB, concurrent clients approach 40, or egress passes about 4 GB. Supabase Pro is $25/month (daily backups) and PowerSync Pro $49/month, about $74/month fixed.

**Environments:** production plus dev/staging use both free project slots. Migrations are code under `supabase/migrations`, applied with `supabase db push` from CI.

**Testing:** database tests that attempt cross-tenant reads and writes and must fail; the client/server calc parity test; sync chaos tests (duplicate uploads, partial batches, clock skew); Playwright e2e from `.verify/`; a backup **restore drill** before go-live.

---

## 12. Rollout

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
| 7 | Record only | WAL growth on an idle instance, `pg_cron` on free, UPI AutoPay recurring limit |

### Phases (each ends at a gate the owner approves)
| Phase | Scope | Size | Gate |
|---|---|---|---|
| 1. Foundation | Tenant schema, RLS, access-token hook, device enrolment, PIN hashing, migrations and CI, cross-tenant DB tests | M | Isolation tests pass |
| 2. Client data layer | Repository seam, PowerSync swap, SQL reports, Storage images, invoice series, onboarding wizard, Thanjai importer | L | 207 tests + e2e pass; Thanjai runs on it as the pilot with nightly backups |
| 3. Multi-device and QR self-ordering | Second till live, per-device day close; **QR self-ordering (section 9):** `qr_points` (table/counter/takeaway), per-shop menu with variants and modifiers, bring-your-own Razorpay keys, server-side online billing on the `W` series, stations and KDS with acknowledgement, auto-fired KOT (optional kiosk-print), token board, refund flow, busy/sold-out controls, reconciliation queue | **L** | Two-device chaos tests pass; a mall-peak load test (for example 30 orders in a minute) meets the latency targets; a paid order with no till open still gets a bill and a KOT |
| 4. SaaS layer | Plans, Razorpay Subscriptions, entitlements, leases, operator admin console, owner remote dashboard | M–L | Webhook replay and out-of-order tests pass |
| 5. Go-live | Upgrade to paid tiers, load test, restore drill, GST and DPDP review, beta with 2–3 cafes | M | Restore drill succeeds; beta cafes live |
| Later | Capacitor/Tauri wrappers, native ESC/POS print bridge, WhatsApp/SMS ready-notifications as a paid add-on, LAN hub, multi-stall mall QR with split settlement | — | Only if beta shows the need |

---

## 13. Open items
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

## 14. Risks
- **PowerSync fit** (web SDK, iOS storage): mitigated by the spike and the Option B fallback behind the repository seam.
- **Data-layer rewrite** (Phase 2 is the largest): mitigated by keeping `calc.ts`, UI and tests, and by the feature-parity gate.
- **Free-tier pause or no backups**: acceptable for the pilot only; go-live trigger in section 11.
- **Cross-device outage gap**: with cloud-only sync, devices in one shop cannot see each other's orders while the internet is down. Accepted for v1; LAN hub is the planned answer.
