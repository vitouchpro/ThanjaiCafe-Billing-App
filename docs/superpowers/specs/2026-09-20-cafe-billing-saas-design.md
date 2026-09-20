# Cafe Billing SaaS — Multi-Tenant, Offline-First Design

**Date:** 2026-09-20
**Status:** Design approved in conversation; awaiting written-spec review
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

### Non-goals (this spec)
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
Per-device series `{device}/{fy}/{seq}`, e.g. `T1/2627/000123` (14 chars). Unique on `(shop, device, fy, seq)`. Voided bills keep their number. A re-enrolled or restored device asks the server for its highest used number and continues. Series resets on 1 April. Kitchen tokens are separate and device-prefixed (`A-01`, `B-01`). GST expects unique, consecutive serials of at most 16 characters per financial year — **confirm with a CA before launch**.

### Tables
- Platform: `accounts`, `shops`, `devices`, `plans`, `subscriptions`, `entitlements`, `webhook_events`, `payment_events`
- Catalog: `categories`, `products`, `product_costs`, `menu_publications`
- Sales: `bills`, `bill_lines`, `bill_payments`, `bill_events`, `day_closes`, `invoice_series`
- QR ordering: `qr_orders`, `qr_order_lines`, `pending_orders`
- Reporting/ops: `shop_daily_stats`, `audit_log`, `sync_errors`

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
- `backup-bills` is replaced by PowerSync upload; `publish-menu` becomes an RLS-guarded upsert from back-office devices. Remaining edge functions: `create-order`, `verify-payment` (per-shop), `enrol-device`, `subscription-webhook`.
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

---

## 9. Edge-case catalogue

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
| | Two tills claim one order | Atomic `claim_order` RPC |
| | Shop suspended | QR page says "not accepting orders"; in-flight payments still complete |
| | Menu changes during payment | Price locked at `create-order` |
| Data | Free-tier growth | Archive after about 13 months; keep rollups |
| | Supabase paused/unreachable | Behaves as offline; alert the operator |
| | Customer phone numbers | Consider India's DPDP Act: retention limit, deletion on request, export |

---

## 10. Operations

**Free-tier limits (official pages, September 2026):** Supabase Free — 500 MB database (shared CPU, 500 MB RAM), 1 GB storage, 5 GB egress, 500k edge invocations, 200 concurrent Realtime connections, 2 active projects, **no automatic backups**, paused after 1 week of low activity, 1-day log retention. PowerSync Free — 50 concurrent clients, 2 GB synced/month, 500 MB hosted, deactivated after a week of inactivity.

**Free tier is for build and pilot, not for selling.** Pilot stopgaps: nightly encrypted `pg_dump` via a scheduled GitHub Action (through the pooler; direct connections moved to IPv6), an uptime ping, errors written to `sync_errors`, and the Supabase advisors run on every migration.

**Go-live trigger: upgrade before the first external paying cafe**, or earlier if the database passes about 350 MB, concurrent clients approach 40, or egress passes about 4 GB. Supabase Pro is $25/month (daily backups) and PowerSync Pro $49/month, about $74/month fixed.

**Environments:** production plus dev/staging use both free project slots. Migrations are code under `supabase/migrations`, applied with `supabase db push` from CI.

**Testing:** database tests that attempt cross-tenant reads and writes and must fail; the client/server calc parity test; sync chaos tests (duplicate uploads, partial batches, clock skew); Playwright e2e from `.verify/`; a backup **restore drill** before go-live.

---

## 11. Rollout

### Phase 0 — harden the current app (no restructuring)
1. Rotate the exposed live Razorpay secret.
2. Do not deploy `publish-menu` / `backup-bills` to a public URL until Phase 1 replaces them (or use Vercel deployment protection).
3. Rate-limit `create-order` and tighten CORS.
4. Move the schema to migrations-as-code (fix the missing `0003`; retire root `apply-migrations*.sql`).

### Spike (2–3 days, throwaway branch, free Supabase + free PowerSync)
Passes only if tests 1–5 all hold; failure of any of 1–4 falls back to custom sync on Dexie (Option B).

| # | Test | Pass condition |
|---|---|---|
| 1 | PowerSync web SDK in the Vite 8 / React 19 app | Builds and syncs |
| 2 | Persistence on Android Chrome, Windows Edge PWA, iOS Safari (home-screen) | Data survives restart, offline use and a week idle; persistent storage granted |
| 3 | Two test shops, claim from the access-token hook | Each device syncs only its own shop; cross-tenant upload rejected by RLS |
| 4 | Two devices create bills offline, then reconnect | No duplicates or losses; per-device series unique |
| 5 | 100k seeded bills on a low-end Android | Proposed: first history page < 200 ms, today's dashboard < 300 ms; measure real bytes per bill vs 1.5 KB |
| 6 | Record only | WAL growth on an idle instance, `pg_cron` on free, UPI AutoPay recurring limit |

### Phases (each ends at a gate the owner approves)
| Phase | Scope | Size | Gate |
|---|---|---|---|
| 1. Foundation | Tenant schema, RLS, access-token hook, device enrolment, PIN hashing, migrations and CI, cross-tenant DB tests | M | Isolation tests pass |
| 2. Client data layer | Repository seam, PowerSync swap, SQL reports, Storage images, invoice series, onboarding wizard, Thanjai importer | L | 207 tests + e2e pass; Thanjai runs on it as the pilot with nightly backups |
| 3. Multi-device and QR | Second till and kitchen live, per-device day close, QR rebased to the shop with bring-your-own Razorpay keys, reconciliation queue | M | Two-device chaos tests pass |
| 4. SaaS layer | Plans, Razorpay Subscriptions, entitlements, leases, operator admin console, owner remote dashboard | M–L | Webhook replay and out-of-order tests pass |
| 5. Go-live | Upgrade to paid tiers, load test, restore drill, GST and DPDP review, beta with 2–3 cafes | M | Restore drill succeeds; beta cafes live |
| Later | Capacitor/Tauri wrappers, direct thermal printing, LAN hub | — | Only if beta shows the need |

---

## 12. Open items
1. Confirm bring-your-own Razorpay keys for diner payments (versus Razorpay Route).
2. Plan tiers and per-shop pricing.
3. CA review: GST invoice series format and subscription invoicing. Legal review: DPDP.
4. Choose the 2–3 beta cafes.
5. Measure in the spike: bytes per bill, `pg_cron` on free, UPI AutoPay recurring limit, WAL growth.

## 13. Risks
- **PowerSync fit** (web SDK, iOS storage): mitigated by the spike and the Option B fallback behind the repository seam.
- **Data-layer rewrite** (Phase 2 is the largest): mitigated by keeping `calc.ts`, UI and tests, and by the feature-parity gate.
- **Free-tier pause or no backups**: acceptable for the pilot only; go-live trigger in section 10.
- **Cross-device outage gap**: with cloud-only sync, devices in one shop cannot see each other's orders while the internet is down. Accepted for v1; LAN hub is the planned answer.
