# Repository seam + PowerSync swap — design

Sub-project 1 of Phase 2 ("Client data layer") from
[2026-09-20-cafe-billing-saas-design.md](2026-09-20-cafe-billing-saas-design.md)
section 16. Phase 2 bundles ten largely-independent pieces (repository seam,
PowerSync swap, SQL reports, Storage images, invoice series, onboarding
wizard, Thanjai importer, the tax-engine/decimal-quantity rewrite in
`calc.ts`, credit notes, `PrinterPort`); this spec covers only the first two,
which everything else in Phase 2 depends on. Owner-approved decomposition
and ordering, 2026-09-23:

1. **Repository seam + PowerSync swap** (this spec)
2. Tax engine + decimal quantities (`calc.ts` rewrite)
3. Invoice series
4. SQL reports
5. Credit notes
6. Storage images / `PrinterPort` (browser-print backend)
7. Onboarding wizard
8. Thanjai importer (real pilot cutover)

Each gets its own spec → plan → implementation cycle.

## Context

The current app ([src/services/db/db.ts](../../../src/services/db/db.ts))
uses Dexie (IndexedDB) as the sole local store — products, categories,
bills, day closes, users, and a `kv` table for settings/counters/session —
with a hand-rolled upload queue in
[src/services/cloud/*](../../../src/services/cloud/) pushing accepted writes
to Supabase. Only three files import `db.ts` directly
(`useAppStore.ts`, `SettingsPage.tsx`, `services/api/sync.ts`); almost every
component reads and writes through the 337-line Zustand store in
[src/store/useAppStore.ts](../../../src/store/useAppStore.ts). That store is
already the de facto seam — this spec formalizes it as one and swaps what's
behind it.

The [PowerSync spike](../spikes/2026-09-powersync-spike-findings.md) decided
**PowerSync** as the sync engine: tests 1 (SDK), 3 (tenant isolation, 30/30),
4 (dual-device offline reconnect, no duplicate invoice numbers), and 5 (100k
rows, ~70x under the latency targets) all passed against the real
`cafe-production` project. Test 2 (multi-platform offline persistence —
Android Chrome, Windows Edge PWA, iOS Safari) is still pending; per the
owner's 2026-09-23 decision, this sub-project proceeds in parallel with that
verification rather than blocking on it, since the architecture work here
doesn't depend on its result — a test-2 failure would be a risk/mitigation
question for a later gate, not a reason to delay building the seam.

## Goals

- Introduce a repository seam behind `useAppStore` covering the same entities
  Dexie covers today: products, categories, bills (+ bill lines/payments),
  day closes, staff/users, settings.
- Replace Dexie and the custom cloud-upload queue with PowerSync end-to-end
  for those entities, against a **test shop** in `cafe-production` (a fresh
  shop created for this work, not the real Thanjai Cafe tenant).
- Prove it with a real, running end-to-end flow: create a bill offline on
  one device, reconnect, see it sync to a second device — through the actual
  app UI, not a scripted test client.

## Non-goals

- **No live cutover of the real Thanjai Cafe shop.** It keeps running on the
  current Dexie build until the Thanjai importer sub-project (#8 above)
  migrates its data and switches it over. This sub-project's code can
  therefore replace Dexie outright on its branch — no runtime dual-backend
  flag, no parallel-maintained Option B implementation.
- **No dual-backend abstraction.** Per the owner's decision, the repository
  interface is designed so a Dexie-backed implementation *could* be written
  later if PowerSync needs to be abandoned (the spec's documented Option B
  fallback, called out in section 18's risk list), but that implementation
  is not written now. Writing and maintaining two working backends in
  parallel is not worth the cost while PowerSync's spike results hold.
- **No tax engine, credit notes, reports, or printer work.** Those are later
  sub-projects; this one only moves where data lives and how it syncs.

## Architecture

`src/services/db/db.ts` and `src/services/cloud/*` are replaced by two new
modules:

- **`src/services/powersync/`** — the PowerSync client itself:
  `schema.ts` (client-side table schema, mirroring the Postgres tables
  already reachable through Phase 1's Sync Streams config), `connector.ts`
  (a `PowerSyncBackendConnector` implementation: `fetchCredentials()` reuses
  the existing Supabase Auth session for PowerSync's JWT, `uploadData()`
  replays the local write queue against Supabase via PostgREST, which
  enforces RLS exactly as the isolation/agreement tests already verify), and
  `client.ts` (the `PowerSyncDatabase` singleton, opened once at app start).
- **`src/services/repository/`** — one module per entity (`products.ts`,
  `bills.ts`, `categories.ts`, `staff.ts`, `settings.ts`, `dayCloses.ts`,
  `invoiceSeq.ts`), each exposing typed query/mutation functions plus a
  `watch()` subscription, matching the shape of what `db.ts` exposes today
  (e.g. `getSettings()`, `nextBillSeq()`) so the store's call sites change
  minimally.

`useAppStore.ts` keeps its existing public shape — the same state fields and
action names every component already calls. Internally, actions that used to
call Dexie now call the repository, and a bridging effect subscribes to each
repository's watch query to keep Zustand state current. Components do not
change: they don't know, and don't need to know, that data now lives in
PowerSync's local SQLite instead of Dexie.

## Data flow

1. Till creates a bill offline → a store action calls
   `repository/bills.ts`'s create function → PowerSync writes it into local
   SQLite immediately and queues the write for upload.
2. The local write fires the store's watch subscription; UI updates
   instantly (bill appears in history) — no network round trip in the path.
3. `invoiceSeq.ts` allocates the next number from the `invoice_series` table
   (`shop_id`, `device_id`, `fy`, `last_seq`) inside a local PowerSync
   transaction, mirroring today's `nextBillSeq()` Dexie-transaction pattern.
   This is the exact mechanism the spike's test 4 already proved
   duplicate-free across two offline devices.
4. On reconnect, PowerSync's upload queue sends the pending write to
   `connector.ts`, which POSTs it to Supabase; RLS (Phase 1's
   `has_shop_access()` / `has_manager_access()` policies) accepts or rejects
   it exactly as for any other authenticated write.
5. Supabase's Sync Streams propagate the accepted row back down to every
   other device subscribed to that shop; their local SQLite updates, their
   watch subscriptions fire, their UI updates.

## Error handling

- **Offline is not an error.** Writes land locally and the UI is unaffected;
  this is the core guarantee the spike already validated (test 4).
- **Rejected uploads** (stale/expired auth session, an RLS policy correctly
  refusing a write) surface through a sync-status indicator in the UI rather
  than being silently dropped — `connector.ts`'s `uploadData()` catches and
  reports failures instead of swallowing them.
- **Client schema drift** (the PowerSync client schema falling out of step
  with the Postgres schema / Sync Streams config) is treated as a
  build-time contract: `powersync/schema.ts` is reviewed alongside any
  future migration that touches an in-scope table, not inferred at runtime.

## Testing

- Unit tests per repository module (query/mapping logic, PowerSync DB
  mocked).
- An integration test replaying the spike's `cross-tenant.mjs` checks
  through the actual repository layer instead of raw SQL, against the test
  shop in `cafe-production`.
- One Playwright e2e test, following this repo's existing `.verify/e2e.mjs`
  pattern: create a bill on device A while offline, reconnect, confirm it
  appears on device B — the concrete "done" gate the owner set for this
  sub-project.

## Open questions

None outstanding — all decisions above were confirmed with the owner during
brainstorming on 2026-09-23.
