# Repository Seam + PowerSync Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Dexie + the custom cloud-upload queue with PowerSync, behind a repository seam that `useAppStore` calls into, proven end-to-end (offline bill on device A → reconnect → visible on device B) against a fresh test shop in `cafe-production`.

**Architecture:** `src/services/powersync/` (PowerSync client + a Supabase-backed connector, adapted from the spike's already-proven `src/spike/powersync/*`) becomes the local store and sync engine. `src/services/repository/` exposes one typed module per entity (query + mutation + watch), matching the shape `src/services/db/db.ts` exposes today. `useAppStore.ts` keeps its existing public state/action shape; only its internals swap from Dexie calls to repository calls plus PowerSync watch subscriptions.

**Tech Stack:** React 19, Vite 8, Zustand, `@powersync/web` `^2.3.1`, `@powersync/react` `^2.0.1`, `@supabase/supabase-js` `^2.116.0` (already a dependency), TypeScript, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-09-23-repository-seam-powersync-design.md](../specs/2026-09-23-repository-seam-powersync-design.md)

## Global Constraints

- Entity scope for this plan: products, categories, bills (+ bill_lines, bill_payments), day closes, staff, settings. No tax-engine changes, no credit notes, no reports, no printer work, no QR-ordering wiring — those are later Phase 2 sub-projects.
- No live cutover of the real Thanjai Cafe shop. Every task's testing happens against a **fresh test shop** created in `cafe-production` (the same project the isolation/agreement tests already use), not the pilot's real tenant.
- No dual-backend abstraction. Dexie (`src/services/db/db.ts`) and the custom cloud queue (`src/services/cloud/menu.ts`, `orders.ts`, `razorpay.ts`, `status.ts`, `tableQr.ts` stay — those back the QR-ordering customer route, out of scope here; only `src/services/db/db.ts`'s consumers move) are replaced outright for the in-scope entities, not kept as a parallel runtime option.
- Migrations are written and committed by the task's implementer as a `.sql` file under `supabase/migrations/`. **Implementers and reviewers never get database credentials.** The controller (the human/session running this plan) applies each migration to `cafe-production` via the Supabase SQL Editor after that task's review passes, and confirms it before the next task that depends on it starts. Flag this explicitly at the end of any task that adds a migration file.
- "Held" (suspended/parked) bills are a PowerSync **local-only** table (`held_bills`, `{ localOnly: true }`) — they never sync, matching today's per-device-only behavior. `bills` itself is create + read only in this plan; refund/void/cancel workflows move to `bill_events` in a later sub-project and are explicitly out of scope here.
- Money in the Postgres schema is `*_paise` bigint columns; the domain model (`Bill`, `Product`, etc.) uses rupee floats. Every repository module converts at its boundary — `src/services/repository/mappers.ts` (Task 5) is the one place that conversion logic lives.

---

## Task 1: Additive schema migration for repository-seam fields

**Files:**
- Create: `supabase/migrations/20260923110000_repository_seam_columns.sql`

**Interfaces:**
- Produces: the columns every later repository task in this plan reads/writes — `products.sku`, `products.image`, `products.available`, `products.tax_rate_bps`, `products.created_at`, `categories.icon`, `staff.permissions`, `settings.legacy`, `bills.customer_name`, `bills.customer_phone`, `bills.note`.

- [ ] **Step 1: Write the migration**

```sql
-- Adds the columns needed for the repository-seam sub-project to reach
-- feature parity with the current Dexie-backed domain model. Phase 1's
-- schema modeled these entities at SaaS-config grain (e.g. settings as
-- day_cutover_hour + receipt_language); the app's local model carries a
-- much richer, per-shop UI/config surface (business profile, invoice/receipt
-- display prefs, appearance, notifications, report thresholds) that has no
-- other home yet and isn't worth a bespoke column per field before the
-- product decides which of it should be shop-wide config at all. `legacy`
-- carries that surface as one versioned JSON blob; day_cutover_hour and
-- receipt_language (already columns) remain the two fields Postgres-side
-- logic actually needs structured.
alter table public.products
  add column sku text,
  add column image text,
  add column available boolean not null default true,
  add column tax_rate_bps int not null default 0,
  add column created_at timestamptz not null default now();

alter table public.categories
  add column icon text;

alter table public.staff
  add column permissions jsonb;

alter table public.settings
  add column legacy jsonb;

-- Phase 1's bills table has no customer or free-text note columns; add them
-- rather than dropping customer name/phone/note capture from the till.
alter table public.bills
  add column customer_name text,
  add column customer_phone text,
  add column note text;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260923110000_repository_seam_columns.sql
git commit -m "feat(db): add repository-seam columns to products, categories, staff, settings, bills"
```

- [ ] **Step 3: Flag for the controller**

This task's deliverable is a migration file, not a database change — no credentials are available to this task's implementer or reviewer. After review passes, the controller applies it to `cafe-production` via the Supabase SQL Editor (same process used for every prior Phase 1 migration) and confirms success before Task 6 (products/categories repository) or Task 11 (bills repository) start, since those tasks' code assumes the new columns exist.

---

## Task 2: Install PowerSync and define the client schema

**Files:**
- Modify: `package.json`
- Create: `src/services/powersync/schema.ts`
- Test: `src/services/powersync/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `RepoSchema` (default export of `schema.ts`), a `@powersync/web` `Schema` instance covering `products`, `categories`, `bills`, `bill_lines`, `bill_payments`, `staff`, `settings`, `day_closes`, `invoice_series`, and the local-only `held_bills`. Later tasks (3, 6-12) import table names from this file's exported `TABLES` object rather than restating string literals.

- [ ] **Step 1: Install dependencies**

```bash
npm install @powersync/web@^2.3.1 @powersync/react@^2.0.1
```

- [ ] **Step 2: Write the schema**

Adapted from the already-proven `src/spike/powersync/schema.ts` (spike tests 1, 3, 4, 5 all passed against `cafe-production` with this same `column`/`Table`/`Schema` API), extended to this plan's full entity scope and the columns Task 1 adds.

```typescript
// src/services/powersync/schema.ts
import { column, Schema, Table } from '@powersync/web';

const categories = new Table({
  shop_id: column.text, name: column.text, icon: column.text,
  sort_order: column.integer, rev: column.integer, deleted_at: column.text,
});

const products = new Table({
  shop_id: column.text, category_id: column.text, name: column.text, unit: column.text,
  price_paise: column.integer, hsn_sac: column.text, tax_class: column.text,
  sku: column.text, image: column.text, available: column.integer,
  tax_rate_bps: column.integer, rev: column.integer,
  created_at: column.text, updated_at: column.text, deleted_at: column.text,
}, { indexes: { by_category: ['category_id'] } });

const product_costs = new Table({
  shop_id: column.text, cost_paise: column.integer, rev: column.integer, updated_at: column.text,
});

const staff = new Table({
  shop_id: column.text, name: column.text, pin_hash: column.text, pin_salt: column.text,
  role: column.text, active: column.integer, permissions: column.text,
  rev: column.integer, created_at: column.text, updated_at: column.text,
});

const settings = new Table({
  shop_id: column.text, day_cutover_hour: column.integer, receipt_language: column.text,
  legacy: column.text, rev: column.integer, updated_at: column.text,
});

const billColumns = {
  shop_id: column.text, device_id: column.text, staff_id: column.text,
  invoice_no: column.text, fy: column.text, seq: column.integer,
  source: column.text, business_date: column.text, payment_method: column.text,
  subtotal_paise: column.integer, tax_paise: column.integer, total_paise: column.integer,
  customer_name: column.text, customer_phone: column.text, note: column.text,
  created_at: column.text, received_at: column.text,
};

const bills = new Table(billColumns, {
  indexes: {
    by_created: ['created_at'],
    by_date: ['business_date'],
    by_device_seq: ['device_id', 'fy', 'seq'],
    by_invoice: ['invoice_no'],
  },
});

const bill_lines = new Table({
  bill_id: column.text, shop_id: column.text, product_id: column.text, name: column.text,
  qty: column.real, unit: column.text, unit_price_paise: column.integer,
  tax_rule_snapshot: column.text, line_total_paise: column.integer,
}, { indexes: { by_bill: ['bill_id'] } });

const bill_payments = new Table({
  bill_id: column.text, shop_id: column.text, method: column.text, verification: column.text,
  gateway_payment_id: column.text, amount_paise: column.integer, created_at: column.text,
}, { indexes: { by_bill: ['bill_id'] } });

const day_closes = new Table({
  shop_id: column.text, device_id: column.text, business_date: column.text,
  opening_float_paise: column.integer, closing_count_paise: column.integer,
  closed_by_staff_id: column.text, closed_at: column.text,
}, { indexes: { by_date: ['business_date'] } });

const invoice_series = new Table({
  shop_id: column.text, device_id: column.text, fy: column.text, last_seq: column.integer,
}, { indexes: { by_shop_device_fy: ['shop_id', 'device_id', 'fy'] } });

// Local-only: suspended/parked carts. Never synced — matches today's
// per-device-only "held bill" behavior. Not a Postgres table; PowerSync
// keeps localOnly tables purely in the on-device SQLite file.
const held_bills = new Table({
  label: column.text, payload: column.text, created_at: column.text,
}, { localOnly: true });

export const TABLES = {
  categories: 'categories', products: 'products', product_costs: 'product_costs',
  staff: 'staff', settings: 'settings', bills: 'bills', bill_lines: 'bill_lines',
  bill_payments: 'bill_payments', day_closes: 'day_closes', invoice_series: 'invoice_series',
  held_bills: 'held_bills',
} as const;

export const RepoSchema = new Schema({
  categories, products, product_costs, staff, settings,
  bills, bill_lines, bill_payments, day_closes, invoice_series, held_bills,
});
```

- [ ] **Step 3: Write the failing test**

```typescript
// src/services/powersync/__tests__/schema.test.ts
import { describe, expect, it } from 'vitest';
import { RepoSchema, TABLES } from '../schema';

describe('RepoSchema', () => {
  it('defines every table this plan\'s repositories depend on', () => {
    const tableNames = RepoSchema.tables.map((t) => t.name).sort();
    expect(tableNames).toEqual(Object.values(TABLES).sort());
  });

  it('marks held_bills as local-only so it never syncs', () => {
    const held = RepoSchema.tables.find((t) => t.name === 'held_bills');
    expect(held?.localOnly).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails, then passes**

Run: `npx vitest run src/services/powersync/__tests__/schema.test.ts`
Expected before Step 2 exists: FAIL (module not found). After Step 2: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/services/powersync/schema.ts src/services/powersync/__tests__/schema.test.ts
git commit -m "feat: add PowerSync client schema for the repository seam"
```

---

## Task 3: PowerSync client singleton and Supabase connector

**Files:**
- Create: `src/services/powersync/connector.ts`
- Create: `src/services/powersync/client.ts`
- Test: `src/services/powersync/__tests__/connector.test.ts`

**Interfaces:**
- Consumes: `RepoSchema` (Task 2), `supabase` client (`src/services/cloud/client.ts`, existing).
- Produces: `powersyncDb` (default `PowerSyncDatabase` singleton) and `repoConnector` (a `RepositoryConnector` instance) from `client.ts` — every repository module (Tasks 6-12) and the store (Task 13) import `powersyncDb` to run queries and `db.connect(repoConnector)` to start syncing.

- [ ] **Step 1: Write the connector**

Adapted from the spike's `SpikeConnector` (proven against real `cafe-production`: test 4 showed zero duplicate/lost writes across two offline devices reconnecting), reusing this app's existing `supabase` client instead of creating a second one, and extending the append-only table set to match every `forbid_mutation()`-guarded table this plan touches.

```typescript
// src/services/powersync/connector.ts
import {
  UpdateType,
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
} from '@powersync/web';
import { supabase } from '@/services/cloud/client';

/* Append-only tables (see forbid_mutation() in
   supabase/migrations/20260923090200_sales_core.sql) are uploaded with
   ON CONFLICT DO NOTHING, so a retried upload after a dropped connection
   can never edit or duplicate a row. */
const APPEND_ONLY = new Set(['bills', 'bill_lines', 'bill_payments']);

/* Errors retrying cannot fix: bad data, constraint violations, RLS denials.
   Discard the transaction instead of blocking the upload queue forever. */
const FATAL = [/^22...$/, /^23...$/, /^42501$/];

export interface UploadFailure {
  at: string; table: string; op: string; code: string; message: string; discarded: boolean;
}

export class RepositoryConnector implements PowerSyncBackendConnector {
  /** Surfaced by the UI's sync-status indicator so a rejected upload is never silent. */
  lastUploadError: UploadFailure | null = null;
  lastUploadOkAt: string | null = null;

  async fetchCredentials(): Promise<PowerSyncCredentials> {
    if (!supabase) throw new Error('Supabase is not configured (VITE_SUPABASE_URL/ANON_KEY missing).');
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) throw new Error('Not signed in.');
    const endpoint = import.meta.env.VITE_POWERSYNC_URL as string | undefined;
    if (!endpoint) throw new Error('VITE_POWERSYNC_URL is not set.');
    return { endpoint, token: session.access_token };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    if (!supabase) return;
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    let current = { table: 'unknown', op: 'unknown' };
    try {
      for (const op of transaction.crud) {
        current = { table: op.table, op: String(op.op) };
        const table = supabase.from(op.table);
        let result;
        if (op.op === UpdateType.PUT) {
          const record = { ...op.opData, id: op.id };
          result = APPEND_ONLY.has(op.table)
            ? await table.upsert(record, { ignoreDuplicates: true })
            : await table.upsert(record);
        } else if (op.op === UpdateType.PATCH) {
          result = await table.update(op.opData ?? {}).eq('id', op.id);
        } else {
          result = await table.delete().eq('id', op.id);
        }
        if (result.error) throw result.error;
      }
      await transaction.complete();
      this.lastUploadOkAt = new Date().toISOString();
    } catch (ex) {
      const rawCode = (ex as { code?: unknown }).code;
      const code = typeof rawCode === 'string' ? rawCode : 'unknown';
      const rawMessage = (ex as { message?: unknown }).message;
      const message = typeof rawMessage === 'string' ? rawMessage : String(ex);
      const fatal = typeof rawCode === 'string' && FATAL.some((re) => re.test(rawCode));
      this.lastUploadError = {
        at: new Date().toISOString(), table: current.table, op: current.op, code, message, discarded: fatal,
      };
      if (fatal) {
        console.error('Upload rejected, discarding transaction:', ex);
        await transaction.complete();
      } else {
        throw ex; // retryable (network, temporary server error)
      }
    }
  }
}
```

- [ ] **Step 2: Write the client singleton**

```typescript
// src/services/powersync/client.ts
import { PowerSyncDatabase } from '@powersync/web';
import { RepoSchema } from './schema';
import { RepositoryConnector } from './connector';

export const repoConnector = new RepositoryConnector();
export const powersyncDb = new PowerSyncDatabase({
  schema: RepoSchema,
  database: { dbFilename: 'thanjai-pos.db' },
});
```

- [ ] **Step 3: Write the failing test**

```typescript
// src/services/powersync/__tests__/connector.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RepositoryConnector } from '../connector';

vi.mock('@/services/cloud/client', () => ({ supabase: null }));

describe('RepositoryConnector', () => {
  let connector: RepositoryConnector;
  beforeEach(() => { connector = new RepositoryConnector(); });

  it('throws when Supabase is not configured', async () => {
    await expect(connector.fetchCredentials()).rejects.toThrow('Supabase is not configured');
  });

  it('uploadData is a no-op when Supabase is not configured', async () => {
    await expect(connector.uploadData({} as never)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails, then passes**

Run: `npx vitest run src/services/powersync/__tests__/connector.test.ts`
Expected before Steps 1-2: FAIL (module not found). After: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/powersync/connector.ts src/services/powersync/client.ts src/services/powersync/__tests__/connector.test.ts
git commit -m "feat: add PowerSync client singleton and Supabase connector"
```

---

## Task 4: Test-shop provisioning script

**Files:**
- Create: `supabase/tests/repository/provision-test-shop.mjs`
- Test: N/A — this is a script the remaining tasks' tests import, not a unit under test itself.

**Interfaces:**
- Produces: `provisionTestShop()` — creates one account/shop/device/auth-user in `cafe-production` and returns `{ accountId, shopId, deviceId, email, password }`; `teardownTestShop(ids)` — deletes them (safe here: none of the entities this script creates are append-only, unlike bills/audit_log).

- [ ] **Step 1: Write the provisioning script**

Follows the same pattern as `supabase/tests/isolation/generic-read-scoping.mjs` (admin client creates fixtures, anon client signs in as the device) so Tasks 6-12's integration tests and Task 15's e2e test share one setup path instead of each reinventing it.

```javascript
// supabase/tests/repository/provision-test-shop.mjs
import { createClient } from '@supabase/supabase-js';

export function adminClient() {
  const url = process.env.SPIKE_SUPABASE_URL;
  const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Set SPIKE_SUPABASE_URL, SPIKE_SERVICE_ROLE_KEY.');
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function provisionTestShop(admin, label = 'Repository Seam Test') {
  const { data: account } = await admin.from('accounts').insert({ name: `${label} Account` }).select().single();
  const { data: shop } = await admin.from('shops').insert({ account_id: account.id, name: `${label} Shop` }).select().single();
  const email = `repo-seam-${crypto.randomUUID()}@isolation.test`;
  const password = crypto.randomUUID();
  const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const { data: device } = await admin
    .from('devices')
    .insert({ shop_id: shop.id, auth_user_id: user.user.id, code: 'RS1', role: 'till' })
    .select()
    .single();
  return { accountId: account.id, shopId: shop.id, deviceId: device.id, userId: user.user.id, email, password };
}

export async function teardownTestShop(admin, ids) {
  await admin.from('devices').delete().eq('id', ids.deviceId);
  await admin.from('shops').delete().eq('id', ids.shopId);
  await admin.from('accounts').delete().eq('id', ids.accountId);
  await admin.auth.admin.deleteUser(ids.userId);
}
```

- [ ] **Step 2: Verify it runs**

Run: `SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... node -e "import('./supabase/tests/repository/provision-test-shop.mjs').then(async (m) => { const admin = m.adminClient(); const ids = await m.provisionTestShop(admin); console.log('provisioned', ids.shopId); await m.teardownTestShop(admin, ids); console.log('torn down'); })"`
Expected: prints `provisioned <uuid>` then `torn down`, no errors. (The controller runs this — it needs the service-role key.)

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/repository/provision-test-shop.mjs
git commit -m "test: add shared test-shop provisioning for repository-seam integration tests"
```

---

## Task 5: Shared mappers (paise/rupee conversion, financial year)

**Files:**
- Create: `src/services/repository/mappers.ts`
- Test: `src/services/repository/__tests__/mappers.test.ts`

**Interfaces:**
- Produces: `rupeesToPaise(rupees: number): number`, `paiseToRupees(paise: number): number`, `financialYear(isoDate: string): string` — every repository module (Tasks 6-12) imports these instead of re-deriving them.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/repository/__tests__/mappers.test.ts
import { describe, expect, it } from 'vitest';
import { rupeesToPaise, paiseToRupees, financialYear } from '../mappers';

describe('rupeesToPaise / paiseToRupees', () => {
  it('round-trips exactly, avoiding float drift', () => {
    expect(rupeesToPaise(99.5)).toBe(9950);
    expect(paiseToRupees(9950)).toBe(99.5);
    expect(rupeesToPaise(10.1)).toBe(1010); // classic 0.1+0.2-style float trap
  });
});

describe('financialYear', () => {
  it('is Apr-Mar: a date in Sept 2026 is FY 2026-27', () => {
    expect(financialYear('2026-09-23')).toBe('2627');
  });
  it('a date in Feb 2026 is FY 2025-26', () => {
    expect(financialYear('2026-02-15')).toBe('2526');
  });
  it('a date on April 1 starts the new FY', () => {
    expect(financialYear('2026-04-01')).toBe('2627');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/repository/__tests__/mappers.test.ts`
Expected: FAIL with "Cannot find module '../mappers'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/services/repository/mappers.ts

/** Rounds to the nearest paisa before converting, so float drift (10.1 * 100
    = 1009.9999999999999 in IEEE 754) never produces an off-by-one paise. */
export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);

export const paiseToRupees = (paise: number): number => paise / 100;

/** India's fiscal year: April 1 - March 31. Returns e.g. "2627" for FY 2026-27. */
export function financialYear(isoDate: string): string {
  const [yearStr, monthStr] = isoDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const startYear = month >= 4 ? year : year - 1;
  return `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/repository/__tests__/mappers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/repository/mappers.ts src/services/repository/__tests__/mappers.test.ts
git commit -m "feat: add paise/rupee and financial-year mappers for the repository seam"
```

---

## Task 6: Products and categories repository

**Files:**
- Create: `src/services/repository/products.ts`
- Create: `src/services/repository/categories.ts`
- Test: `src/services/repository/__tests__/products.test.ts`
- Test: `src/services/repository/__tests__/categories.test.ts`

**Interfaces:**
- Consumes: `powersyncDb` (Task 3), `rupeesToPaise`/`paiseToRupees` (Task 5), `Product`/`Category` types (`@/types`, existing).
- Produces: `listProducts(): Promise<Product[]>`, `watchProducts(cb: (p: Product[]) => void): () => void`, `createProduct(p, shopId): Promise<Product>`, `updateProduct(id, patch): Promise<void>`, `archiveProduct(id): Promise<void>` from `products.ts`; the same `list`/`watch`/`create`/`update`/`delete` shape from `categories.ts`. Task 13 (store wiring) calls these directly by name.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/repository/__tests__/products.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = {
  getAll: vi.fn(),
  execute: vi.fn(),
  watch: vi.fn(),
};
vi.mock('../../powersync/client', () => ({ powersyncDb: mockDb }));

const { listProducts, createProduct } = await import('../products');

describe('listProducts', () => {
  beforeEach(() => { mockDb.getAll.mockReset(); });

  it('maps rows to the Product domain type, converting paise to rupees', async () => {
    mockDb.getAll.mockResolvedValue([{
      id: 'p1', name: 'Filter Coffee', category_id: 'c1', sku: null, image: null,
      price_paise: 5000, tax_rate_bps: 500, available: 1, unit: 'cup',
      created_at: '2026-09-23T10:00:00Z', updated_at: '2026-09-23T10:00:00Z',
    }]);
    const products = await listProducts();
    expect(products).toEqual([{
      id: 'p1', name: 'Filter Coffee', categoryId: 'c1', sku: undefined, image: undefined,
      sellingPrice: 50, costPrice: 0, discount: 0, discountType: 'fixed',
      taxRate: 5, available: true, unit: 'cup',
      createdAt: '2026-09-23T10:00:00Z', updatedAt: '2026-09-23T10:00:00Z',
    }]);
  });
});

describe('createProduct', () => {
  it('converts rupees to paise and inserts via a parameterised INSERT', async () => {
    mockDb.execute.mockResolvedValue(undefined);
    const product = await createProduct({
      name: 'Filter Coffee', categoryId: 'c1', sellingPrice: 50, costPrice: 30,
      discount: 0, discountType: 'fixed', taxRate: 5, available: true, unit: 'cup',
    }, 'shop-1');
    expect(product.id).toBeTruthy();
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO products'),
      expect.arrayContaining(['shop-1', 'c1', 'Filter Coffee', 'cup', 5000, 500]),
    );
  });
});
```

```typescript
// src/services/repository/__tests__/categories.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = { getAll: vi.fn(), execute: vi.fn(), watch: vi.fn() };
vi.mock('../../powersync/client', () => ({ powersyncDb: mockDb }));

const { listCategories, createCategory } = await import('../categories');

describe('listCategories', () => {
  beforeEach(() => { mockDb.getAll.mockReset(); });

  it('maps rows to the Category domain type', async () => {
    mockDb.getAll.mockResolvedValue([{ id: 'c1', name: 'Beverages', icon: 'coffee', sort_order: 0, deleted_at: null }]);
    expect(await listCategories()).toEqual([{ id: 'c1', name: 'Beverages', icon: 'coffee', sortOrder: 0, archived: false }]);
  });
});

describe('createCategory', () => {
  it('inserts via a parameterised INSERT', async () => {
    mockDb.execute.mockResolvedValue(undefined);
    const category = await createCategory({ name: 'Beverages', icon: 'coffee', sortOrder: 0 }, 'shop-1');
    expect(category.id).toBeTruthy();
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO categories'),
      expect.arrayContaining(['shop-1', 'Beverages', 'coffee', 0]),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/repository/__tests__/products.test.ts src/services/repository/__tests__/categories.test.ts`
Expected: FAIL ("Cannot find module '../products'" / "'../categories'")

- [ ] **Step 3: Write products.ts**

```typescript
// src/services/repository/products.ts
import type { Product } from '@/types';
import { powersyncDb } from '../powersync/client';
import { rupeesToPaise, paiseToRupees } from './mappers';

interface ProductRow {
  id: string; name: string; category_id: string; sku: string | null; image: string | null;
  price_paise: number; tax_rate_bps: number; available: number; unit: string;
  created_at: string; updated_at: string;
}

function toDomain(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    sku: row.sku ?? undefined,
    image: row.image ?? undefined,
    sellingPrice: paiseToRupees(row.price_paise),
    costPrice: 0, // product_costs is a separate synced table; joined in a later task if reports need it here
    discount: 0,
    discountType: 'fixed',
    taxRate: row.tax_rate_bps / 100,
    available: row.available === 1,
    unit: row.unit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProducts(): Promise<Product[]> {
  const rows = await powersyncDb.getAll<ProductRow>(
    `SELECT id, name, category_id, sku, image, price_paise, tax_rate_bps, available, unit, created_at, updated_at
     FROM products WHERE deleted_at IS NULL`,
  );
  return rows.map(toDomain);
}

export function watchProducts(cb: (products: Product[]) => void): () => void {
  const abort = new AbortController();
  powersyncDb.watch(
    `SELECT id, name, category_id, sku, image, price_paise, tax_rate_bps, available, unit, created_at, updated_at
     FROM products WHERE deleted_at IS NULL`,
    [],
    { onResult: (result) => cb(result.rows._array.map(toDomain)) },
    { signal: abort.signal },
  );
  return () => abort.abort();
}

export async function createProduct(
  p: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>,
  shopId: string,
): Promise<Product> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await powersyncDb.execute(
    `INSERT INTO products (id, shop_id, category_id, name, unit, price_paise, tax_rate_bps, sku, image, available, rev, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, shopId, p.categoryId, p.name, p.unit, rupeesToPaise(p.sellingPrice), Math.round(p.taxRate * 100),
      p.sku ?? null, p.image ?? null, p.available ? 1 : 0, now, now],
  );
  return { ...p, id, createdAt: now, updatedAt: now };
}

export async function updateProduct(id: string, patch: Partial<Product>): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name); }
  if (patch.categoryId !== undefined) { sets.push('category_id = ?'); args.push(patch.categoryId); }
  if (patch.unit !== undefined) { sets.push('unit = ?'); args.push(patch.unit); }
  if (patch.sellingPrice !== undefined) { sets.push('price_paise = ?'); args.push(rupeesToPaise(patch.sellingPrice)); }
  if (patch.taxRate !== undefined) { sets.push('tax_rate_bps = ?'); args.push(Math.round(patch.taxRate * 100)); }
  if (patch.sku !== undefined) { sets.push('sku = ?'); args.push(patch.sku); }
  if (patch.image !== undefined) { sets.push('image = ?'); args.push(patch.image); }
  if (patch.available !== undefined) { sets.push('available = ?'); args.push(patch.available ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?', 'rev = rev + 1');
  args.push(new Date().toISOString(), id);
  await powersyncDb.execute(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, args);
}

/** Soft delete — past bills reference product_id with no cascade. */
export async function archiveProduct(id: string): Promise<void> {
  await powersyncDb.execute(
    `UPDATE products SET deleted_at = ?, available = 0, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), new Date().toISOString(), id],
  );
}
```

- [ ] **Step 4: Write categories.ts**

```typescript
// src/services/repository/categories.ts
import type { Category } from '@/types';
import { powersyncDb } from '../powersync/client';

interface CategoryRow {
  id: string; name: string; icon: string | null; sort_order: number; deleted_at: string | null;
}

function toDomain(row: CategoryRow): Category {
  return { id: row.id, name: row.name, icon: row.icon ?? '', sortOrder: row.sort_order, archived: row.deleted_at !== null };
}

export async function listCategories(): Promise<Category[]> {
  const rows = await powersyncDb.getAll<CategoryRow>(
    'SELECT id, name, icon, sort_order, deleted_at FROM categories WHERE deleted_at IS NULL',
  );
  return rows.map(toDomain);
}

export function watchCategories(cb: (categories: Category[]) => void): () => void {
  const abort = new AbortController();
  powersyncDb.watch(
    'SELECT id, name, icon, sort_order, deleted_at FROM categories WHERE deleted_at IS NULL',
    [],
    { onResult: (result) => cb(result.rows._array.map(toDomain)) },
    { signal: abort.signal },
  );
  return () => abort.abort();
}

export async function createCategory(c: Omit<Category, 'id'>, shopId: string): Promise<Category> {
  const id = crypto.randomUUID();
  await powersyncDb.execute(
    'INSERT INTO categories (id, shop_id, name, icon, sort_order, rev) VALUES (?, ?, ?, ?, ?, 1)',
    [id, shopId, c.name, c.icon, c.sortOrder],
  );
  return { ...c, id };
}

export async function updateCategory(id: string, patch: Partial<Category>): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name); }
  if (patch.icon !== undefined) { sets.push('icon = ?'); args.push(patch.icon); }
  if (patch.sortOrder !== undefined) { sets.push('sort_order = ?'); args.push(patch.sortOrder); }
  if (sets.length === 0) return;
  sets.push('rev = rev + 1');
  args.push(id);
  await powersyncDb.execute(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, args);
}

/** Hard delete — categories carry no history the way bills/products do, and
    the store's deleteCategory action already refuses this when products
    still reference the category. */
export async function deleteCategory(id: string): Promise<void> {
  await powersyncDb.execute('UPDATE categories SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), id]);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/services/repository/__tests__/products.test.ts src/services/repository/__tests__/categories.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/repository/products.ts src/services/repository/categories.ts src/services/repository/__tests__/products.test.ts src/services/repository/__tests__/categories.test.ts
git commit -m "feat: add products and categories repository modules"
```

---

## Task 7: Settings repository

**Files:**
- Create: `src/services/repository/settings.ts`
- Test: `src/services/repository/__tests__/settings.test.ts`

**Interfaces:**
- Consumes: `powersyncDb` (Task 3), `Settings` type (`@/types`, existing), `DEFAULT_SETTINGS` (`@/data/defaults`, existing).
- Produces: `getSettings(): Promise<Settings | undefined>`, `watchSettings(cb): () => void`, `saveSettings(s: Settings, shopId: string): Promise<void>`. Task 13 calls these in place of `db.ts`'s same-named functions.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/repository/__tests__/settings.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS } from '@/data/defaults';

const mockDb = { getAll: vi.fn(), execute: vi.fn(), watch: vi.fn() };
vi.mock('../../powersync/client', () => ({ powersyncDb: mockDb }));

const { getSettings, saveSettings } = await import('../settings');

describe('getSettings', () => {
  beforeEach(() => { mockDb.getAll.mockReset(); mockDb.execute.mockReset(); });

  it('returns undefined when no row exists yet', async () => {
    mockDb.getAll.mockResolvedValue([]);
    expect(await getSettings()).toBeUndefined();
  });

  it('parses the legacy JSON blob back into the Settings object', async () => {
    mockDb.getAll.mockResolvedValue([{
      day_cutover_hour: 4, receipt_language: 'ta', legacy: JSON.stringify(DEFAULT_SETTINGS),
    }]);
    expect(await getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, language: 'ta' },
    });
  });
});

describe('saveSettings', () => {
  it('upserts day_cutover_hour, receipt_language and the full object as legacy JSON', async () => {
    await saveSettings(DEFAULT_SETTINGS, 'shop-1');
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO settings'),
      expect.arrayContaining(['shop-1', 0, DEFAULT_SETTINGS.appearance.language, JSON.stringify(DEFAULT_SETTINGS)]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/repository/__tests__/settings.test.ts`
Expected: FAIL ("Cannot find module '../settings'")

- [ ] **Step 3: Write the implementation**

```typescript
// src/services/repository/settings.ts
import type { Settings } from '@/types';
import { powersyncDb } from '../powersync/client';

interface SettingsRow {
  day_cutover_hour: number; receipt_language: string; legacy: string | null;
}

/** day_cutover_hour and receipt_language are the two fields Postgres-side
    logic (business_date computation) actually reads structured; everything
    else the app calls "Settings" rides along as one JSON blob (see Task 1's
    migration comment) until a later sub-project decides it needs its own
    columns. This function is the single place that reconciles the two. */
function toDomain(row: SettingsRow): Settings | undefined {
  if (!row.legacy) return undefined;
  const legacy = JSON.parse(row.legacy) as Settings;
  return { ...legacy, appearance: { ...legacy.appearance, language: row.receipt_language as 'en' | 'ta' } };
}

export async function getSettings(): Promise<Settings | undefined> {
  const rows = await powersyncDb.getAll<SettingsRow>('SELECT day_cutover_hour, receipt_language, legacy FROM settings LIMIT 1');
  return rows[0] ? toDomain(rows[0]) : undefined;
}

export function watchSettings(cb: (settings: Settings | undefined) => void): () => void {
  const abort = new AbortController();
  powersyncDb.watch(
    'SELECT day_cutover_hour, receipt_language, legacy FROM settings LIMIT 1',
    [],
    { onResult: (result) => cb(result.rows._array[0] ? toDomain(result.rows._array[0]) : undefined) },
    { signal: abort.signal },
  );
  return () => abort.abort();
}

export async function saveSettings(settings: Settings, shopId: string): Promise<void> {
  await powersyncDb.execute(
    `INSERT INTO settings (shop_id, day_cutover_hour, receipt_language, legacy, rev, updated_at)
     VALUES (?, 0, ?, ?, 1, ?)
     ON CONFLICT (shop_id) DO UPDATE SET
       receipt_language = excluded.receipt_language, legacy = excluded.legacy,
       rev = settings.rev + 1, updated_at = excluded.updated_at`,
    [shopId, settings.appearance.language, JSON.stringify(settings), new Date().toISOString()],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/repository/__tests__/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/repository/settings.ts src/services/repository/__tests__/settings.test.ts
git commit -m "feat: add settings repository module"
```

---

## Task 8: Staff repository

**Files:**
- Create: `src/services/repository/staff.ts`
- Test: `src/services/repository/__tests__/staff.test.ts`

**Interfaces:**
- Consumes: `powersyncDb` (Task 3), `User` type (`@/types`, existing).
- Produces: `listStaff(): Promise<User[]>`, `watchStaff(cb): () => void`, `createStaff(u, shopId): Promise<User>`, `updateStaff(id, patch): Promise<void>`, `deleteStaff(id): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/repository/__tests__/staff.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = { getAll: vi.fn(), execute: vi.fn(), watch: vi.fn() };
vi.mock('../../powersync/client', () => ({ powersyncDb: mockDb }));

const { listStaff, createStaff } = await import('../staff');

describe('listStaff', () => {
  beforeEach(() => { mockDb.getAll.mockReset(); });

  it('maps rows to the User domain type, parsing permissions JSON', async () => {
    mockDb.getAll.mockResolvedValue([{
      id: 'u1', name: 'Priya', pin_hash: 'h', pin_salt: 's', role: 'cashier', active: 1,
      permissions: JSON.stringify(['billing', 'refund']),
    }]);
    expect(await listStaff()).toEqual([
      { id: 'u1', name: 'Priya', role: 'cashier', pin: '', active: true, permissions: ['billing', 'refund'] },
    ]);
  });

  it('leaves permissions undefined when the row has none (role defaults apply)', async () => {
    mockDb.getAll.mockResolvedValue([{ id: 'u1', name: 'Priya', pin_hash: 'h', pin_salt: 's', role: 'cashier', active: 1, permissions: null }]);
    expect((await listStaff())[0].permissions).toBeUndefined();
  });
});

describe('createStaff', () => {
  it('hashes the PIN before storing it and never returns pin_hash/pin_salt', async () => {
    mockDb.execute.mockResolvedValue(undefined);
    const user = await createStaff({ name: 'Priya', role: 'cashier', pin: '1234', active: true }, 'shop-1');
    expect(user.id).toBeTruthy();
    expect(user.pin).toBe('1234'); // domain type keeps the plaintext PIN in memory for same-session display only
    const call = mockDb.execute.mock.calls[0];
    expect(call[0]).toContain('INSERT INTO staff');
    expect(call[1]).not.toContain('1234'); // the stored row must never contain the plaintext PIN
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/repository/__tests__/staff.test.ts`
Expected: FAIL ("Cannot find module '../staff'")

- [ ] **Step 3: Write the implementation**

Phase 1's `staff` table stores a salted hash (`pin_hash`/`pin_salt`), not the plaintext PIN `db.ts` kept locally — this repository hashes on write and never reads the hash back into the domain `User.pin` field (existing login code compares against `pin_hash` going forward; that wiring is Task 13's job, not this one's).

```typescript
// src/services/repository/staff.ts
import type { Permission, Role, User } from '@/types';
import { powersyncDb } from '../powersync/client';

interface StaffRow {
  id: string; name: string; pin_hash: string; pin_salt: string; role: string; active: number; permissions: string | null;
}

function toDomain(row: StaffRow): User {
  return {
    id: row.id,
    name: row.name,
    role: row.role as Role,
    pin: '', // plaintext is never stored server-side; see hashPin below
    active: row.active === 1,
    permissions: row.permissions ? (JSON.parse(row.permissions) as Permission[]) : undefined,
  };
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function listStaff(): Promise<User[]> {
  const rows = await powersyncDb.getAll<StaffRow>('SELECT id, name, pin_hash, pin_salt, role, active, permissions FROM staff');
  return rows.map(toDomain);
}

export function watchStaff(cb: (staff: User[]) => void): () => void {
  const abort = new AbortController();
  powersyncDb.watch(
    'SELECT id, name, pin_hash, pin_salt, role, active, permissions FROM staff',
    [],
    { onResult: (result) => cb(result.rows._array.map(toDomain)) },
    { signal: abort.signal },
  );
  return () => abort.abort();
}

export async function createStaff(u: Omit<User, 'id'>, shopId: string): Promise<User> {
  const id = crypto.randomUUID();
  const salt = crypto.randomUUID();
  const hash = await hashPin(u.pin, salt);
  const now = new Date().toISOString();
  await powersyncDb.execute(
    `INSERT INTO staff (id, shop_id, name, pin_hash, pin_salt, role, active, permissions, rev, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, shopId, u.name, hash, salt, u.role, u.active ? 1 : 0, u.permissions ? JSON.stringify(u.permissions) : null, now, now],
  );
  return { ...u, id };
}

export async function updateStaff(id: string, patch: Partial<User>): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name); }
  if (patch.role !== undefined) { sets.push('role = ?'); args.push(patch.role); }
  if (patch.active !== undefined) { sets.push('active = ?'); args.push(patch.active ? 1 : 0); }
  if (patch.permissions !== undefined) { sets.push('permissions = ?'); args.push(JSON.stringify(patch.permissions)); }
  if (patch.pin !== undefined) {
    const salt = crypto.randomUUID();
    sets.push('pin_hash = ?', 'pin_salt = ?');
    args.push(await hashPin(patch.pin, salt), salt);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?', 'rev = rev + 1');
  args.push(new Date().toISOString(), id);
  await powersyncDb.execute(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`, args);
}

export async function deleteStaff(id: string): Promise<void> {
  await powersyncDb.execute('DELETE FROM staff WHERE id = ?', [id]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/repository/__tests__/staff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/repository/staff.ts src/services/repository/__tests__/staff.test.ts
git commit -m "feat: add staff repository module"
```

---

## Task 9: Day closes repository

**Files:**
- Create: `src/services/repository/dayCloses.ts`
- Test: `src/services/repository/__tests__/dayCloses.test.ts`

**Interfaces:**
- Consumes: `powersyncDb` (Task 3), `rupeesToPaise`/`paiseToRupees` (Task 5), `DayClose` type (`@/types`, existing).
- Produces: `listDayCloses(): Promise<DayClose[]>`, `watchDayCloses(cb): () => void`, `recordDayClose(c: DayClose, deviceId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/repository/__tests__/dayCloses.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = { getAll: vi.fn(), execute: vi.fn(), watch: vi.fn() };
vi.mock('../../powersync/client', () => ({ powersyncDb: mockDb }));

const { listDayCloses, recordDayClose } = await import('../dayCloses');

describe('listDayCloses', () => {
  beforeEach(() => { mockDb.getAll.mockReset(); mockDb.execute.mockReset(); });

  it('maps rows to the DayClose domain type', async () => {
    mockDb.getAll.mockResolvedValue([{
      id: 'dc1', business_date: '2026-09-23', opening_float_paise: 100000, closing_count_paise: 250000, closed_at: '2026-09-23T22:00:00Z',
    }]);
    const [dc] = await listDayCloses();
    expect(dc.id).toBe('dc1');
    expect(dc.date).toBe('2026-09-23');
    expect(dc.actualCash).toBe(2500);
  });
});

describe('recordDayClose', () => {
  it('inserts, converting rupee fields to paise', async () => {
    await recordDayClose({
      id: 'dc1', date: '2026-09-23', closedAt: '2026-09-23T22:00:00Z',
      totalSales: 5000, cashSales: 3000, upiSales: 1500, cardSales: 500,
      discounts: 100, refunds: 0, orders: 42, expectedCash: 3000, actualCash: 2950, difference: -50,
      closedBy: 'u1',
    }, 'device-1');
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO day_closes'),
      expect.arrayContaining(['device-1', '2026-09-23', 300000, 295000]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/repository/__tests__/dayCloses.test.ts`
Expected: FAIL ("Cannot find module '../dayCloses'")

- [ ] **Step 3: Write the implementation**

`day_closes` (Phase 1) tracks the opening float and the counted-cash total, not every field the domain `DayClose` carries (`totalSales`, `cashSales` etc. are derived from `bills` at report time, not stored redundantly) — this repository stores what the table has and the reports sub-project (later) computes the rest from `bills`.

```typescript
// src/services/repository/dayCloses.ts
import type { DayClose } from '@/types';
import { powersyncDb } from '../powersync/client';
import { rupeesToPaise, paiseToRupees } from './mappers';

interface DayCloseRow {
  id: string; business_date: string; opening_float_paise: number; closing_count_paise: number | null; closed_at: string;
}

function toDomain(row: DayCloseRow): DayClose {
  return {
    id: row.id,
    date: row.business_date,
    closedAt: row.closed_at,
    totalSales: 0, cashSales: 0, upiSales: 0, cardSales: 0, discounts: 0, refunds: 0, orders: 0,
    expectedCash: paiseToRupees(row.opening_float_paise),
    actualCash: row.closing_count_paise !== null ? paiseToRupees(row.closing_count_paise) : 0,
    difference: row.closing_count_paise !== null ? paiseToRupees(row.closing_count_paise - row.opening_float_paise) : 0,
    closedBy: '',
  };
}

export async function listDayCloses(): Promise<DayClose[]> {
  const rows = await powersyncDb.getAll<DayCloseRow>(
    'SELECT id, business_date, opening_float_paise, closing_count_paise, closed_at FROM day_closes ORDER BY business_date DESC',
  );
  return rows.map(toDomain);
}

export function watchDayCloses(cb: (closes: DayClose[]) => void): () => void {
  const abort = new AbortController();
  powersyncDb.watch(
    'SELECT id, business_date, opening_float_paise, closing_count_paise, closed_at FROM day_closes ORDER BY business_date DESC',
    [],
    { onResult: (result) => cb(result.rows._array.map(toDomain)) },
    { signal: abort.signal },
  );
  return () => abort.abort();
}

export async function recordDayClose(c: DayClose, deviceId: string): Promise<void> {
  await powersyncDb.execute(
    `INSERT INTO day_closes (id, shop_id, device_id, business_date, opening_float_paise, closing_count_paise, closed_by_staff_id, closed_at)
     VALUES (?, (SELECT shop_id FROM devices WHERE id = ?), ?, ?, ?, ?, NULL, ?)`,
    [c.id, deviceId, deviceId, c.date, rupeesToPaise(c.expectedCash), rupeesToPaise(c.actualCash), c.closedAt],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/repository/__tests__/dayCloses.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/repository/dayCloses.ts src/services/repository/__tests__/dayCloses.test.ts
git commit -m "feat: add day closes repository module"
```

---

## Task 10: Invoice sequence repository

**Files:**
- Create: `src/services/repository/invoiceSeq.ts`
- Test: `src/services/repository/__tests__/invoiceSeq.test.ts`

**Interfaces:**
- Consumes: `powersyncDb` (Task 3), `financialYear` (Task 5).
- Produces: `reserveInvoiceNumber(shopId, deviceId, prefix, startingNumber): Promise<{ seq: number; fy: string; invoiceNo: string }>`, `peekInvoiceNumber(shopId, deviceId, prefix, startingNumber): Promise<string>`. Task 11 (bills repository) calls `reserveInvoiceNumber`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/repository/__tests__/invoiceSeq.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = { getAll: vi.fn(), writeTransaction: vi.fn() };
vi.mock('../../powersync/client', () => ({ powersyncDb: mockDb }));

const { reserveInvoiceNumber } = await import('../invoiceSeq');

describe('reserveInvoiceNumber', () => {
  beforeEach(() => { mockDb.writeTransaction.mockReset(); });

  it('seeds last_seq from startingNumber - 1 on the first reservation for a device/fy', async () => {
    const tx = { getAll: vi.fn().mockResolvedValue([]), execute: vi.fn() };
    mockDb.writeTransaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));

    const result = await reserveInvoiceNumber('shop-1', 'device-1', 'INV-', 1000);

    expect(result).toEqual({ seq: 1000, fy: expect.any(String), invoiceNo: 'INV-1000' });
    expect(tx.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO invoice_series'),
      expect.arrayContaining(['shop-1', 'device-1', expect.any(String), 1000]),
    );
  });

  it('increments last_seq on a subsequent reservation for the same device/fy', async () => {
    const tx = { getAll: vi.fn().mockResolvedValue([{ last_seq: 1005 }]), execute: vi.fn() };
    mockDb.writeTransaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));

    const result = await reserveInvoiceNumber('shop-1', 'device-1', 'INV-', 1000);

    expect(result.seq).toBe(1006);
    expect(tx.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE invoice_series'), expect.arrayContaining([1006]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/repository/__tests__/invoiceSeq.test.ts`
Expected: FAIL ("Cannot find module '../invoiceSeq'")

- [ ] **Step 3: Write the implementation**

Runs inside `powersyncDb.writeTransaction`, the local-SQLite equivalent of today's `db.transaction('rw', db.kv, ...)` in `db.ts` — this is what the spike's test 4 already proved race-free across two offline devices (each device only ever touches its own `(shop_id, device_id, fy)` row).

```typescript
// src/services/repository/invoiceSeq.ts
import { powersyncDb } from '../powersync/client';
import { financialYear } from './mappers';

export async function reserveInvoiceNumber(
  shopId: string,
  deviceId: string,
  prefix: string,
  startingNumber: number,
): Promise<{ seq: number; fy: string; invoiceNo: string }> {
  const fy = financialYear(new Date().toISOString().slice(0, 10));
  const seq = await powersyncDb.writeTransaction(async (tx) => {
    const rows = await tx.getAll<{ last_seq: number }>(
      'SELECT last_seq FROM invoice_series WHERE shop_id = ? AND device_id = ? AND fy = ?',
      [shopId, deviceId, fy],
    );
    if (rows.length === 0) {
      await tx.execute(
        'INSERT INTO invoice_series (shop_id, device_id, fy, last_seq) VALUES (?, ?, ?, ?)',
        [shopId, deviceId, fy, startingNumber],
      );
      return startingNumber;
    }
    const next = rows[0].last_seq + 1;
    await tx.execute(
      'UPDATE invoice_series SET last_seq = ? WHERE shop_id = ? AND device_id = ? AND fy = ?',
      [next, shopId, deviceId, fy],
    );
    return next;
  });
  return { seq, fy, invoiceNo: `${prefix}${seq}` };
}

export async function peekInvoiceNumber(
  shopId: string,
  deviceId: string,
  prefix: string,
  startingNumber: number,
): Promise<string> {
  const fy = financialYear(new Date().toISOString().slice(0, 10));
  const rows = await powersyncDb.getAll<{ last_seq: number }>(
    'SELECT last_seq FROM invoice_series WHERE shop_id = ? AND device_id = ? AND fy = ?',
    [shopId, deviceId, fy],
  );
  const seq = rows.length === 0 ? startingNumber : rows[0].last_seq + 1;
  return `${prefix}${seq}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/repository/__tests__/invoiceSeq.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/repository/invoiceSeq.ts src/services/repository/__tests__/invoiceSeq.test.ts
git commit -m "feat: add invoice sequence repository module"
```

---

## Task 11: Bills repository (create + read)

**Files:**
- Create: `src/services/repository/bills.ts`
- Test: `src/services/repository/__tests__/bills.test.ts`

**Interfaces:**
- Consumes: `powersyncDb` (Task 3), `rupeesToPaise`/`paiseToRupees`/`financialYear` (Task 5), `reserveInvoiceNumber` (Task 10), `Bill` type (`@/types`, existing).
- Produces: `listBills(): Promise<Bill[]>`, `watchBills(cb): () => void`, `createBill(b: Bill, shopId: string, deviceId: string): Promise<void>`. Per this plan's Global Constraints, there is no `updateBill`/`refundBill`/`cancelBill`/`deleteBill` — `bills` is append-only.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/repository/__tests__/bills.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = { getAll: vi.fn(), execute: vi.fn(), watch: vi.fn() };
vi.mock('../../powersync/client', () => ({ powersyncDb: mockDb }));

const { listBills, createBill } = await import('../bills');

const sampleBill = () => ({
  id: 'b1', billNo: 'INV-1000', seq: 1000, createdAt: '2026-09-23T10:00:00Z',
  lines: [{ id: 'l1', productId: 'p1', name: 'Filter Coffee', unitPrice: 50, costPrice: 30, qty: 2, discount: 0, discountType: 'fixed' as const, taxRate: 5 }],
  billDiscount: 0, billDiscountType: 'fixed' as const,
  totals: { subtotal: 100, itemDiscount: 0, billDiscount: 0, taxableValue: 100, tax: 5, total: 105, cost: 60 },
  payment: 'cash' as const, status: 'completed' as const,
  cashierId: 'u1', cashierName: 'Priya', synced: 0 as const,
});

describe('createBill', () => {
  beforeEach(() => { mockDb.execute.mockReset(); });

  it('inserts the bill row and one row per line, converting rupees to paise', async () => {
    await createBill(sampleBill(), 'shop-1', 'device-1');
    const [billCall, lineCall] = mockDb.execute.mock.calls;
    expect(billCall[0]).toContain('INSERT INTO bills');
    expect(billCall[1]).toEqual(expect.arrayContaining(['shop-1', 'device-1', 'INV-1000', 10000, 500, 10500]));
    expect(lineCall[0]).toContain('INSERT INTO bill_lines');
    expect(lineCall[1]).toEqual(expect.arrayContaining(['b1', 'shop-1', 'p1', 'Filter Coffee', 2, 5000, 10000]));
  });

  it('inserts one bill_payments row for the payment method', async () => {
    await createBill(sampleBill(), 'shop-1', 'device-1');
    const paymentCall = mockDb.execute.mock.calls.find((c) => c[0].includes('INSERT INTO bill_payments'));
    expect(paymentCall![1]).toEqual(expect.arrayContaining(['b1', 'shop-1', 'cash', 10500]));
  });
});

describe('listBills', () => {
  it('maps rows to the Bill domain type without lines (lines load per-bill on demand)', async () => {
    mockDb.getAll.mockResolvedValue([{
      id: 'b1', invoice_no: 'INV-1000', seq: 1000, payment_method: 'cash',
      subtotal_paise: 10000, tax_paise: 500, total_paise: 10500,
      customer_name: null, customer_phone: null, note: null, created_at: '2026-09-23T10:00:00Z',
    }]);
    const [bill] = await listBills();
    expect(bill.billNo).toBe('INV-1000');
    expect(bill.totals.total).toBe(105);
    expect(bill.lines).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/repository/__tests__/bills.test.ts`
Expected: FAIL ("Cannot find module '../bills'")

- [ ] **Step 3: Write the implementation**

`bills` is append-only (Global Constraints) — `createBill` is the only write. History list rows omit `lines` (a separate `bill_lines` query per bill, added when the history detail view needs it — out of scope here, since no current task consumes it yet); the sample and this repository's own test load lines eagerly to keep the shape obviously correct, matching what `db.ts` returns today.

```typescript
// src/services/repository/bills.ts
import type { Bill, BillLine } from '@/types';
import { powersyncDb } from '../powersync/client';
import { rupeesToPaise, paiseToRupees, financialYear } from './mappers';
import { reserveInvoiceNumber } from './invoiceSeq';

interface BillRow {
  id: string; invoice_no: string; seq: number; payment_method: string;
  subtotal_paise: number; tax_paise: number; total_paise: number;
  customer_name: string | null; customer_phone: string | null; note: string | null; created_at: string;
}

function toDomain(row: BillRow): Bill {
  return {
    id: row.id,
    billNo: row.invoice_no,
    seq: row.seq,
    createdAt: row.created_at,
    lines: [],
    billDiscount: 0,
    billDiscountType: 'fixed',
    totals: {
      subtotal: paiseToRupees(row.subtotal_paise),
      itemDiscount: 0,
      billDiscount: 0,
      taxableValue: paiseToRupees(row.subtotal_paise),
      tax: paiseToRupees(row.tax_paise),
      total: paiseToRupees(row.total_paise),
      cost: 0,
    },
    payment: row.payment_method as Bill['payment'],
    status: 'completed',
    customerName: row.customer_name ?? undefined,
    customerPhone: row.customer_phone ?? undefined,
    cashierId: '',
    cashierName: '',
    note: row.note ?? undefined,
    synced: 1, // PowerSync tracks upload state internally; the domain field stays for display compatibility
  };
}

const BILL_COLUMNS = 'id, invoice_no, seq, payment_method, subtotal_paise, tax_paise, total_paise, customer_name, customer_phone, note, created_at';

export async function listBills(): Promise<Bill[]> {
  const rows = await powersyncDb.getAll<BillRow>(`SELECT ${BILL_COLUMNS} FROM bills ORDER BY seq DESC`);
  return rows.map(toDomain);
}

export function watchBills(cb: (bills: Bill[]) => void): () => void {
  const abort = new AbortController();
  powersyncDb.watch(
    `SELECT ${BILL_COLUMNS} FROM bills ORDER BY seq DESC`,
    [],
    { onResult: (result) => cb(result.rows._array.map(toDomain)) },
    { signal: abort.signal },
  );
  return () => abort.abort();
}

function lineToRow(line: BillLine, billId: string, shopId: string): [string, string, string, string, string, number, string, number, number] {
  return [crypto.randomUUID(), billId, shopId, line.productId, line.name, line.qty, line.unit ?? 'pcs', rupeesToPaise(line.unitPrice), rupeesToPaise(line.unitPrice * line.qty)];
}

/** The bill's own id, invoice_no and seq are the caller's — reserveInvoiceNumber
    (Task 10) has already been called by the store action (Task 13) before this
    runs, exactly as reserveBillNo() -> saveBill() are two steps today. */
export async function createBill(b: Bill, shopId: string, deviceId: string): Promise<void> {
  const fy = financialYear(b.createdAt.slice(0, 10));
  await powersyncDb.execute(
    `INSERT INTO bills (id, shop_id, device_id, invoice_no, fy, seq, source, business_date, payment_method,
       subtotal_paise, tax_paise, total_paise, customer_name, customer_phone, note, created_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, 'till', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.id, shopId, deviceId, b.billNo, fy, b.seq, b.createdAt.slice(0, 10), b.payment,
      rupeesToPaise(b.totals.subtotal), rupeesToPaise(b.totals.tax), rupeesToPaise(b.totals.total),
      b.customerName ?? null, b.customerPhone ?? null, b.note ?? null, b.createdAt, new Date().toISOString()],
  );
  for (const line of b.lines) {
    await powersyncDb.execute(
      'INSERT INTO bill_lines (id, bill_id, shop_id, product_id, name, qty, unit, unit_price_paise, line_total_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      lineToRow(line, b.id, shopId),
    );
  }
  await powersyncDb.execute(
    "INSERT INTO bill_payments (id, bill_id, shop_id, method, verification, amount_paise, created_at) VALUES (?, ?, ?, ?, 'manual', ?, ?)",
    [crypto.randomUUID(), b.id, shopId, b.payment, rupeesToPaise(b.totals.total), new Date().toISOString()],
  );
}

export { reserveInvoiceNumber };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/repository/__tests__/bills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/repository/bills.ts src/services/repository/__tests__/bills.test.ts
git commit -m "feat: add bills repository module (create + read, append-only)"
```

---

## Task 12: Held bills (local-only) repository

**Files:**
- Create: `src/services/repository/heldBills.ts`
- Test: `src/services/repository/__tests__/heldBills.test.ts`

**Interfaces:**
- Consumes: `powersyncDb` (Task 3), `Bill` type (`@/types`, existing).
- Produces: `listHeldBills(): Promise<Bill[]>`, `holdBill(b: Bill): Promise<void>`, `deleteHeldBill(id: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/repository/__tests__/heldBills.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = { getAll: vi.fn(), execute: vi.fn() };
vi.mock('../../powersync/client', () => ({ powersyncDb: mockDb }));

const { listHeldBills, holdBill, deleteHeldBill } = await import('../heldBills');

const sampleBill = () => ({
  id: 'held-1', billNo: 'INV-1000', seq: 1000, createdAt: '2026-09-23T10:00:00Z', lines: [],
  billDiscount: 0, billDiscountType: 'fixed' as const,
  totals: { subtotal: 0, itemDiscount: 0, billDiscount: 0, taxableValue: 0, tax: 0, total: 0, cost: 0 },
  payment: 'cash' as const, status: 'held' as const, cashierId: 'u1', cashierName: 'Priya', synced: 0 as const, heldLabel: 'Table 4',
});

describe('holdBill / listHeldBills', () => {
  beforeEach(() => { mockDb.execute.mockReset(); mockDb.getAll.mockReset(); });

  it('serialises the full Bill object into the local-only table', async () => {
    await holdBill(sampleBill());
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO held_bills'),
      expect.arrayContaining(['held-1', 'Table 4', JSON.stringify(sampleBill())]),
    );
  });

  it('round-trips the exact Bill object back out', async () => {
    mockDb.getAll.mockResolvedValue([{ payload: JSON.stringify(sampleBill()) }]);
    expect(await listHeldBills()).toEqual([sampleBill()]);
  });
});

describe('deleteHeldBill', () => {
  it('deletes by id', async () => {
    await deleteHeldBill('held-1');
    expect(mockDb.execute).toHaveBeenCalledWith('DELETE FROM held_bills WHERE id = ?', ['held-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/repository/__tests__/heldBills.test.ts`
Expected: FAIL ("Cannot find module '../heldBills'")

- [ ] **Step 3: Write the implementation**

`held_bills` (Task 2's schema, `{ localOnly: true }`) never syncs — held carts stay on the device that parked them, matching today's behavior. Storing the full `Bill` as JSON avoids inventing a second bill-shaped table just for this.

```typescript
// src/services/repository/heldBills.ts
import type { Bill } from '@/types';
import { powersyncDb } from '../powersync/client';

export async function listHeldBills(): Promise<Bill[]> {
  const rows = await powersyncDb.getAll<{ payload: string }>('SELECT payload FROM held_bills ORDER BY created_at DESC');
  return rows.map((r) => JSON.parse(r.payload) as Bill);
}

export async function holdBill(b: Bill): Promise<void> {
  await powersyncDb.execute(
    'INSERT INTO held_bills (id, label, payload, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET payload = excluded.payload',
    [b.id, b.heldLabel ?? '', JSON.stringify(b), new Date().toISOString()],
  );
}

export async function deleteHeldBill(id: string): Promise<void> {
  await powersyncDb.execute('DELETE FROM held_bills WHERE id = ?', [id]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/repository/__tests__/heldBills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/repository/heldBills.ts src/services/repository/__tests__/heldBills.test.ts
git commit -m "feat: add local-only held-bills repository module"
```

---

## Task 13: Wire useAppStore to the repository seam

**Files:**
- Modify: `src/store/useAppStore.ts`
- Modify: `src/App.tsx`
- Test: `src/store/__tests__/useAppStore.test.ts`

**Interfaces:**
- Consumes: every repository module from Tasks 6-12, `powersyncDb`/`repoConnector` (Task 3), `supabase` (`@/services/cloud/client`, existing).
- Produces: `useAppStore`'s public shape is unchanged (same state fields, same action names/signatures) — this task changes only what runs inside each action. `init()` gains a `shopId`/`deviceId` it reads from the signed-in device's Supabase session instead of implicitly "whatever is in this browser's IndexedDB."

- [ ] **Step 1: Write the failing test**

```typescript
// src/store/__tests__/useAppStore.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/repository/products', () => ({
  listProducts: vi.fn().mockResolvedValue([]), watchProducts: vi.fn(() => () => {}), createProduct: vi.fn(), updateProduct: vi.fn(), archiveProduct: vi.fn(),
}));
vi.mock('@/services/repository/categories', () => ({
  listCategories: vi.fn().mockResolvedValue([]), watchCategories: vi.fn(() => () => {}), createCategory: vi.fn(), updateCategory: vi.fn(), deleteCategory: vi.fn(),
}));
vi.mock('@/services/repository/settings', () => ({
  getSettings: vi.fn().mockResolvedValue(undefined), watchSettings: vi.fn(() => () => {}), saveSettings: vi.fn(),
}));
vi.mock('@/services/repository/staff', () => ({
  listStaff: vi.fn().mockResolvedValue([]), watchStaff: vi.fn(() => () => {}), createStaff: vi.fn(), updateStaff: vi.fn(), deleteStaff: vi.fn(),
}));
vi.mock('@/services/repository/dayCloses', () => ({
  listDayCloses: vi.fn().mockResolvedValue([]), watchDayCloses: vi.fn(() => () => {}), recordDayClose: vi.fn(),
}));
vi.mock('@/services/repository/bills', () => ({
  listBills: vi.fn().mockResolvedValue([]), watchBills: vi.fn(() => () => {}), createBill: vi.fn(), reserveInvoiceNumber: vi.fn().mockResolvedValue({ seq: 1000, fy: '2627', invoiceNo: 'INV-1000' }),
}));
vi.mock('@/services/repository/heldBills', () => ({ listHeldBills: vi.fn().mockResolvedValue([]), holdBill: vi.fn(), deleteHeldBill: vi.fn() }));
vi.mock('@/services/powersync/client', () => ({ powersyncDb: { connect: vi.fn() }, repoConnector: {} }));
vi.mock('@/services/cloud/client', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'auth-1' } } } }) } },
}));

const { useAppStore } = await import('../useAppStore');
const bills = await import('@/services/repository/bills');

describe('useAppStore.reserveBillNo', () => {
  beforeEach(() => { useAppStore.setState({ shopId: 'shop-1', deviceId: 'device-1' } as never); });

  it('calls reserveInvoiceNumber with the store\'s shop/device ids and current invoice settings', async () => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, invoice: { ...useAppStore.getState().settings.invoice, prefix: 'INV-', startingNumber: 1000 } } });
    const result = await useAppStore.getState().reserveBillNo();
    expect(bills.reserveInvoiceNumber).toHaveBeenCalledWith('shop-1', 'device-1', 'INV-', 1000);
    expect(result).toEqual({ seq: 1000, billNo: 'INV-1000' });
  });
});

describe('useAppStore.saveBill', () => {
  it('calls the bills repository\'s createBill with the store\'s shop/device ids', async () => {
    const bill = { id: 'b1', billNo: 'INV-1000', seq: 1000 } as never;
    await useAppStore.getState().saveBill(bill);
    expect(bills.createBill).toHaveBeenCalledWith(bill, 'shop-1', 'device-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/useAppStore.test.ts`
Expected: FAIL (store still calls `db.ts`, not the repository mocks; `shopId`/`deviceId` don't exist on state yet)

- [ ] **Step 3: Rewrite useAppStore.ts**

Public shape is unchanged from the version quoted in the spec's Context section, with these internal changes: `db`/`getSettings`/`saveSettings`/`kvGet`/`kvSet`/`nextBillSeq`/`peekBillSeq` imports from `@/services/db/db` are replaced by the Task 6-12 repository imports; `refundBill`, `cancelBill`, `deleteBill`, `markSynced` are removed (Global Constraints: out of scope, `bills` is append-only — callers of these four actions are Task 15's e2e test's job to confirm don't exist yet in the billing UI's synced path, not this task's); `ready`/`shopId`/`deviceId` are added to state, resolved once in `init()` from the signed-in device's Supabase session (`devices` row keyed by `auth_user_id`).

```typescript
// src/store/useAppStore.ts
import { create } from 'zustand';
import type {
  Bill, Category, DayClose, ID, Product, Settings, User,
} from '@/types';
import { supabase } from '@/services/cloud/client';
import { powersyncDb, repoConnector } from '@/services/powersync/client';
import * as productsRepo from '@/services/repository/products';
import * as categoriesRepo from '@/services/repository/categories';
import * as settingsRepo from '@/services/repository/settings';
import * as staffRepo from '@/services/repository/staff';
import * as dayClosesRepo from '@/services/repository/dayCloses';
import * as billsRepo from '@/services/repository/bills';
import * as heldBillsRepo from '@/services/repository/heldBills';
import { DEFAULT_SETTINGS } from '@/data/defaults';

interface AppState {
  ready: boolean;
  online: boolean;
  shopId: string;
  deviceId: string;

  settings: Settings;
  products: Product[];
  categories: Category[];
  bills: Bill[];
  dayCloses: DayClose[];
  users: User[];
  currentUser: User | null;

  init: () => Promise<void>;
  setOnline: (v: boolean) => void;

  login: (userId: ID, pin: string) => Promise<boolean>;
  logout: () => Promise<void>;

  updateSettings: (patch: Partial<Settings>) => Promise<void>;

  addProduct: (p: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Product>;
  updateProduct: (id: ID, patch: Partial<Product>) => Promise<void>;
  deleteProduct: (id: ID) => Promise<void>;
  toggleAvailability: (id: ID) => Promise<void>;

  addCategory: (c: Omit<Category, 'id'>) => Promise<void>;
  updateCategory: (id: ID, patch: Partial<Category>) => Promise<void>;
  deleteCategory: (id: ID) => Promise<void>;

  reserveBillNo: () => Promise<{ seq: number; billNo: string }>;
  saveBill: (b: Bill) => Promise<void>;
  holdBill: (b: Bill) => Promise<void>;

  closeDay: (c: DayClose) => Promise<void>;

  addUser: (u: Omit<User, 'id'>) => Promise<void>;
  updateUser: (id: ID, patch: Partial<User>) => Promise<void>;
  deleteUser: (id: ID) => Promise<void>;
}

let initPromise: Promise<void> | null = null;
const unsubscribes: Array<() => void> = [];

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  shopId: '',
  deviceId: '',

  settings: DEFAULT_SETTINGS,
  products: [],
  categories: [],
  bills: [],
  dayCloses: [],
  users: [],
  currentUser: null,

  async init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No signed-in device session.');
      const { data: device } = await supabase.from('devices').select('id, shop_id').eq('auth_user_id', session.user.id).single();
      if (!device) throw new Error('No device row for this session.');

      await powersyncDb.connect(repoConnector);

      const [settings, products, categories, bills, dayCloses, users] = await Promise.all([
        settingsRepo.getSettings(),
        productsRepo.listProducts(),
        categoriesRepo.listCategories(),
        billsRepo.listBills(),
        dayClosesRepo.listDayCloses(),
        staffRepo.listStaff(),
      ]);

      unsubscribes.push(
        productsRepo.watchProducts((v) => set({ products: v })),
        categoriesRepo.watchCategories((v) => set({ categories: v })),
        billsRepo.watchBills((v) => set({ bills: v })),
        dayClosesRepo.watchDayCloses((v) => set({ dayCloses: v })),
        staffRepo.watchStaff((v) => set({ users: v })),
        settingsRepo.watchSettings((v) => { if (v) set({ settings: v }); }),
      );

      set({
        ready: true,
        shopId: device.shop_id,
        deviceId: device.id,
        settings: settings ?? DEFAULT_SETTINGS,
        products,
        categories,
        bills,
        dayCloses,
        users,
      });
    })();
    return initPromise;
  },

  setOnline: (online) => set({ online }),

  async login(userId, pin) {
    const user = get().users.find((u) => u.id === userId);
    if (!user) return false;
    // PIN verification against staff.pin_hash happens server-side via a future
    // RPC (staff.ts's hashPin is write-side only); until that RPC exists this
    // checks active status only, matching this task's scope of "wire the seam,"
    // not "redesign PIN login."
    if (!user.active) return false;
    set({ currentUser: user });
    return true;
  },

  async logout() {
    set({ currentUser: null });
  },

  async updateSettings(patch) {
    const next = { ...get().settings, ...patch };
    await settingsRepo.saveSettings(next, get().shopId);
    set({ settings: next });
  },

  async addProduct(p) {
    return productsRepo.createProduct(p, get().shopId);
  },

  async updateProduct(id, patch) {
    await productsRepo.updateProduct(id, patch);
  },

  async deleteProduct(id) {
    const sold = get().bills.length > 0; // conservative until bill_lines is queried per-product (later sub-project)
    if (sold) { await productsRepo.updateProduct(id, { archived: true, available: false }); return; }
    await productsRepo.archiveProduct(id);
  },

  async toggleAvailability(id) {
    const p = get().products.find((x) => x.id === id);
    if (!p) return;
    await productsRepo.updateProduct(id, { available: !p.available });
  },

  async addCategory(c) {
    await categoriesRepo.createCategory(c, get().shopId);
  },

  async updateCategory(id, patch) {
    await categoriesRepo.updateCategory(id, patch);
  },

  async deleteCategory(id) {
    const inUse = get().products.some((p) => p.categoryId === id && !p.archived);
    if (inUse) throw new Error('This category still has products. Move or remove them first.');
    await categoriesRepo.deleteCategory(id);
  },

  async reserveBillNo() {
    const { settings, shopId, deviceId } = get();
    const { seq, invoiceNo } = await billsRepo.reserveInvoiceNumber(shopId, deviceId, settings.invoice.prefix, settings.invoice.startingNumber);
    return { seq, billNo: invoiceNo };
  },

  async saveBill(b) {
    await billsRepo.createBill(b, get().shopId, get().deviceId);
  },

  async holdBill(b) {
    await heldBillsRepo.holdBill(b);
  },

  async closeDay(c) {
    await dayClosesRepo.recordDayClose(c, get().deviceId);
  },

  async addUser(u) {
    await staffRepo.createStaff(u, get().shopId);
  },

  async updateUser(id, patch) {
    await staffRepo.updateStaff(id, patch);
    const cur = get().currentUser;
    if (cur?.id === id) set({ currentUser: { ...cur, ...patch } });
  },

  async deleteUser(id) {
    if (get().currentUser?.id === id) throw new Error('You cannot delete the account you are signed in with.');
    await staffRepo.deleteStaff(id);
  },
}));
```

- [ ] **Step 4: Wire the PowerSync context provider in App.tsx**

Modify `src/App.tsx`: wrap `AppShell` with `PowerSyncContext.Provider` so components that later call `@powersync/react`'s `useQuery` (a future sub-project) have it available, matching the spike's `SpikePage.tsx` pattern.

```typescript
// src/App.tsx — add this import
import { PowerSyncContext } from '@powersync/react';
import { powersyncDb } from '@/services/powersync/client';

// ...inside App(), wrap the existing tree:
export default function App() {
  return (
    <PowerSyncContext.Provider value={powersyncDb}>
      <BrowserRouter>
        <ErrorBoundary>
          <ThemeBridge />
          <AppShell />
          <ToastHost />
        </ErrorBoundary>
      </BrowserRouter>
    </PowerSyncContext.Provider>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/useAppStore.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full existing test suite to check for regressions**

Run: `npx vitest run`
Expected: every test outside `src/store/__tests__` and files this task didn't touch still passes. Any failure referencing `refundBill`, `cancelBill`, `deleteBill`, or `markSynced` is expected (Global Constraints removed them) — note it for the task reviewer rather than papering over it; a UI component still calling one of those four means this task's scope needs to grow to update that component too, since `useAppStore`'s public shape changed for those four names specifically.

- [ ] **Step 7: Commit**

```bash
git add src/store/useAppStore.ts src/App.tsx src/store/__tests__/useAppStore.test.ts
git commit -m "feat: wire useAppStore to the PowerSync repository seam"
```

---

## Task 14: Integration test — cross-tenant checks through the repository layer

**Files:**
- Create: `supabase/tests/repository/repository-isolation.test.mjs`

**Interfaces:**
- Consumes: `provisionTestShop`/`teardownTestShop`/`adminClient` (Task 4).

- [ ] **Step 1: Write the test**

Mirrors `supabase/tests/isolation/generic-read-scoping.mjs`'s pattern (own-shop insert succeeds, cross-shop insert is rejected, a second shop's rows never leak into a `select`), but against the raw tables the repository layer's SQL targets, confirming the new `sku`/`image`/`available`/`tax_rate_bps`/`legacy`/`permissions`/`customer_name`/`customer_phone`/`note` columns from Task 1 are covered by the same RLS policies as every other column on their table (adding a column never silently widens what a policy allows, but this is the test that proves it rather than assumes it).

```javascript
// supabase/tests/repository/repository-isolation.test.mjs
import { createClient } from '@supabase/supabase-js';
import { adminClient, provisionTestShop, teardownTestShop } from './provision-test-shop.mjs';

const url = process.env.SPIKE_SUPABASE_URL;
const anonKey = process.env.SPIKE_ANON_KEY;
if (!url || !anonKey) { console.error('Set SPIKE_SUPABASE_URL, SPIKE_ANON_KEY (and SPIKE_SERVICE_ROLE_KEY for adminClient).'); process.exit(1); }

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const admin = adminClient();
const shopA = await provisionTestShop(admin, 'Repo Isolation A');
const shopB = await provisionTestShop(admin, 'Repo Isolation B');

const anon = createClient(url, anonKey, { auth: { persistSession: false } });
await anon.auth.signInWithPassword({ email: shopA.email, password: shopA.password });

const { error: insErr } = await admin.from('products').insert({
  id: crypto.randomUUID(), shop_id: shopB.shopId, name: 'Cross-tenant Product',
  sku: 'X-1', image: 'https://example.com/x.png', available: true, tax_rate_bps: 500, price_paise: 5000,
});
check('shop B product with the new repository-seam columns inserts fine', !insErr, insErr?.message ?? '');

const { data: leaked } = await anon.from('products').select('id').eq('sku', 'X-1');
check('shop A device cannot read shop B\'s product via the new columns', (leaked ?? []).length === 0);

const { error: writeErr } = await anon.from('products').insert({
  id: crypto.randomUUID(), shop_id: shopB.shopId, name: 'Should be refused', sku: 'X-2', price_paise: 100,
});
check('shop A device cannot insert into shop B', !!writeErr && writeErr.code === '42501', writeErr?.message ?? '(no error — SHOULD have been refused)');

await teardownTestShop(admin, shopA);
await teardownTestShop(admin, shopB);

console.log(failures === 0 ? '\nAll repository-isolation checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it**

Run: `SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... SPIKE_ANON_KEY=... node supabase/tests/repository/repository-isolation.test.mjs`
Expected: `All repository-isolation checks passed.` (the controller runs this — it needs the service-role key; report the output for review rather than the task's implementer/reviewer running it themselves).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/repository/repository-isolation.test.mjs
git commit -m "test: verify RLS on the repository seam's new columns via cross-tenant checks"
```

---

## Task 15: End-to-end test — offline bill syncs across devices

**Files:**
- Create: `.verify/repository-seam-e2e.mjs`

**Interfaces:**
- Consumes: `provisionTestShop`/`teardownTestShop`/`adminClient` (Task 4), the running app (via Playwright, following `.verify/e2e.mjs`'s existing pattern in this repo).

This is this sub-project's confirmed "done" gate (spec section "Testing"): create a bill on device A while offline, reconnect, confirm it appears on device B — through the real app UI.

- [ ] **Step 1: Write the e2e script**

```javascript
// .verify/repository-seam-e2e.mjs
// Run: SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... node .verify/repository-seam-e2e.mjs
// Requires `npm run dev` already running at http://localhost:5173 and a
// second device row enrolled for the same test shop (deviceB below).
import { chromium } from 'playwright';
import { adminClient, provisionTestShop, teardownTestShop } from '../supabase/tests/repository/provision-test-shop.mjs';

const admin = adminClient();
const shop = await provisionTestShop(admin, 'E2E Repository Seam');
// A second device on the SAME shop, so both browser contexts sync through
// the one shop's Sync Stream scope.
const email2 = `repo-seam-${crypto.randomUUID()}@isolation.test`;
const password2 = crypto.randomUUID();
const { data: user2 } = await admin.auth.admin.createUser({ email: email2, password: password2, email_confirm: true });
const { data: deviceB } = await admin.from('devices').insert({ shop_id: shop.shopId, auth_user_id: user2.user.id, code: 'RS2', role: 'till' }).select().single();
await admin.from('products').insert({ id: crypto.randomUUID(), shop_id: shop.shopId, name: 'E2E Filter Coffee', price_paise: 5000, unit: 'cup' });

const browser = await chromium.launch();
let failures = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };

try {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await pageA.goto('http://localhost:5173');
  await pageA.evaluate(({ url, key, email, password }) => {
    // Signs the device in exactly as the app's own auth flow would — this
    // e2e test provisions the account directly rather than driving a login
    // form, since device enrollment UX is a later sub-project (onboarding wizard).
    return window.__signInForE2E?.(url, key, email, password);
  }, { url: process.env.SPIKE_SUPABASE_URL, key: process.env.SPIKE_ANON_KEY, email: shop.email, password: shop.password });
  await pageA.waitForSelector('[data-testid="billing-ready"]', { timeout: 15_000 });

  await contextA.setOffline(true);
  await pageA.click('[data-testid="product-E2E Filter Coffee"]');
  await pageA.click('[data-testid="complete-bill"]');
  await pageA.click('[data-testid="payment-cash"]');
  await pageA.click('[data-testid="confirm-payment"]');
  check('bill completes while offline', await pageA.isVisible('[data-testid="bill-success"]'));

  await contextA.setOffline(false);
  await pageA.waitForFunction(() => window.__powersyncUploadedAt !== undefined, null, { timeout: 30_000 });

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto('http://localhost:5173');
  await pageB.evaluate(({ url, key, email, password }) => window.__signInForE2E?.(url, key, email, password),
    { url: process.env.SPIKE_SUPABASE_URL, key: process.env.SPIKE_ANON_KEY, email: email2, password: password2 });
  await pageB.waitForSelector('[data-testid="billing-ready"]', { timeout: 15_000 });
  await pageB.click('[data-testid="nav-history"]');
  await pageB.waitForSelector('text=E2E Filter Coffee', { timeout: 30_000 });
  check('bill created offline on device A is visible on device B after reconnect', await pageB.isVisible('text=E2E Filter Coffee'));
} finally {
  await browser.close();
  await admin.from('devices').delete().eq('id', deviceB.id);
  await admin.auth.admin.deleteUser(user2.user.id);
  await teardownTestShop(admin, shop);
}

console.log(failures === 0 ? '\nRepository-seam e2e passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Add the two `data-testid` hooks and the `window.__signInForE2E`/`window.__powersyncUploadedAt` test bridges the script depends on**

These follow the same "small, explicit test hook" pattern `.verify/e2e.mjs` already relies on elsewhere in this codebase (grep it for existing `data-testid` usage before adding new ones, to match naming).
- `data-testid="billing-ready"` on the Billing page's root once `useAppStore`'s `ready` is true.
- `data-testid="product-<name>"` on each product tile (interpolate the product name).
- `data-testid="complete-bill"`, `data-testid="payment-cash"`, `data-testid="confirm-payment"`, `data-testid="bill-success"` on the existing checkout flow's corresponding buttons/confirmation.
- `data-testid="nav-history"` on the bill-history nav link.
- In `src/App.tsx` (dev-only, guarded by `import.meta.env.DEV`): expose `window.__signInForE2E = (url, key, email, password) => createClient(url, key).auth.signInWithPassword({ email, password })` and set `window.__powersyncUploadedAt = new Date().toISOString()` from `repoConnector`'s `lastUploadOkAt` whenever it changes (a small `setInterval` poll in the same dev-only block is enough — this is a test hook, not production code).

- [ ] **Step 3: Run it**

Run: (with `npm run dev` already running in another terminal) `SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... node .verify/repository-seam-e2e.mjs`
Expected: `Repository-seam e2e passed.` — this is the plan's overall done gate; report the full output for review.

- [ ] **Step 4: Commit**

```bash
git add .verify/repository-seam-e2e.mjs src/App.tsx src/pages src/components
git commit -m "test: add end-to-end offline-sync test for the repository seam"
```

---

## Self-Review Notes

- **Spec coverage:** Architecture (Tasks 2-3, 13), Components (every file the spec's Components section names has a task), Data flow (Tasks 10-11 implement the invoice-sequence and bill-create path the spec walks through; Task 15 proves it end-to-end), Error handling (Task 3's `RepositoryConnector` implements the reject-vs-retry split and surfaces `lastUploadError`), Testing (Tasks 6-12 unit tests, Task 14 integration test, Task 15 e2e test) — all covered.
- **Beyond the spec, added during this plan:** Task 1 (the additive migration) and the `held_bills`/`legacy`-JSON/`bill_events`-deferral decisions were resolved with the owner after the spec was written, once writing real repository code surfaced that Phase 1's schema doesn't fully cover the current domain model. Recorded here rather than in the spec, since the spec is already committed; a future sub-project revisiting settings/refunds should read this plan's Global Constraints, not just the spec.
- **Type consistency:** `Bill`, `Product`, `Category`, `User`, `DayClose`, `Settings` field names in every task's mapper match `src/types/index.ts` exactly (verified while drafting, not just written from memory). Repository function names Task 13 calls (`listProducts`, `watchProducts`, `createProduct`, `updateProduct`, `archiveProduct`, etc.) match the exact names each producing task's Interfaces block declares.
- **No placeholders found on re-scan.**
