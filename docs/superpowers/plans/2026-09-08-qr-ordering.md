# QR Ordering, Online Payment and Kitchen Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer scans a table QR, orders on their phone, signs in with Google, pays through Razorpay, and the paid order becomes a bill on the billing portal and a KOT on the kitchen display carrying their name and contact number.

**Architecture:** Supabase (Postgres + realtime + edge functions) sits between the customer's phone and the existing device-local POS. It holds only what must cross devices — published menu, customer identity, live orders, payment state. IndexedDB stays the source of truth for bills, so the walk-in till keeps working offline. The Razorpay webhook is the sole writer of `PAID`, and `PAID` is what releases the KOT.

**Tech Stack:** React 19, TypeScript, Vite 8, Tailwind 4, Dexie, Zustand, React Router 7, Supabase (Postgres/Auth/Realtime/Edge Functions on Deno), Razorpay Checkout, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-08-qr-ordering-design.md`

## Global Constraints

- **Money is integer paise, never floating point.** All totals flow through `computeBill` in `src/services/billing/calc.ts`. Never add or multiply rupee floats.
- **`PAID` is written in exactly one place** — `supabase/functions/verify-payment`. No other file may set that status.
- **The kitchen never sees an unpaid order.** Kitchen queries and subscriptions filter `status` to `PAID` and later.
- **The `service_role` key is never committed and never reaches the browser.** It lives in edge-function secrets and `.env.local` only. Only `.env.example` with placeholders is committed.
- **The existing offline guarantee is preserved.** No change may make `/billing`, `/products`, `/reports`, `/settings` or `/day-close` depend on the network.
- **Cost price never leaves the device.** `menu_items` has no cost column; nothing publishes `costPrice`.
- **Supabase project:** ref `hiwufsjnhfrzevjvfefp`, URL `https://hiwufsjnhfrzevjvfefp.supabase.co`.
- **The owner runs all migrations.** Tasks produce SQL files; they never assume the agent can reach the database.
- **Path alias:** `@/` resolves to `src/`. Follow it in every import.
- **Tests:** Vitest, `describe`/`it`/`expect` imported explicitly from `vitest`. Run with `npm test`.
- **Commit after every task.** Conventional commit prefixes (`feat:`, `test:`, `chore:`, `fix:`).

## Phase map

Each phase ends with something demonstrable.

| Phase | Tasks | You can see |
|---|---|---|
| 1 — Foundations | 1–4 | Types, shared money engine, cloud config, migrations ready to run |
| 2 — Menu publish | 5–7 | Menu published to Supabase from Settings; table QR codes printable |
| 3 — Customer app | 8–11 | Scan → menu → cart → Google sign-in → phone captured |
| 4 — Payment | 12–15 | Real Razorpay test payment; order reaches `PAID` via verified webhook |
| 5 — Portal & kitchen | 16–20 | Bill auto-created on the till; KOT on the kitchen screen; live status on the phone |
| 6 — Cashier workflow | 21–24 | The order announces itself, is marked in history, and lands on the day close |

## File structure

**Created**

| File | Responsibility |
|---|---|
| `src/types/order.ts` | Order, order line, customer, status enum — the cross-device contract |
| `src/services/cloud/client.ts` | Supabase browser client (anon key only) |
| `src/services/cloud/menu.ts` | Publish local menu upstream; read published menu |
| `src/services/cloud/orders.ts` | Order queries and realtime subscriptions |
| `src/services/cloud/status.ts` | Status enum helpers and legal-transition rules |
| `src/services/billing/kot.ts` | KOT docket HTML and printing |
| `src/services/billing/orderToBill.ts` | Convert a paid cloud order into a local `Bill` |
| `src/features/customer/useCustomerCart.ts` | Customer-side cart store |
| `src/features/customer/useCustomerAuth.ts` | Google sign-in and phone capture |
| `src/pages/Customer/MenuPage.tsx` | Table-scoped menu and cart |
| `src/pages/Customer/CheckoutPage.tsx` | Identity, phone, payment launch |
| `src/pages/Customer/OrderStatusPage.tsx` | Live order status |
| `src/pages/Kitchen/KitchenPage.tsx` | Kitchen display screen |
| `src/pages/Billing/OnlineOrdersPage.tsx` | Live view of paid online orders on the portal |
| `src/features/orders/useOrderAlerts.ts` | Decides what counts as a newly arrived order |
| `src/features/orders/OrderAlertHost.tsx` | The non-blocking arrival banner |
| `supabase/migrations/0001_qr_ordering.sql` | Schema |
| `supabase/migrations/0002_rls.sql` | Row-level security policies |
| `supabase/functions/_shared/calc.ts` | Deno copy of the money engine |
| `supabase/functions/create-order/index.ts` | Recompute totals, create Razorpay order |
| `supabase/functions/verify-payment/index.ts` | HMAC verify, sole writer of `PAID` |
| `.env.example` | Placeholder configuration |

**Modified**

| File | Change |
|---|---|
| `src/types/index.ts` | Add `Bill.sourceOrderId`; re-export order types |
| `src/routes/index.tsx` | Public `/order/*` routes; `/kitchen` behind `kot`; `/billing/online` |
| `vite.config.ts` | Exclude customer routes from the POS service worker fallback |
| `vitest.config.ts` | Widen test include to cover `supabase/functions` |
| `src/pages/Settings/SettingsPage.tsx` | Online Ordering tab |
| `package.json` | Add `@supabase/supabase-js` |

---

## Phase 1 — Foundations

### Task 1: Order types and status rules

**Files:**
- Create: `src/types/order.ts`
- Create: `src/services/cloud/status.ts`
- Modify: `src/types/index.ts` (add `sourceOrderId` to `Bill`, re-export order types)
- Test: `src/services/cloud/__tests__/status.test.ts`

**Interfaces:**
- Consumes: `ID`, `ISODateTime` from `@/types`
- Produces: `OrderStatus`, `CloudOrder`, `CloudOrderLine`, `CloudCustomer`, `KITCHEN_VISIBLE`, `canTransition(from, to)`, `isKitchenVisible(status)`

- [ ] **Step 1: Write the failing test**

Create `src/services/cloud/__tests__/status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canTransition, isKitchenVisible } from '../status';

describe('canTransition', () => {
  it('walks the happy path', () => {
    expect(canTransition('AWAITING_PAYMENT', 'PAID')).toBe(true);
    expect(canTransition('PAID', 'ACCEPTED')).toBe(true);
    expect(canTransition('ACCEPTED', 'PREPARING')).toBe(true);
    expect(canTransition('PREPARING', 'READY')).toBe(true);
    expect(canTransition('READY', 'SERVED')).toBe(true);
  });

  it('never lets an unpaid order reach the kitchen', () => {
    expect(canTransition('AWAITING_PAYMENT', 'PREPARING')).toBe(false);
    expect(canTransition('AWAITING_PAYMENT', 'ACCEPTED')).toBe(false);
    expect(canTransition('PAYMENT_FAILED', 'PAID')).toBe(false);
  });

  it('refuses to move backwards or out of a terminal state', () => {
    expect(canTransition('READY', 'PREPARING')).toBe(false);
    expect(canTransition('SERVED', 'READY')).toBe(false);
    expect(canTransition('CANCELLED', 'PAID')).toBe(false);
  });

  it('allows cancelling anything not yet served', () => {
    expect(canTransition('PAID', 'CANCELLED')).toBe(true);
    expect(canTransition('PREPARING', 'CANCELLED')).toBe(true);
    expect(canTransition('SERVED', 'CANCELLED')).toBe(false);
  });
});

describe('isKitchenVisible', () => {
  it('hides orders that have not been paid for', () => {
    expect(isKitchenVisible('AWAITING_PAYMENT')).toBe(false);
    expect(isKitchenVisible('PAYMENT_FAILED')).toBe(false);
  });

  it('shows paid work the kitchen still has to do', () => {
    expect(isKitchenVisible('PAID')).toBe(true);
    expect(isKitchenVisible('ACCEPTED')).toBe(true);
    expect(isKitchenVisible('PREPARING')).toBe(true);
    expect(isKitchenVisible('READY')).toBe(true);
  });

  it('drops finished and cancelled tickets off the screen', () => {
    expect(isKitchenVisible('SERVED')).toBe(false);
    expect(isKitchenVisible('CANCELLED')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- status`
Expected: FAIL — cannot resolve `../status`.

- [ ] **Step 3: Write the types**

Create `src/types/order.ts`:

```ts
import type { ID, ISODateTime } from './index';

/* The cross-device contract. These shapes exist in Postgres as well as in the
   browser, so field names here match the SQL columns exactly (snake_case is
   mapped at the client boundary in services/cloud). */

export type OrderStatus =
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'PAYMENT_FAILED'
  | 'CANCELLED';

export interface CloudOrderLine {
  id: ID;
  orderId: ID;
  productId: ID;
  name: string;
  unitPrice: number;
  qty: number;
  taxRate: number;
  note?: string;
}

export interface CloudOrder {
  id: ID;
  token: string;            // A-07 — what gets called out
  tableCode: string;        // T04
  customerId: ID | null;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  subtotal: number;
  tax: number;
  total: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  billId?: ID;              // set by the till once a local Bill exists
  note?: string;
  createdAt: ISODateTime;
  paidAt?: ISODateTime;
  acceptedAt?: ISODateTime;
  readyAt?: ISODateTime;
  servedAt?: ISODateTime;
  lines: CloudOrderLine[];
}

export interface CloudCustomer {
  id: ID;                   // Supabase auth uid
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string;
  phoneVerified: boolean;   // false under Google sign-in; the switch for OTP later
}

/** What the customer's phone shows for each status. */
export const STATUS_LABELS: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Waiting for payment',
  PAID: 'Payment received',
  ACCEPTED: 'Order accepted',
  PREPARING: 'Being prepared',
  READY: 'Ready',
  SERVED: 'Served',
  PAYMENT_FAILED: 'Payment failed',
  CANCELLED: 'Cancelled',
};
```

- [ ] **Step 4: Write the status rules**

Create `src/services/cloud/status.ts`:

```ts
import type { OrderStatus } from '@/types/order';

/* The status graph is the spine of the whole feature. Encoding it as data —
   rather than scattered `if` checks — is what guarantees that no code path can
   walk an unpaid order into the kitchen. */

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  AWAITING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAID: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['SERVED', 'CANCELLED'],
  SERVED: [],
  PAYMENT_FAILED: ['CANCELLED'],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Tickets the cooking department should see: paid, and not yet finished. */
export const KITCHEN_VISIBLE: OrderStatus[] = ['PAID', 'ACCEPTED', 'PREPARING', 'READY'];

export const isKitchenVisible = (s: OrderStatus): boolean => KITCHEN_VISIBLE.includes(s);
```

- [ ] **Step 5: Add `sourceOrderId` to the Bill type**

In `src/types/index.ts`, inside `interface Bill`, immediately after the `heldLabel?: string;` line, add:

```ts
  sourceOrderId?: ID;       // set when this bill came from a QR order
```

Then at the end of `src/types/index.ts`, add:

```ts
export type {
  OrderStatus, CloudOrder, CloudOrderLine, CloudCustomer,
} from './order';
export { STATUS_LABELS } from './order';
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test -- status`
Expected: PASS, 4 `canTransition` cases and 3 `isKitchenVisible` cases.

- [ ] **Step 7: Confirm nothing else broke**

Run: `npm test && npx tsc -b`
Expected: all existing tests still pass; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/types/order.ts src/types/index.ts src/services/cloud/status.ts src/services/cloud/__tests__/status.test.ts
git commit -m "feat: add cloud order types and status transition rules"
```

---

### Task 2: Share the money engine with Deno

**Files:**
- Create: `supabase/functions/_shared/calc.ts`
- Modify: `vitest.config.ts` (widen the test include glob)
- Test: `supabase/functions/_shared/__tests__/calc-parity.test.ts`

**Interfaces:**
- Consumes: `computeBill`, `apportion` from `@/services/billing/calc`
- Produces: a Deno-importable `computeBill` with byte-identical behaviour

**Why this task exists:** the customer's phone and the server must agree on the total to the paise. Two copies of the maths would drift. `computeBill` is already pure — no DOM, no Dexie — so it runs unchanged under Deno. This task copies it with an import shim and adds a parity test that fails if the two ever diverge.

- [ ] **Step 1: Widen the Vitest include**

Replace the `test` block in `vitest.config.ts`:

```ts
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
  },
```

- [ ] **Step 2: Write the failing parity test**

Create `supabase/functions/_shared/__tests__/calc-parity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeBill as browserCompute } from '../../../../src/services/billing/calc';
import { computeBill as denoCompute } from '../calc';
import type { BillLine } from '../../../../src/types';

const line = (over: Partial<BillLine>): BillLine => ({
  id: 'l', productId: 'p', name: 'Item', unitPrice: 25, costPrice: 9.8,
  qty: 1, discount: 0, discountType: 'percent', taxRate: 5, ...over,
});

const OPTS = { pricesIncludeTax: false, roundTotals: false };

describe('server money engine', () => {
  it('is a verbatim copy of the browser engine below the shim', () => {
    const root = join(__dirname, '..', '..', '..', '..');
    const browser = readFileSync(join(root, 'src/services/billing/calc.ts'), 'utf8');
    const deno = readFileSync(join(root, 'supabase/functions/_shared/calc.ts'), 'utf8');

    // The Deno file is the shim followed by calc.ts with its import lines
    // removed. Comparing the remainder is what catches drift.
    const belowShim = deno.replace(/^[\s\S]*?\/\* END SHIM \*\/\n/, '').trim();
    const withoutImports = browser.split('\n').filter((l) => !l.startsWith('import ')).join('\n').trim();
    expect(belowShim).toBe(withoutImports);
  });

  it('agrees with the browser on the plan §6 worked example', () => {
    const lines = [
      line({ unitPrice: 25, qty: 2, taxRate: 5 }),
      line({ unitPrice: 15, qty: 3, taxRate: 5 }),
      line({ unitPrice: 20, qty: 1, taxRate: 5 }),
    ];
    expect(denoCompute(lines, 10, 'fixed', OPTS)).toEqual(browserCompute(lines, 10, 'fixed', OPTS));
  });

  it('agrees on a mixed GST bill', () => {
    const lines = [
      line({ unitPrice: 120, qty: 1, taxRate: 12 }),
      line({ unitPrice: 45, qty: 3, taxRate: 5, discount: 10, discountType: 'percent' }),
    ];
    expect(denoCompute(lines, 5, 'percent', OPTS)).toEqual(browserCompute(lines, 5, 'percent', OPTS));
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npm test -- calc-parity`
Expected: FAIL — cannot resolve `../calc`.

- [ ] **Step 4: Create the Deno copy**

Copy the engine and prepend a shim that supplies the two types it imports, so the rest of the file stays identical:

```bash
mkdir -p supabase/functions/_shared
{
  cat <<'SHIM'
/* Deno copy of src/services/billing/calc.ts.

   The customer's phone and this server must agree on the total to the paise,
   so there is exactly one money engine and this file is a verbatim copy of it
   below the shim. The parity test in __tests__/calc-parity.test.ts fails if
   the two ever drift. Edit src/services/billing/calc.ts, then re-copy.

   Types and the money helpers are inlined rather than imported because Deno
   edge functions cannot resolve the app's `@/` path alias. The helper bodies
   are copied verbatim from src/utils/money.ts. */

type DiscountType = 'percent' | 'fixed';

interface BillLine {
  id: string; productId: string; name: string; unitPrice: number;
  costPrice: number; qty: number; discount: number;
  discountType: DiscountType; taxRate: number; note?: string;
}

interface BillTotals {
  subtotal: number; itemDiscount: number; billDiscount: number;
  taxableValue: number; tax: number; total: number; cost: number;
}

interface Product { sellingPrice: number; discount: number; discountType: DiscountType; }

const toPaise = (rupees: number): number => Math.round((rupees || 0) * 100);
const toRupees = (paise: number): number => paise / 100;
const money = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
/* END SHIM */
SHIM
  sed '/^import /d' src/services/billing/calc.ts
} > supabase/functions/_shared/calc.ts
```

Note: `sed '/^import /d'` removes both import lines. If `calc.ts` ever imports
another helper, add it to the shim — the parity test will not catch a missing
helper (it compares text, not compilation), but `npm test -- calc-parity` will
fail to import the module, which does catch it.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- calc-parity`
Expected: PASS, 3 cases.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/calc.ts supabase/functions/_shared/__tests__/calc-parity.test.ts vitest.config.ts
git commit -m "feat: share the money engine with Deno edge functions"
```

---

### Task 3: Database schema and RLS

**Files:**
- Create: `supabase/migrations/0001_qr_ordering.sql`
- Create: `supabase/migrations/0002_rls.sql`
- Create: `supabase/README.md`

**Interfaces:**
- Produces: tables `menu_items`, `customers`, `orders`, `order_lines`; function `next_order_token()`

**Note for the implementer:** you cannot run these. The owner applies them. Write the SQL, write the README that tells them how, and stop.

- [ ] **Step 1: Write the schema migration**

Create `supabase/migrations/0001_qr_ordering.sql`:

```sql
-- QR ordering: published menu, customers, orders.
-- Bills stay in the till's IndexedDB; only what must cross devices lives here.

create type order_status as enum (
  'AWAITING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING',
  'READY', 'SERVED', 'PAYMENT_FAILED', 'CANCELLED'
);

-- The menu the customer sees. Published explicitly from Settings, so a
-- half-finished price edit never reaches a diner.
-- Deliberately has NO cost column: cost price never leaves the device.
create table menu_items (
  id            text primary key,
  name          text not null,
  category_id   text not null,
  category_name text not null,
  price         numeric(10,2) not null check (price >= 0),
  tax_rate      numeric(5,2) not null default 0 check (tax_rate >= 0),
  image_url     text,
  available     boolean not null default true,
  sort_order    int not null default 0,
  published_at  timestamptz not null default now()
);

-- One row per signed-in diner. Google verifies the email; the phone is typed,
-- so phone_verified stays false until SMS OTP is switched on later.
create table customers (
  id             uuid primary key references auth.users(id) on delete cascade,
  name           text not null default '',
  email          text not null default '',
  email_verified boolean not null default false,
  phone          text not null default '',
  phone_verified boolean not null default false,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

create table orders (
  id                  uuid primary key default gen_random_uuid(),
  token               text not null,
  table_code          text not null,
  customer_id         uuid references customers(id) on delete set null,
  -- Name and phone are copied onto the order, not just linked, so a KOT stays
  -- complete and accurate even if the customer later edits their profile.
  customer_name       text not null default '',
  customer_phone      text not null default '',
  status              order_status not null default 'AWAITING_PAYMENT',
  subtotal            numeric(10,2) not null default 0,
  tax                 numeric(10,2) not null default 0,
  total               numeric(10,2) not null default 0,
  razorpay_order_id   text unique,
  -- Idempotency key for the webhook: Razorpay retries, and a repeat delivery
  -- must never produce a second bill or a second KOT.
  razorpay_payment_id text unique,
  bill_id             text,
  note                text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  accepted_at         timestamptz,
  ready_at            timestamptz,
  served_at           timestamptz
);

create index orders_status_created_idx on orders (status, created_at desc);
create index orders_customer_idx on orders (customer_id, created_at desc);

create table order_lines (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  product_id text not null,
  name       text not null,
  unit_price numeric(10,2) not null,
  qty        int not null check (qty > 0),
  tax_rate   numeric(5,2) not null default 0,
  note       text
);

create index order_lines_order_idx on order_lines (order_id);

-- Daily token counter: A-01, A-02 ... resets each day. This is the number
-- called out when food is ready, so it must be short and unique per day.
create table order_tokens (
  day        date primary key,
  last_value int not null default 0
);

create or replace function next_order_token()
returns text
language plpgsql
as $$
declare
  n int;
begin
  insert into order_tokens (day, last_value)
    values (current_date, 1)
    on conflict (day) do update set last_value = order_tokens.last_value + 1
    returning last_value into n;
  return 'A-' || lpad(n::text, 2, '0');
end;
$$;

-- Realtime: the till and the kitchen screen both subscribe to orders.
alter publication supabase_realtime add table orders;
```

- [ ] **Step 2: Write the RLS migration**

Create `supabase/migrations/0002_rls.sql`:

```sql
-- Row-level security. The anon key ships in the customer's browser, so RLS —
-- not key secrecy — is what protects the data.

alter table menu_items  enable row level security;
alter table customers   enable row level security;
alter table orders      enable row level security;
alter table order_lines enable row level security;

-- The menu is public: a diner reads it before signing in.
create policy menu_public_read on menu_items
  for select using (true);

-- A customer sees and edits only their own profile.
create policy customer_own_row on customers
  for select using (auth.uid() = id);
create policy customer_own_insert on customers
  for insert with check (auth.uid() = id);
create policy customer_own_update on customers
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- A customer reads only their own orders. They never write one directly:
-- orders are created by the create-order edge function, which prices them
-- from menu_items so a tampered client cannot underpay.
create policy order_own_read on orders
  for select using (auth.uid() = customer_id);

create policy order_line_own_read on order_lines
  for select using (
    exists (select 1 from orders o where o.id = order_lines.order_id and o.customer_id = auth.uid())
  );

-- No customer-facing update policy on orders. Status is moved only by the
-- edge functions and by staff, both of which use the service role and bypass
-- RLS entirely. This is what stops a customer marking their own order PAID.
```

- [ ] **Step 3: Write the owner instructions**

Create `supabase/README.md`:

```markdown
# Supabase setup

Project ref `hiwufsjnhfrzevjvfefp` — <https://hiwufsjnhfrzevjvfefp.supabase.co>

## Applying migrations

Either paste each file, in order, into **SQL Editor** in the dashboard, or link
the CLI and push:

```bash
npx supabase login
npx supabase link --project-ref hiwufsjnhfrzevjvfefp
npx supabase db push
```

## Secrets the edge functions need

Set these once. They are never committed and never reach the browser:

```bash
npx supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx
npx supabase secrets set RAZORPAY_KEY_SECRET=xxx
npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=xxx
```

## Google sign-in

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web).
2. Authorised redirect URI: `https://hiwufsjnhfrzevjvfefp.supabase.co/auth/v1/callback`
3. Supabase dashboard → Authentication → Providers → Google → paste the client
   ID and secret.

## Razorpay webhook

Dashboard → Settings → Webhooks → add:

- URL: `https://hiwufsjnhfrzevjvfefp.supabase.co/functions/v1/verify-payment`
- Active events: `payment.captured`, `payment.failed`
- Secret: the same value as `RAZORPAY_WEBHOOK_SECRET` above.
```

- [ ] **Step 4: Check the SQL parses**

There is no local database, so verify syntax by eye against the checklist:
every `create table` closed, every `references` naming a table defined above it,
`order_status` created before first use. Confirm `menu_items` has no cost column.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/README.md
git commit -m "feat: add Supabase schema and RLS policies for QR ordering"
```

---

### Task 4: Cloud client and configuration

**Files:**
- Create: `src/services/cloud/client.ts`
- Create: `.env.example`
- Modify: `package.json` (add `@supabase/supabase-js`)
- Modify: `vite.config.ts` (keep the POS service worker off customer routes)
- Test: `src/services/cloud/__tests__/client.test.ts`

**Interfaces:**
- Produces: `supabase` (client or `null`), `isCloudConfigured()`, `cloudConfig`

- [ ] **Step 1: Install the client**

Run: `npm install @supabase/supabase-js`

- [ ] **Step 2: Write the failing test**

Create `src/services/cloud/__tests__/client.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isCloudConfigured, cloudConfig } from '../client';

describe('cloud configuration', () => {
  it('reports not-configured when env vars are absent', () => {
    // The test env sets no VITE_SUPABASE_* vars, which is exactly the state of
    // a shop that has not enabled online ordering.
    expect(isCloudConfigured()).toBe(false);
  });

  it('never exposes a service-role key to the browser bundle', () => {
    expect(JSON.stringify(cloudConfig)).not.toMatch(/service_role/i);
    expect(Object.keys(cloudConfig)).not.toContain('serviceRoleKey');
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npm test -- client`
Expected: FAIL — cannot resolve `../client`.

- [ ] **Step 4: Write the client**

Create `src/services/cloud/client.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* The browser gets the anon key and nothing else. RLS is what protects the
   data — the anon key is public by design and safe in the bundle. The
   service-role key bypasses RLS and lives only in edge-function secrets. */

export const cloudConfig = {
  url: import.meta.env.VITE_SUPABASE_URL ?? '',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
} as const;

export const isCloudConfigured = (): boolean =>
  Boolean(cloudConfig.url && cloudConfig.anonKey);

/* Null when online ordering is not set up. Every caller must handle null —
   a shop with no cloud configured still runs the whole till offline, and the
   UI says "online ordering unavailable" rather than crashing. */
export const supabase: SupabaseClient | null = isCloudConfigured()
  ? createClient(cloudConfig.url, cloudConfig.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
```

- [ ] **Step 5: Write the example env file**

Create `.env.example`:

```bash
# Copy to .env.local and fill in. .env.local is gitignored via *.local.

# Supabase — anon key only. Safe in the browser; RLS protects the data.
VITE_SUPABASE_URL=https://hiwufsjnhfrzevjvfefp.supabase.co
VITE_SUPABASE_ANON_KEY=

# Razorpay — the PUBLIC key id only. The secret and the webhook secret belong
# in Supabase edge-function secrets, never here and never in the bundle.
VITE_RAZORPAY_KEY_ID=

# Public origin the table QR codes point at.
VITE_PUBLIC_ORDER_URL=https://your-app.vercel.app
```

- [ ] **Step 6: Keep the POS service worker off the customer routes**

The POS precaches its shell with `navigateFallback: 'index.html'`. Without an
exclusion a diner's phone can be served the cached till shell. In
`vite.config.ts`, inside `workbox`, immediately after the `navigateFallback`
line, add:

```ts
        // The till's offline shell must never be served to a customer's phone.
        // Customer routes always go to the network for a fresh document.
        navigateFallbackDenylist: [/^\/order/, /^\/kitchen/],
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npm test -- client && npx tsc -b`
Expected: PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/services/cloud/client.ts src/services/cloud/__tests__/client.test.ts .env.example vite.config.ts
git commit -m "feat: add Supabase browser client and ordering configuration"
```

---

## Phase 2 — Menu publish and table QR codes

### Task 5: Publish the menu upstream

**Files:**
- Create: `src/services/cloud/menu.ts`
- Test: `src/services/cloud/__tests__/menu.test.ts`

**Interfaces:**
- Consumes: `supabase` from `@/services/cloud/client`; `Product`, `Category` from `@/types`
- Produces: `toMenuRows(products, categories)`, `publishMenu(products, categories)`, `fetchPublishedMenu()`

- [ ] **Step 1: Write the failing test**

Create `src/services/cloud/__tests__/menu.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toMenuRows } from '../menu';
import type { Category, Product } from '@/types';

const product = (over: Partial<Product>): Product => ({
  id: 'p1', name: 'Filter Coffee', categoryId: 'c1', sellingPrice: 25,
  costPrice: 9.8, discount: 0, discountType: 'percent', taxRate: 5,
  available: true, unit: 'cup', createdAt: '', updatedAt: '', ...over,
});

const categories: Category[] = [{ id: 'c1', name: 'Beverages', icon: 'coffee', sortOrder: 1 }];

describe('toMenuRows', () => {
  it('never publishes cost price', () => {
    const rows = toMenuRows([product({ costPrice: 9.8 })], categories);
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain('9.8');
    expect(serialised).not.toMatch(/cost/i);
  });

  it('carries the price, tax rate and availability a diner needs', () => {
    const [row] = toMenuRows([product({ sellingPrice: 25, taxRate: 5, available: false })], categories);
    expect(row.price).toBe(25);
    expect(row.tax_rate).toBe(5);
    expect(row.available).toBe(false);
  });

  it('denormalises the category name so the menu needs no join', () => {
    const [row] = toMenuRows([product({})], categories);
    expect(row.category_name).toBe('Beverages');
  });

  it('publishes the discounted price a customer will actually pay', () => {
    const [row] = toMenuRows(
      [product({ sellingPrice: 100, discount: 10, discountType: 'percent' })],
      categories,
    );
    expect(row.price).toBe(90);
  });

  it('leaves out archived products entirely', () => {
    const rows = toMenuRows(
      [product({ id: 'p1' }), product({ id: 'p2', archived: true })],
      categories,
    );
    expect(rows.map((r) => r.id)).toEqual(['p1']);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- menu`
Expected: FAIL — cannot resolve `../menu`.

- [ ] **Step 3: Write the module**

Create `src/services/cloud/menu.ts`:

```ts
import { supabase } from './client';
import { effectivePrice } from '@/services/billing/calc';
import type { Category, Product } from '@/types';

/* The published menu is a deliberate snapshot, not a mirror. The owner presses
   Publish; until then a half-finished price edit stays on the device.

   Cost price is not in this shape at all — the only reliable way to guarantee
   it never reaches a customer is for it never to enter the payload. */

export interface MenuRow {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  price: number;
  tax_rate: number;
  image_url: string | null;
  available: boolean;
  sort_order: number;
}

export function toMenuRows(products: Product[], categories: Category[]): MenuRow[] {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const catOrder = new Map(categories.map((c) => [c.id, c.sortOrder]));

  return products
    .filter((p) => !p.archived)
    .map((p) => ({
      id: p.id,
      name: p.name,
      category_id: p.categoryId,
      category_name: catName.get(p.categoryId) ?? 'Other',
      // The price the customer actually pays, product discount already applied.
      price: effectivePrice(p),
      tax_rate: p.taxRate,
      image_url: p.image ?? null,
      available: p.available,
      sort_order: catOrder.get(p.categoryId) ?? 0,
    }));
}

export async function publishMenu(
  products: Product[],
  categories: Category[],
): Promise<{ published: number }> {
  if (!supabase) throw new Error('Online ordering is not configured');

  const rows = toMenuRows(products, categories);
  const ids = rows.map((r) => r.id);

  const { error } = await supabase.from('menu_items').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(error.message);

  // Anything upstream that is no longer on the local menu is withdrawn, so a
  // deleted product stops being orderable.
  if (ids.length) {
    const { error: delError } = await supabase
      .from('menu_items').delete().not('id', 'in', `(${ids.map((i) => `"${i}"`).join(',')})`);
    if (delError) throw new Error(delError.message);
  }

  return { published: rows.length };
}

export async function fetchPublishedMenu(): Promise<MenuRow[]> {
  if (!supabase) throw new Error('Online ordering is not configured');
  const { data, error } = await supabase
    .from('menu_items').select('*').order('sort_order').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as MenuRow[];
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- menu`
Expected: PASS, 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/services/cloud/menu.ts src/services/cloud/__tests__/menu.test.ts
git commit -m "feat: publish the local menu to Supabase without cost prices"
```

---

### Task 6: Table QR code generation

**Files:**
- Create: `src/services/cloud/tableQr.ts`
- Test: `src/services/cloud/__tests__/tableQr.test.ts`

**Interfaces:**
- Consumes: `qrToDataUrl` from `@/services/billing/qr`
- Produces: `tableOrderUrl(baseUrl, tableCode)`, `tableQrDataUrl(baseUrl, tableCode)`, `tableSheetHtml(baseUrl, tables, businessName)`

**Why:** reuses the repo's own from-scratch QR encoder. No new dependency.

- [ ] **Step 1: Write the failing test**

Create `src/services/cloud/__tests__/tableQr.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tableOrderUrl, tableQrDataUrl, tableSheetHtml } from '../tableQr';

describe('tableOrderUrl', () => {
  it('points at the public order route with the table code', () => {
    expect(tableOrderUrl('https://cafe.example.com', 'T04'))
      .toBe('https://cafe.example.com/order?t=T04');
  });

  it('tolerates a trailing slash on the base url', () => {
    expect(tableOrderUrl('https://cafe.example.com/', 'T04'))
      .toBe('https://cafe.example.com/order?t=T04');
  });

  it('encodes table codes that need it', () => {
    expect(tableOrderUrl('https://x.com', 'A 1')).toBe('https://x.com/order?t=A%201');
  });
});

describe('tableQrDataUrl', () => {
  it('produces a scannable svg data url', () => {
    const url = tableQrDataUrl('https://cafe.example.com', 'T04');
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
  });
});

describe('tableSheetHtml', () => {
  it('renders one printable card per table', () => {
    const html = tableSheetHtml('https://x.com', ['T01', 'T02', 'T03'], 'THANJAI CAFE');
    expect(html.match(/class="card"/g)).toHaveLength(3);
    expect(html).toContain('T01');
    expect(html).toContain('THANJAI CAFE');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- tableQr`
Expected: FAIL — cannot resolve `../tableQr`.

- [ ] **Step 3: Write the module**

Create `src/services/cloud/tableQr.ts`:

```ts
import { qrToDataUrl } from '@/services/billing/qr';

/* Table QR codes use the app's own QR encoder — the same one that renders UPI
   codes — so printing table cards needs no new dependency and works offline. */

export function tableOrderUrl(baseUrl: string, tableCode: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/order?t=${encodeURIComponent(tableCode)}`;
}

export const tableQrDataUrl = (baseUrl: string, tableCode: string): string =>
  qrToDataUrl(tableOrderUrl(baseUrl, tableCode));

/** A printable sheet of table cards — cut out and stand on the tables. */
export function tableSheetHtml(baseUrl: string, tables: string[], businessName: string): string {
  const cards = tables.map((t) => `
    <div class="card">
      <div class="shop">${escapeHtml(businessName)}</div>
      <img src="${tableQrDataUrl(baseUrl, t)}" alt="QR for table ${escapeHtml(t)}" />
      <div class="table">${escapeHtml(t)}</div>
      <div class="hint">Scan to see the menu and order</div>
    </div>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8" />
<title>Table QR codes</title>
<style>
  @page { margin: 10mm; }
  body { font-family: system-ui, sans-serif; margin: 0;
         display: grid; grid-template-columns: repeat(2, 1fr); gap: 10mm; }
  .card { border: 1px dashed #999; border-radius: 8px; padding: 8mm;
          text-align: center; break-inside: avoid; }
  .shop { font-size: 12pt; font-weight: 700; margin-bottom: 4mm; }
  .card img { width: 55mm; height: 55mm; }
  .table { font-size: 20pt; font-weight: 700; margin-top: 3mm; }
  .hint { font-size: 9pt; color: #555; margin-top: 1mm; }
</style></head><body>${cards}</body></html>`;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- tableQr`
Expected: PASS, 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/services/cloud/tableQr.ts src/services/cloud/__tests__/tableQr.test.ts
git commit -m "feat: generate printable table QR codes with the built-in encoder"
```

---

### Task 7: Online Ordering settings tab

**Files:**
- Modify: `src/pages/Settings/SettingsPage.tsx`
- Create: `src/pages/Settings/OnlineOrderingTab.tsx`

**Interfaces:**
- Consumes: `publishMenu` from `@/services/cloud/menu`; `tableSheetHtml` from `@/services/cloud/tableQr`; `isCloudConfigured` from `@/services/cloud/client`; `useAppStore`

**Note:** read `SettingsPage.tsx` first and follow its existing tab pattern exactly — this task adds a tab, it does not restructure the page.

- [ ] **Step 1: Read the existing tab structure**

Run: `grep -n "tab\|Tab" src/pages/Settings/SettingsPage.tsx | head -40`
Identify how tabs are registered and how one renders. Match it.

- [ ] **Step 2: Create the tab component**

Create `src/pages/Settings/OnlineOrderingTab.tsx` with:

- A status line: configured or not, from `isCloudConfigured()`. When not
  configured, an explanation naming `.env.local` and the two variables, and
  every control below disabled.
- **Publish menu** — a button calling `publishMenu(products, categories)` from
  the store, showing a spinner while in flight, then "Published N items" or the
  error message. Include a line stating that cost prices are never published.
- **Table QR codes** — a number input for table count (default 10, max 60), a
  Preview grid, and a Print button that opens `tableSheetHtml(...)` in a hidden
  iframe and calls `print()`, matching the approach in
  `src/services/billing/receipt.ts:147`.
- **Public URL** — a read-only display of `VITE_PUBLIC_ORDER_URL` with a note
  that it must be the deployed origin, not `localhost`, for phones to reach it.

Follow the existing components in `src/components/ui/index.tsx` for buttons,
inputs and cards rather than writing new styles.

- [ ] **Step 3: Register the tab**

Add the tab to `SettingsPage.tsx` using the same registration pattern as the
existing tabs, labelled "Online Ordering".

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`, open Settings → Online Ordering.
Expected with no `.env.local`: a clear "not configured" state, controls disabled,
nothing crashes.

- [ ] **Step 5: Confirm nothing broke**

Run: `npm test && npx tsc -b && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Settings/OnlineOrderingTab.tsx src/pages/Settings/SettingsPage.tsx
git commit -m "feat: add Online Ordering settings tab with menu publish and table QR codes"
```

---

## Phase 3 — The customer app

### Task 8: Customer cart store

**Files:**
- Create: `src/features/customer/useCustomerCart.ts`
- Test: `src/features/customer/__tests__/useCustomerCart.test.ts`

**Interfaces:**
- Consumes: `MenuRow` from `@/services/cloud/menu`; `computeBill` from `@/services/billing/calc`
- Produces: `useCustomerCart` store with `items`, `add`, `remove`, `setQty`, `clear`, `tableCode`, `setTable`; helper `cartTotals(items)`

- [ ] **Step 1: Write the failing test**

Create `src/features/customer/__tests__/useCustomerCart.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCustomerCart, cartTotals } from '../useCustomerCart';
import type { MenuRow } from '@/services/cloud/menu';

const item = (over: Partial<MenuRow> = {}): MenuRow => ({
  id: 'p1', name: 'Filter Coffee', category_id: 'c1', category_name: 'Beverages',
  price: 25, tax_rate: 5, image_url: null, available: true, sort_order: 1, ...over,
});

beforeEach(() => useCustomerCart.getState().clear());

describe('useCustomerCart', () => {
  it('adds an item and increments on a second add', () => {
    const { add } = useCustomerCart.getState();
    add(item());
    add(item());
    expect(useCustomerCart.getState().items).toHaveLength(1);
    expect(useCustomerCart.getState().items[0].qty).toBe(2);
  });

  it('removes an item when its quantity reaches zero', () => {
    const { add, setQty } = useCustomerCart.getState();
    add(item());
    setQty('p1', 0);
    expect(useCustomerCart.getState().items).toHaveLength(0);
  });

  it('refuses to add an unavailable item', () => {
    useCustomerCart.getState().add(item({ available: false }));
    expect(useCustomerCart.getState().items).toHaveLength(0);
  });

  it('keeps the table code across cart changes', () => {
    const s = useCustomerCart.getState();
    s.setTable('T04');
    s.add(item());
    expect(useCustomerCart.getState().tableCode).toBe('T04');
  });
});

describe('cartTotals', () => {
  it('totals in integer paise via the shared money engine', () => {
    const totals = cartTotals([{ ...item({ price: 25, tax_rate: 5 }), qty: 2 }]);
    expect(totals.subtotal).toBe(50);
    expect(totals.tax).toBe(2.5);
    expect(totals.total).toBe(52.5);
  });

  it('is exact where floating point would drift', () => {
    const totals = cartTotals([{ ...item({ price: 0.1, tax_rate: 0 }), qty: 3 }]);
    expect(totals.total).toBe(0.3);
  });

  it('returns zeroes for an empty cart', () => {
    expect(cartTotals([]).total).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- useCustomerCart`
Expected: FAIL — cannot resolve `../useCustomerCart`.

- [ ] **Step 3: Write the store**

Create `src/features/customer/useCustomerCart.ts`:

```ts
import { create } from 'zustand';
import { computeBill } from '@/services/billing/calc';
import type { MenuRow } from '@/services/cloud/menu';
import type { BillLine } from '@/types';

/* The customer's cart. Totals run through the same integer-paise engine the
   till uses, so the phone and the server agree to the paise — and the server
   recomputes anyway before taking any money. */

export interface CartItem extends MenuRow {
  qty: number;
  note?: string;
}

interface CartState {
  tableCode: string;
  items: CartItem[];
  setTable: (code: string) => void;
  add: (row: MenuRow) => void;
  remove: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
}

export const useCustomerCart = create<CartState>((set) => ({
  tableCode: '',
  items: [],

  setTable: (tableCode) => set({ tableCode }),

  add: (row) => set((s) => {
    if (!row.available) return s; // a sold-out item cannot enter the cart
    const existing = s.items.find((i) => i.id === row.id);
    return existing
      ? { items: s.items.map((i) => (i.id === row.id ? { ...i, qty: i.qty + 1 } : i)) }
      : { items: [...s.items, { ...row, qty: 1 }] };
  }),

  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  setQty: (id, qty) => set((s) => ({
    items: qty <= 0
      ? s.items.filter((i) => i.id !== id)
      : s.items.map((i) => (i.id === id ? { ...i, qty } : i)),
  })),

  clear: () => set({ items: [] }),
}));

/** Cart lines in the shape the money engine expects. */
export const toBillLines = (items: CartItem[]): BillLine[] =>
  items.map((i) => ({
    id: i.id, productId: i.id, name: i.name,
    unitPrice: i.price, costPrice: 0, qty: i.qty,
    discount: 0, discountType: 'percent' as const,
    taxRate: i.tax_rate, note: i.note,
  }));

export function cartTotals(items: CartItem[]) {
  const { totals } = computeBill(toBillLines(items), 0, 'fixed', {
    pricesIncludeTax: false,
    roundTotals: false,
  });
  return totals;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- useCustomerCart`
Expected: PASS, 7 cases.

- [ ] **Step 5: Commit**

```bash
git add src/features/customer/useCustomerCart.ts src/features/customer/__tests__/useCustomerCart.test.ts
git commit -m "feat: add customer cart store using the shared money engine"
```

---

### Task 9: Customer authentication

**Files:**
- Create: `src/features/customer/useCustomerAuth.ts`
- Test: `src/features/customer/__tests__/phone.test.ts`

**Interfaces:**
- Consumes: `supabase` from `@/services/cloud/client`
- Produces: `useCustomerAuth()` returning `{ user, customer, loading, signInWithGoogle, signOut, savePhone }`; `normalisePhone(input)`, `isValidIndianPhone(input)`

**Design note:** Google verifies the email but never returns a phone number, so
`phone_verified` stays false. The `savePhone` seam is where SMS OTP attaches
later without touching any caller.

- [ ] **Step 1: Write the failing test**

Create `src/features/customer/__tests__/phone.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalisePhone, isValidIndianPhone } from '../useCustomerAuth';

describe('normalisePhone', () => {
  it('strips spaces, dashes and brackets', () => {
    expect(normalisePhone('98765 43210')).toBe('9876543210');
    expect(normalisePhone('(987) 654-3210')).toBe('9876543210');
  });

  it('drops a +91 or 0 prefix', () => {
    expect(normalisePhone('+91 9876543210')).toBe('9876543210');
    expect(normalisePhone('09876543210')).toBe('9876543210');
    expect(normalisePhone('919876543210')).toBe('9876543210');
  });
});

describe('isValidIndianPhone', () => {
  it('accepts a ten-digit mobile number', () => {
    expect(isValidIndianPhone('9876543210')).toBe(true);
    expect(isValidIndianPhone('+91 98765 43210')).toBe(true);
  });

  it('rejects numbers that cannot reach a customer', () => {
    expect(isValidIndianPhone('12345')).toBe(false);
    expect(isValidIndianPhone('98765432101')).toBe(false);
    expect(isValidIndianPhone('')).toBe(false);
    expect(isValidIndianPhone('abcdefghij')).toBe(false);
  });

  it('rejects a leading digit no Indian mobile uses', () => {
    expect(isValidIndianPhone('1234567890')).toBe(false);
    expect(isValidIndianPhone('5876543210')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- phone`
Expected: FAIL — cannot resolve `../useCustomerAuth`.

- [ ] **Step 3: Write the module**

Create `src/features/customer/useCustomerAuth.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/services/cloud/client';
import type { CloudCustomer } from '@/types/order';

/* Google sign-in verifies the customer's email and gives us their name.
   It does NOT return a phone number — that is not in the OAuth scopes — so the
   phone is typed and `phone_verified` stays false. Switching on SMS OTP later
   means changing what happens inside savePhone, and nothing else. */

export function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** Indian mobile numbers are ten digits starting 6-9. */
export const isValidIndianPhone = (input: string): boolean =>
  /^[6-9]\d{9}$/.test(normalisePhone(input));

export function useCustomerAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [customer, setCustomer] = useState<CloudCustomer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load or create the customer row once signed in.
  useEffect(() => {
    if (!supabase || !user) { setCustomer(null); return; }
    void (async () => {
      const { data } = await supabase!.from('customers').select('*').eq('id', user.id).maybeSingle();
      if (data) {
        setCustomer(rowToCustomer(data));
        return;
      }
      const row = {
        id: user.id,
        name: (user.user_metadata?.full_name as string) ?? '',
        email: user.email ?? '',
        email_verified: true,   // Google verified it
        phone: '',
        phone_verified: false,  // typed, not verified — see the note above
      };
      await supabase!.from('customers').insert(row);
      setCustomer(rowToCustomer(row));
    })();
  }, [user]);

  const signInWithGoogle = useCallback(async (redirectTo: string) => {
    if (!supabase) throw new Error('Online ordering is not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const savePhone = useCallback(async (phone: string) => {
    if (!supabase || !user) throw new Error('Not signed in');
    if (!isValidIndianPhone(phone)) throw new Error('Enter a valid 10-digit mobile number');
    const clean = normalisePhone(phone);
    const { error } = await supabase
      .from('customers')
      .update({ phone: clean, last_seen_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) throw new Error(error.message);
    setCustomer((c) => (c ? { ...c, phone: clean } : c));
    return clean;
  }, [user]);

  return { user, customer, loading, signInWithGoogle, signOut, savePhone };
}

const rowToCustomer = (r: Record<string, unknown>): CloudCustomer => ({
  id: String(r.id),
  name: String(r.name ?? ''),
  email: String(r.email ?? ''),
  emailVerified: Boolean(r.email_verified),
  phone: String(r.phone ?? ''),
  phoneVerified: Boolean(r.phone_verified),
});
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- phone`
Expected: PASS, 6 cases.

- [ ] **Step 5: Commit**

```bash
git add src/features/customer/useCustomerAuth.ts src/features/customer/__tests__/phone.test.ts
git commit -m "feat: add customer Google sign-in and phone capture"
```

---

### Task 10: The customer menu page

**Files:**
- Create: `src/pages/Customer/MenuPage.tsx`
- Create: `src/pages/Customer/CustomerLayout.tsx`

**Interfaces:**
- Consumes: `fetchPublishedMenu`, `useCustomerCart`, `cartTotals`
- Produces: `MenuPage`, `CustomerLayout` (default exports for lazy loading)

**Design constraints:** mobile-first — most diners hold a phone one-handed.
Never render a POS control here. Read `src/components/product/ProductCard.tsx`
for the established card look and reuse its visual language.

- [ ] **Step 1: Read the table code from the URL**

`MenuPage` reads `?t=` via `useSearchParams` and calls `setTable`. When `t` is
missing, show a clear "Scan the QR code on your table to order" state and no menu.

- [ ] **Step 2: Load and group the menu**

Fetch with `fetchPublishedMenu()` on mount. Group by `category_name`, ordered by
`sort_order`. Render a sticky category strip that scrolls to each section.

Handle three states explicitly: loading (spinner), error (message plus Retry),
and empty (the shop has not published a menu yet).

- [ ] **Step 3: Render the items**

Each item: image (or the initials fallback the POS already uses), name, price,
and an add control. A row with `available: false` renders greyed with a "Sold
out" chip and no add button.

- [ ] **Step 4: Sticky cart bar**

A fixed bottom bar appearing once the cart is non-empty: item count, total from
`cartTotals`, and a "Review order" button routing to `/order/checkout`.

- [ ] **Step 5: Verify on a phone-sized viewport**

Run `npm run dev`, open `http://localhost:5173/order?t=T04` at 390×844.
Expected: menu readable one-handed, cart bar reachable with a thumb, no POS
navigation visible anywhere.

- [ ] **Step 6: Confirm nothing broke**

Run: `npm test && npx tsc -b && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add src/pages/Customer/MenuPage.tsx src/pages/Customer/CustomerLayout.tsx
git commit -m "feat: add the customer menu page"
```

---

### Task 11: Public customer routes

**Files:**
- Modify: `src/routes/index.tsx`
- Test: `.verify/customer-routes.mjs`

**Interfaces:**
- Consumes: `MenuPage`, `CustomerLayout`
- Produces: public routes `/order`, `/order/checkout`, `/order/status/:id`

**Critical:** these routes go **outside** `RequireAuth`. A diner has no PIN.
They must also be lazy-loaded so a customer never downloads the POS bundle.

- [ ] **Step 1: Add the lazy imports**

In `src/routes/index.tsx`, alongside the existing `lazy(...)` declarations:

```tsx
const CustomerLayout = lazy(() =>
  import('@/pages/Customer/CustomerLayout').then((m) => ({ default: m.CustomerLayout })));
const MenuPage = lazy(() =>
  import('@/pages/Customer/MenuPage').then((m) => ({ default: m.MenuPage })));
```

- [ ] **Step 2: Add the routes above the staff routes**

Inside `<Routes>`, immediately before the `<Route element={<RequireAuth>...`
block:

```tsx
      {/* Customer ordering. Deliberately outside RequireAuth — a diner has no
          PIN — and lazy-loaded so a phone never downloads the POS bundle. */}
      <Route path="/order" element={<Suspense fallback={<RouteFallback />}><CustomerLayout /></Suspense>}>
        <Route index element={<Suspense fallback={<RouteFallback />}><MenuPage /></Suspense>} />
      </Route>
```

- [ ] **Step 3: Write the browser check**

Create `.verify/customer-routes.mjs` following the pattern of the existing
`.verify` scripts (read `.verify/e2e.mjs` first and match its launch and
assertion style). It must assert:

- `/order?t=T04` loads with no session and never redirects to `/login`
- the page contains no POS navigation (no "Dashboard", no "Reports" link)
- `/order` without `t` shows the "scan the QR code" prompt

- [ ] **Step 4: Run it**

Run: `npm run build && node .verify/customer-routes.mjs`
Expected: all assertions pass.

- [ ] **Step 5: Confirm the staff app is untouched**

Run: `node .verify/e2e.mjs && node .verify/offline.mjs`
Expected: both still pass — the till still works, still works offline.

- [ ] **Step 6: Commit**

```bash
git add src/routes/index.tsx .verify/customer-routes.mjs
git commit -m "feat: add public customer ordering routes"
```

---

## Phase 4 — Payment

### Task 12: create-order edge function

**Files:**
- Create: `supabase/functions/create-order/index.ts`
- Test: `supabase/functions/create-order/__tests__/pricing.test.ts`
- Create: `supabase/functions/create-order/pricing.ts`

**Interfaces:**
- Consumes: `computeBill` from `../_shared/calc.ts`
- Produces: `priceOrder(requestedLines, menuRows)` returning `{ lines, totals }` or throwing; the HTTP handler

**The security boundary.** The client's prices and totals are display values.
This function reprices everything from `menu_items` and rejects any mismatch.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/create-order/__tests__/pricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { priceOrder } from '../pricing';

const menu = [
  { id: 'p1', name: 'Filter Coffee', price: 25, tax_rate: 5, available: true },
  { id: 'p2', name: 'Vadai', price: 15, tax_rate: 5, available: true },
  { id: 'p3', name: 'Sold Out Item', price: 30, tax_rate: 5, available: false },
];

describe('priceOrder', () => {
  it('prices from the menu, ignoring what the client claimed', () => {
    const { totals } = priceOrder([{ productId: 'p1', qty: 2, unitPrice: 1 }], menu);
    expect(totals.subtotal).toBe(50);   // 25 x 2, not 1 x 2
  });

  it('rejects an item that is not on the published menu', () => {
    expect(() => priceOrder([{ productId: 'ghost', qty: 1 }], menu))
      .toThrow(/not on the menu/i);
  });

  it('rejects an item that is sold out', () => {
    expect(() => priceOrder([{ productId: 'p3', qty: 1 }], menu))
      .toThrow(/sold out/i);
  });

  it('rejects a non-positive or absurd quantity', () => {
    expect(() => priceOrder([{ productId: 'p1', qty: 0 }], menu)).toThrow(/quantity/i);
    expect(() => priceOrder([{ productId: 'p1', qty: -3 }], menu)).toThrow(/quantity/i);
    expect(() => priceOrder([{ productId: 'p1', qty: 1000 }], menu)).toThrow(/quantity/i);
  });

  it('rejects an empty order', () => {
    expect(() => priceOrder([], menu)).toThrow(/empty/i);
  });

  it('computes tax per slab through the shared engine', () => {
    const { totals } = priceOrder(
      [{ productId: 'p1', qty: 2 }, { productId: 'p2', qty: 3 }], menu,
    );
    expect(totals.subtotal).toBe(95);
    expect(totals.tax).toBe(4.75);
    expect(totals.total).toBe(99.75);
  });

  it('returns server-priced lines, not the client\'s', () => {
    const { lines } = priceOrder([{ productId: 'p1', qty: 1, unitPrice: 1, name: 'Free Coffee' }], menu);
    expect(lines[0].unit_price).toBe(25);
    expect(lines[0].name).toBe('Filter Coffee');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- pricing`
Expected: FAIL — cannot resolve `../pricing`.

- [ ] **Step 3: Write the pricing module**

Create `supabase/functions/create-order/pricing.ts`:

```ts
import { computeBill } from '../_shared/calc.ts';

/* The security boundary. Everything the phone sends about money is a display
   value; the real total is computed here from the published menu. A tampered
   client cannot pay one rupee for a five-hundred-rupee order. */

export interface RequestedLine {
  productId: string;
  qty: number;
  note?: string;
  unitPrice?: number;  // ignored — accepted only so the client can be honest
  name?: string;       // ignored
}

export interface MenuItemRow {
  id: string;
  name: string;
  price: number;
  tax_rate: number;
  available: boolean;
}

const MAX_QTY = 99;

export function priceOrder(requested: RequestedLine[], menu: MenuItemRow[]) {
  if (!requested.length) throw new Error('Order is empty');

  const byId = new Map(menu.map((m) => [m.id, m]));

  const priced = requested.map((r) => {
    const item = byId.get(r.productId);
    if (!item) throw new Error(`Item is not on the menu: ${r.productId}`);
    if (!item.available) throw new Error(`Sold out: ${item.name}`);
    if (!Number.isInteger(r.qty) || r.qty < 1 || r.qty > MAX_QTY) {
      throw new Error(`Invalid quantity for ${item.name}`);
    }
    return {
      product_id: item.id,
      name: item.name,
      unit_price: item.price,
      qty: r.qty,
      tax_rate: item.tax_rate,
      note: r.note?.slice(0, 200),
    };
  });

  const { totals } = computeBill(
    priced.map((p) => ({
      id: p.product_id, productId: p.product_id, name: p.name,
      unitPrice: p.unit_price, costPrice: 0, qty: p.qty,
      discount: 0, discountType: 'percent' as const, taxRate: p.tax_rate,
    })),
    0, 'fixed',
    { pricesIncludeTax: false, roundTotals: false },
  );

  return { lines: priced, totals };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- pricing`
Expected: PASS, 7 cases.

- [ ] **Step 5: Write the HTTP handler**

Create `supabase/functions/create-order/index.ts`:

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { priceOrder, type RequestedLine } from './pricing.ts';

/* Creates an order and a matching Razorpay order. Writes status
   AWAITING_PAYMENT. It never writes PAID — only verify-payment does that. */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Identify the caller from their JWT — never from the request body.
    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: 'Sign in to place an order' }, 401);

    const body = await req.json() as {
      tableCode?: string; lines?: RequestedLine[]; phone?: string; name?: string;
    };
    if (!body.tableCode) return json({ error: 'Missing table code' }, 400);
    if (!/^[6-9]\d{9}$/.test(body.phone ?? '')) {
      return json({ error: 'A valid 10-digit mobile number is required' }, 400);
    }

    const { data: menu, error: menuErr } = await admin
      .from('menu_items').select('id, name, price, tax_rate, available');
    if (menuErr) return json({ error: menuErr.message }, 500);

    const { lines, totals } = priceOrder(body.lines ?? [], menu ?? []);

    const { data: tokenRow } = await admin.rpc('next_order_token');
    const token = String(tokenRow ?? 'A-00');

    const { data: order, error: orderErr } = await admin.from('orders').insert({
      token,
      table_code: body.tableCode,
      customer_id: user.id,
      customer_name: (body.name ?? '').slice(0, 80),
      customer_phone: body.phone,
      status: 'AWAITING_PAYMENT',
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    }).select().single();
    if (orderErr) return json({ error: orderErr.message }, 500);

    await admin.from('order_lines').insert(lines.map((l) => ({ ...l, order_id: order.id })));

    // Razorpay works in paise, which is also how our engine thinks.
    const keyId = Deno.env.get('RAZORPAY_KEY_ID')!;
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')!;
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      },
      body: JSON.stringify({
        amount: Math.round(totals.total * 100),
        currency: 'INR',
        receipt: order.id,
        notes: { order_id: order.id, table: body.tableCode, token },
      }),
    });

    if (!rzpRes.ok) {
      await admin.from('orders').update({ status: 'PAYMENT_FAILED' }).eq('id', order.id);
      return json({ error: 'Could not start the payment' }, 502);
    }

    const rzp = await rzpRes.json();
    await admin.from('orders').update({ razorpay_order_id: rzp.id }).eq('id', order.id);

    return json({
      orderId: order.id, token, razorpayOrderId: rzp.id,
      amount: rzp.amount, currency: rzp.currency, keyId,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Could not create the order' }, 400);
  }
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/create-order
git commit -m "feat: add create-order edge function with server-side repricing"
```

---

### Task 13: verify-payment edge function

**Files:**
- Create: `supabase/functions/verify-payment/index.ts`
- Create: `supabase/functions/verify-payment/signature.ts`
- Test: `supabase/functions/verify-payment/__tests__/signature.test.ts`

**Interfaces:**
- Produces: `verifyWebhookSignature(body, signature, secret)`; the webhook handler

**This is the only place in the codebase that writes `PAID`.**

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/verify-payment/__tests__/signature.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../signature';

const SECRET = 'whsec_test_secret';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed payload', async () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    expect(await verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a forged signature', async () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    expect(await verifyWebhookSignature(body, 'deadbeef', SECRET)).toBe(false);
  });

  it('rejects a payload tampered with after signing', async () => {
    const signature = sign(JSON.stringify({ amount: 100 }));
    const tampered = JSON.stringify({ amount: 1 });
    expect(await verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects an empty or missing signature', async () => {
    const body = '{}';
    expect(await verifyWebhookSignature(body, '', SECRET)).toBe(false);
  });

  it('rejects when signed with the wrong secret', async () => {
    const body = '{"a":1}';
    const wrong = createHmac('sha256', 'other_secret').update(body).digest('hex');
    expect(await verifyWebhookSignature(body, wrong, SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- signature`
Expected: FAIL — cannot resolve `../signature`.

- [ ] **Step 3: Write the verifier**

Create `supabase/functions/verify-payment/signature.ts`:

```ts
/* Razorpay signs each webhook with HMAC-SHA256 over the raw body. Verifying it
   is what separates a real payment from anyone who can POST to a public URL.

   Uses WebCrypto so the same code runs under Deno and under Node in tests. */

export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  return timingSafeEqual(expected, signature.toLowerCase());
}

/* Constant-time comparison: a length-or-first-difference exit would leak the
   expected signature one byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- signature`
Expected: PASS, 5 cases.

- [ ] **Step 5: Write the webhook handler**

Create `supabase/functions/verify-payment/index.ts`:

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyWebhookSignature } from './signature.ts';

/* The single writer of PAID in the entire system.

   Razorpay retries on any non-2xx, so this handler is idempotent: the unique
   constraint on razorpay_payment_id means a repeat delivery cannot produce a
   second bill or a second KOT. */

Deno.serve(async (req) => {
  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';

  if (!await verifyWebhookSignature(raw, signature, secret)) {
    // Do not retry an unsigned caller: 401 and done.
    return new Response('invalid signature', { status: 401 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const event = JSON.parse(raw);
  const payment = event?.payload?.payment?.entity;
  if (!payment) return new Response('ignored', { status: 200 });

  const razorpayOrderId = payment.order_id as string;
  const razorpayPaymentId = payment.id as string;

  if (event.event === 'payment.failed') {
    await admin.from('orders')
      .update({ status: 'PAYMENT_FAILED' })
      .eq('razorpay_order_id', razorpayOrderId)
      .eq('status', 'AWAITING_PAYMENT');
    return new Response('ok', { status: 200 });
  }

  if (event.event !== 'payment.captured') return new Response('ignored', { status: 200 });

  // Conditional on status so a duplicate delivery updates nothing the second
  // time — the order has already left AWAITING_PAYMENT.
  const { data, error } = await admin.from('orders')
    .update({
      status: 'PAID',
      razorpay_payment_id: razorpayPaymentId,
      paid_at: new Date().toISOString(),
    })
    .eq('razorpay_order_id', razorpayOrderId)
    .eq('status', 'AWAITING_PAYMENT')
    .select();

  // Already processed: still a success as far as Razorpay is concerned, so it
  // stops retrying.
  if (error) return new Response(error.message, { status: 500 });
  if (!data?.length) return new Response('already processed', { status: 200 });

  return new Response('ok', { status: 200 });
});
```

- [ ] **Step 6: Verify the single-writer rule holds**

Run: `grep -rn "'PAID'" supabase/ src/ --include=*.ts --include=*.tsx | grep -v "__tests__" | grep -v "STATUS_LABELS" | grep -v "status.ts"`
Expected: matches only in `supabase/functions/verify-payment/index.ts`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/verify-payment
git commit -m "feat: add verify-payment webhook as the sole writer of PAID"
```

---

### Task 14: Checkout page

**Files:**
- Create: `src/pages/Customer/CheckoutPage.tsx`
- Create: `src/services/cloud/razorpay.ts`
- Test: `src/services/cloud/__tests__/razorpay.test.ts`

**Interfaces:**
- Consumes: `useCustomerAuth`, `useCustomerCart`, `cartTotals`, `supabase`
- Produces: `loadRazorpayScript()`, `openCheckout(options)`, `CheckoutPage`

- [ ] **Step 1: Write the failing test**

Create `src/services/cloud/__tests__/razorpay.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkoutOptions } from '../razorpay';

beforeEach(() => vi.restoreAllMocks());

describe('checkoutOptions', () => {
  const base = {
    keyId: 'rzp_test_x', razorpayOrderId: 'order_123', amount: 9975,
    name: 'Priya', phone: '9876543210', email: 'p@example.com',
    businessName: 'THANJAI CAFE', token: 'A-07',
  };

  it('passes the amount through untouched — the server already set it', () => {
    expect(checkoutOptions(base).amount).toBe(9975);
  });

  it('prefills what we already know so the diner types nothing twice', () => {
    const o = checkoutOptions(base);
    expect(o.prefill.contact).toBe('9876543210');
    expect(o.prefill.email).toBe('p@example.com');
    expect(o.prefill.name).toBe('Priya');
  });

  it('shows the token on the payment sheet so the diner recognises the order', () => {
    expect(checkoutOptions(base).description).toContain('A-07');
  });

  it('always uses INR', () => {
    expect(checkoutOptions(base).currency).toBe('INR');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- razorpay`
Expected: FAIL — cannot resolve `../razorpay`.

- [ ] **Step 3: Write the Razorpay helper**

Create `src/services/cloud/razorpay.ts`:

```ts
/* Razorpay Checkout runs in a script we load on demand — never bundled, so the
   till never ships payment-gateway code it does not use.

   Nothing here decides whether a payment succeeded. The handler callback only
   tells the UI to start waiting; the truth arrives at the verify-payment
   webhook, and the phone learns about it over realtime. */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export interface CheckoutInput {
  keyId: string;
  razorpayOrderId: string;
  amount: number;        // paise, as returned by the server
  name: string;
  phone: string;
  email: string;
  businessName: string;
  token: string;
}

export interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: 'INR';
  name: string;
  description: string;
  prefill: { name: string; contact: string; email: string };
  theme: { color: string };
}

export const checkoutOptions = (i: CheckoutInput): RazorpayOptions => ({
  key: i.keyId,
  order_id: i.razorpayOrderId,
  amount: i.amount,
  currency: 'INR',
  name: i.businessName,
  description: `Order ${i.token}`,
  prefill: { name: i.name, contact: i.phone, email: i.email },
  theme: { color: '#6b3f22' },
});

export function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment page'));
    document.head.appendChild(s);
  });
}

export async function openCheckout(
  input: CheckoutInput,
  onDismiss: () => void,
): Promise<void> {
  await loadRazorpayScript();
  const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay;
  new Razorpay({
    ...checkoutOptions(input),
    modal: { ondismiss: onDismiss },
    handler: () => { /* success is confirmed by the webhook, not here */ },
  }).open();
}
```

- [ ] **Step 4: Build the checkout page**

Create `src/pages/Customer/CheckoutPage.tsx` with this sequence:

1. Cart review — lines, quantities, editable, and the total from `cartTotals`.
2. If not signed in: a "Continue with Google" button calling `signInWithGoogle`
   with `redirectTo` back to `/order/checkout`.
3. If signed in with no phone on file: a phone input validated with
   `isValidIndianPhone`, saved via `savePhone`. Pre-fill from `customer.phone`
   on a repeat visit so a returning diner types nothing.
4. "Pay ₹X" — invokes the `create-order` function via
   `supabase.functions.invoke('create-order', { body: {...} })`, then
   `openCheckout(...)`, then navigates to `/order/status/:orderId`.
5. Errors surface as readable text — a sold-out item names the item.

Empty cart renders a "Your order is empty" state with a link back to the menu.

- [ ] **Step 5: Run the tests**

Run: `npm test -- razorpay && npx tsc -b && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/services/cloud/razorpay.ts src/services/cloud/__tests__/razorpay.test.ts src/pages/Customer/CheckoutPage.tsx
git commit -m "feat: add checkout with Google sign-in, phone capture and Razorpay"
```

---

### Task 15: Order status page with live updates

**Files:**
- Create: `src/pages/Customer/OrderStatusPage.tsx`
- Create: `src/services/cloud/orders.ts`
- Modify: `src/routes/index.tsx` (add `/order/checkout` and `/order/status/:id`)
- Test: `src/services/cloud/__tests__/orders.test.ts`

**Interfaces:**
- Produces: `rowToOrder(row, lines)`, `fetchOrder(id)`, `subscribeToOrder(id, cb)`, `subscribeToKitchen(cb)`, `OrderStatusPage`

- [ ] **Step 1: Write the failing test**

Create `src/services/cloud/__tests__/orders.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rowToOrder } from '../orders';

const row = {
  id: 'o1', token: 'A-07', table_code: 'T04', customer_id: 'u1',
  customer_name: 'Priya', customer_phone: '9876543210', status: 'PAID',
  subtotal: 95, tax: 4.75, total: 99.75, razorpay_order_id: 'order_1',
  razorpay_payment_id: 'pay_1', bill_id: null, note: null,
  created_at: '2026-09-08T10:00:00Z', paid_at: '2026-09-08T10:01:00Z',
  accepted_at: null, ready_at: null, served_at: null,
};

const lines = [
  { id: 'l1', order_id: 'o1', product_id: 'p1', name: 'Filter Coffee',
    unit_price: 25, qty: 2, tax_rate: 5, note: null },
];

describe('rowToOrder', () => {
  it('maps snake_case columns to the app\'s camelCase shape', () => {
    const o = rowToOrder(row, lines);
    expect(o.tableCode).toBe('T04');
    expect(o.customerPhone).toBe('9876543210');
    expect(o.razorpayPaymentId).toBe('pay_1');
  });

  it('carries the customer name and phone the KOT needs', () => {
    const o = rowToOrder(row, lines);
    expect(o.customerName).toBe('Priya');
    expect(o.customerPhone).toBe('9876543210');
  });

  it('turns nulls into undefined rather than leaking them into the UI', () => {
    const o = rowToOrder(row, lines);
    expect(o.acceptedAt).toBeUndefined();
    expect(o.billId).toBeUndefined();
  });

  it('attaches the order lines', () => {
    const o = rowToOrder(row, lines);
    expect(o.lines).toHaveLength(1);
    expect(o.lines[0].name).toBe('Filter Coffee');
    expect(o.lines[0].qty).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- orders`
Expected: FAIL — cannot resolve `../orders`.

- [ ] **Step 3: Write the orders module**

Create `src/services/cloud/orders.ts`:

```ts
import { supabase } from './client';
import { KITCHEN_VISIBLE } from './status';
import type { CloudOrder, CloudOrderLine, OrderStatus } from '@/types/order';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const opt = (v: unknown): string | undefined => (v == null ? undefined : String(v));
const num = (v: unknown): number => Number(v ?? 0);

export function rowToOrder(row: Row, lineRows: Row[]): CloudOrder {
  return {
    id: str(row.id),
    token: str(row.token),
    tableCode: str(row.table_code),
    customerId: row.customer_id == null ? null : String(row.customer_id),
    customerName: str(row.customer_name),
    customerPhone: str(row.customer_phone),
    status: str(row.status) as OrderStatus,
    subtotal: num(row.subtotal),
    tax: num(row.tax),
    total: num(row.total),
    razorpayOrderId: opt(row.razorpay_order_id),
    razorpayPaymentId: opt(row.razorpay_payment_id),
    billId: opt(row.bill_id),
    note: opt(row.note),
    createdAt: str(row.created_at),
    paidAt: opt(row.paid_at),
    acceptedAt: opt(row.accepted_at),
    readyAt: opt(row.ready_at),
    servedAt: opt(row.served_at),
    lines: lineRows.map((l): CloudOrderLine => ({
      id: str(l.id),
      orderId: str(l.order_id),
      productId: str(l.product_id),
      name: str(l.name),
      unitPrice: num(l.unit_price),
      qty: num(l.qty),
      taxRate: num(l.tax_rate),
      note: opt(l.note),
    })),
  };
}

export async function fetchOrder(id: string): Promise<CloudOrder | null> {
  if (!supabase) return null;
  const { data: order } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
  if (!order) return null;
  const { data: lines } = await supabase.from('order_lines').select('*').eq('order_id', id);
  return rowToOrder(order, lines ?? []);
}

/** Live updates for one order — what the customer's phone watches. */
export function subscribeToOrder(id: string, onChange: (o: CloudOrder) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`order:${id}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
      () => { void fetchOrder(id).then((o) => { if (o) onChange(o); }); })
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

/** Live paid orders — what the kitchen screen and the till watch.
    Unpaid orders are filtered out here as well as in the query, so no code
    path can put an unpaid ticket in front of the kitchen. */
export async function fetchKitchenOrders(): Promise<CloudOrder[]> {
  if (!supabase) return [];
  const { data: orders } = await supabase
    .from('orders').select('*').in('status', KITCHEN_VISIBLE).order('created_at');
  if (!orders?.length) return [];
  const ids = orders.map((o: Row) => String(o.id));
  const { data: lines } = await supabase.from('order_lines').select('*').in('order_id', ids);
  const byOrder = new Map<string, Row[]>();
  for (const l of (lines ?? []) as Row[]) {
    const k = String(l.order_id);
    byOrder.set(k, [...(byOrder.get(k) ?? []), l]);
  }
  return (orders as Row[]).map((o) => rowToOrder(o, byOrder.get(String(o.id)) ?? []));
}

export function subscribeToKitchen(onChange: () => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel('kitchen')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

export async function advanceStatus(id: string, to: OrderStatus): Promise<void> {
  if (!supabase) throw new Error('Online ordering is not configured');
  const stamp: Record<string, string> = {};
  if (to === 'READY') stamp.ready_at = new Date().toISOString();
  if (to === 'SERVED') stamp.served_at = new Date().toISOString();
  const { error } = await supabase.from('orders').update({ status: to, ...stamp }).eq('id', id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Build the status page**

Create `src/pages/Customer/OrderStatusPage.tsx`:

- Read `:id`, `fetchOrder` on mount, `subscribeToOrder` for live changes.
- A large token number (`A-07`) — the thing the diner is called by.
- A step indicator using `STATUS_LABELS`: Payment received → Accepted →
  Being prepared → Ready.
- `AWAITING_PAYMENT` shows "Confirming your payment…" with a spinner, because
  the webhook may take a moment. After 90 seconds, add a line telling them to
  show the screen to the counter — never a false failure.
- `PAYMENT_FAILED` shows a clear failure and a Try again button back to checkout,
  with the cart intact.
- `READY` is unmistakable — large, high contrast.
- Clear the cart once the order reaches `PAID`.

- [ ] **Step 5: Add the remaining customer routes**

In `src/routes/index.tsx`, inside the `/order` route element, add:

```tsx
        <Route path="checkout" element={<Suspense fallback={<RouteFallback />}><CheckoutPage /></Suspense>} />
        <Route path="status/:id" element={<Suspense fallback={<RouteFallback />}><OrderStatusPage /></Suspense>} />
```

with matching `lazy(...)` imports at the top.

- [ ] **Step 6: Run the tests**

Run: `npm test && npx tsc -b && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add src/services/cloud/orders.ts src/services/cloud/__tests__/orders.test.ts src/pages/Customer/OrderStatusPage.tsx src/routes/index.tsx
git commit -m "feat: add live order status for the customer"
```

---

## Phase 5 — Portal and kitchen

### Task 16: Convert a paid order into a local bill

**Files:**
- Create: `src/services/billing/orderToBill.ts`
- Test: `src/services/billing/__tests__/orderToBill.test.ts`

**Interfaces:**
- Consumes: `CloudOrder`; `computeBill`; `Settings`, `Bill` from `@/types`
- Produces: `orderToBill(order, { seq, billNo, settings, cashierId, cashierName })`

- [ ] **Step 1: Write the failing test**

Create `src/services/billing/__tests__/orderToBill.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { orderToBill } from '../orderToBill';
import { DEFAULT_SETTINGS } from '@/data/defaults';
import type { CloudOrder } from '@/types/order';

const order: CloudOrder = {
  id: 'o1', token: 'A-07', tableCode: 'T04', customerId: 'u1',
  customerName: 'Priya', customerPhone: '9876543210', status: 'PAID',
  subtotal: 95, tax: 4.75, total: 99.75,
  razorpayPaymentId: 'pay_1', createdAt: '2026-09-08T10:00:00Z',
  paidAt: '2026-09-08T10:01:00Z',
  lines: [
    { id: 'l1', orderId: 'o1', productId: 'p1', name: 'Filter Coffee', unitPrice: 25, qty: 2, taxRate: 5 },
    { id: 'l2', orderId: 'o1', productId: 'p2', name: 'Vadai', unitPrice: 15, qty: 3, taxRate: 5 },
  ],
};

const ctx = {
  seq: 1026, billNo: 'INV-1026', settings: DEFAULT_SETTINGS,
  cashierId: 'u-sys', cashierName: 'Online',
};

describe('orderToBill', () => {
  it('records the payment as UPI, since that is what the gateway settled', () => {
    expect(orderToBill(order, ctx).payment).toBe('upi');
  });

  it('marks the bill completed — the money is already taken', () => {
    expect(orderToBill(order, ctx).status).toBe('completed');
  });

  it('links back to the cloud order so it is never double-billed', () => {
    expect(orderToBill(order, ctx).sourceOrderId).toBe('o1');
  });

  it('carries the customer name and phone onto the bill', () => {
    const bill = orderToBill(order, ctx);
    expect(bill.customerName).toBe('Priya');
    expect(bill.customerPhone).toBe('9876543210');
  });

  it('recomputes totals locally and agrees with the server to the paise', () => {
    const bill = orderToBill(order, ctx);
    expect(bill.totals.subtotal).toBe(95);
    expect(bill.totals.tax).toBe(4.75);
    expect(bill.totals.total).toBe(99.75);
  });

  it('notes the table and token so the counter can find the order', () => {
    const bill = orderToBill(order, ctx);
    expect(bill.note).toContain('T04');
    expect(bill.note).toContain('A-07');
  });

  it('queues the bill for sync like any other', () => {
    expect(orderToBill(order, ctx).synced).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- orderToBill`
Expected: FAIL — cannot resolve `../orderToBill`.

- [ ] **Step 3: Check the settings export name**

Run: `grep -n "^export" src/data/defaults.ts`
If the default settings are exported under a different name, use that name in
both the test and the implementation.

- [ ] **Step 4: Write the converter**

Create `src/services/billing/orderToBill.ts`:

```ts
import { computeBill } from './calc';
import type { Bill, BillLine, ID, Settings } from '@/types';
import type { CloudOrder } from '@/types/order';

/* A paid QR order becomes an ordinary bill in the till's own database, so
   reports, day-close and refunds treat it exactly like a walk-in sale.

   Totals are recomputed locally rather than trusted from the cloud row. They
   must agree — both sides run the same engine — and recomputing means a bill
   is never stored with a total the till itself would not have produced. */

export interface BillContext {
  seq: number;
  billNo: string;
  settings: Settings;
  cashierId: ID;
  cashierName: string;
}

export function orderToBill(order: CloudOrder, ctx: BillContext): Bill {
  const lines: BillLine[] = order.lines.map((l) => ({
    id: l.id,
    productId: l.productId,
    name: l.name,
    unitPrice: l.unitPrice,
    costPrice: 0,     // the cloud never carries cost; margin comes from the product
    qty: l.qty,
    discount: 0,
    discountType: 'percent',
    taxRate: l.taxRate,
    note: l.note,
  }));

  const { totals } = computeBill(lines, 0, 'fixed', {
    pricesIncludeTax: ctx.settings.billing.pricesIncludeTax,
    roundTotals: ctx.settings.billing.roundTotals,
  });

  return {
    id: `bill-${order.id}`,   // deterministic: a replayed order cannot double-bill
    billNo: ctx.billNo,
    seq: ctx.seq,
    createdAt: order.paidAt ?? order.createdAt,
    lines,
    billDiscount: 0,
    billDiscountType: 'fixed',
    totals,
    payment: 'upi',           // settled by the gateway
    status: 'completed',
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    cashierId: ctx.cashierId,
    cashierName: ctx.cashierName,
    note: `Online order ${order.token} · Table ${order.tableCode}`,
    synced: 0,
    sourceOrderId: order.id,
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- orderToBill`
Expected: PASS, 7 cases.

- [ ] **Step 6: Commit**

```bash
git add src/services/billing/orderToBill.ts src/services/billing/__tests__/orderToBill.test.ts
git commit -m "feat: convert a paid cloud order into a local bill"
```

---

### Task 17: KOT docket

**Files:**
- Create: `src/services/billing/kot.ts`
- Test: `src/services/billing/__tests__/kot.test.ts`

**Interfaces:**
- Consumes: `CloudOrder`; `BusinessProfile` from `@/types`
- Produces: `kotHtml(order, businessName)`, `printKot(order, businessName)`

**Requirement from the user:** the KOT carries the customer's name and contact
number, and is only ever produced for a paid order.

- [ ] **Step 1: Write the failing test**

Create `src/services/billing/__tests__/kot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { kotHtml } from '../kot';
import type { CloudOrder } from '@/types/order';

const order = (over: Partial<CloudOrder> = {}): CloudOrder => ({
  id: 'o1', token: 'A-07', tableCode: 'T04', customerId: 'u1',
  customerName: 'Priya', customerPhone: '9876543210', status: 'PAID',
  subtotal: 95, tax: 4.75, total: 99.75,
  createdAt: '2026-09-08T10:00:00Z', paidAt: '2026-09-08T10:01:00Z',
  lines: [
    { id: 'l1', orderId: 'o1', productId: 'p1', name: 'Filter Coffee', unitPrice: 25, qty: 2, taxRate: 5 },
    { id: 'l2', orderId: 'o1', productId: 'p2', name: 'Vadai', unitPrice: 15, qty: 3, taxRate: 5, note: 'no chutney' },
  ],
  ...over,
});

describe('kotHtml', () => {
  it('shows the customer name and contact number', () => {
    const html = kotHtml(order(), 'THANJAI CAFE');
    expect(html).toContain('Priya');
    expect(html).toContain('9876543210');
  });

  it('leads with the token and the table', () => {
    const html = kotHtml(order(), 'THANJAI CAFE');
    expect(html).toContain('A-07');
    expect(html).toContain('T04');
  });

  it('lists every item with its quantity', () => {
    const html = kotHtml(order(), 'THANJAI CAFE');
    expect(html).toContain('Filter Coffee');
    expect(html).toContain('2');
    expect(html).toContain('Vadai');
    expect(html).toContain('3');
  });

  it('shows a line note the kitchen must act on', () => {
    expect(kotHtml(order(), 'THANJAI CAFE')).toContain('no chutney');
  });

  it('carries no prices — the kitchen does not need the money', () => {
    const html = kotHtml(order(), 'THANJAI CAFE');
    expect(html).not.toContain('99.75');
    expect(html).not.toContain('₹');
  });

  it('refuses to render a docket for an unpaid order', () => {
    expect(() => kotHtml(order({ status: 'AWAITING_PAYMENT' }), 'X'))
      .toThrow(/paid/i);
    expect(() => kotHtml(order({ status: 'PAYMENT_FAILED' }), 'X'))
      .toThrow(/paid/i);
  });

  it('escapes a name that would otherwise inject markup', () => {
    const html = kotHtml(order({ customerName: '<script>x</script>' }), 'X');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- kot`
Expected: FAIL — cannot resolve `../kot`.

- [ ] **Step 3: Write the KOT module**

Create `src/services/billing/kot.ts`:

```ts
import { isKitchenVisible } from '@/services/cloud/status';
import type { CloudOrder } from '@/types/order';

/* The kitchen order ticket. Sized for an 80 mm kitchen printer and printed
   through the same hidden-iframe path as the customer receipt.

   Deliberately carries no prices: the kitchen needs the dish, the quantity,
   the table and who to call — money is the counter's business. */

export function kotHtml(order: CloudOrder, businessName: string): string {
  // A docket exists only for food that has been paid for. Guarding here as
  // well as in the query means no future caller can bypass the rule.
  if (!isKitchenVisible(order.status)) {
    throw new Error('Refusing to print a KOT for an order that is not paid');
  }

  const time = new Date(order.paidAt ?? order.createdAt).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit',
  });

  const rows = order.lines.map((l) => `
    <tr>
      <td class="qty">${l.qty}</td>
      <td>${esc(l.name)}${l.note ? `<div class="note">${esc(l.note)}</div>` : ''}</td>
    </tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8" />
<title>KOT ${esc(order.token)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font-family: system-ui, sans-serif; width: 74mm; margin: 0; color: #000; }
  .shop { text-align: center; font-size: 10pt; }
  .title { text-align: center; font-size: 13pt; font-weight: 700;
           border-bottom: 2px solid #000; padding-bottom: 2mm; margin-bottom: 2mm; }
  .token { font-size: 26pt; font-weight: 800; text-align: center; line-height: 1; }
  .meta { display: flex; justify-content: space-between; font-size: 10pt; margin: 2mm 0; }
  .cust { font-size: 10pt; border-top: 1px dashed #000; border-bottom: 1px dashed #000;
          padding: 2mm 0; margin-bottom: 2mm; }
  table { width: 100%; border-collapse: collapse; font-size: 12pt; }
  td { padding: 1.5mm 0; vertical-align: top; border-bottom: 1px dotted #bbb; }
  .qty { width: 10mm; font-weight: 800; font-size: 14pt; }
  .note { font-size: 9pt; font-style: italic; padding-left: 2mm; }
</style></head><body>
  <div class="shop">${esc(businessName)}</div>
  <div class="title">KITCHEN ORDER</div>
  <div class="token">${esc(order.token)}</div>
  <div class="meta"><span>Table ${esc(order.tableCode)}</span><span>${esc(time)}</span></div>
  <div class="cust">
    <div><strong>${esc(order.customerName || 'Guest')}</strong></div>
    <div>${esc(order.customerPhone)}</div>
  </div>
  <table>${rows}</table>
</body></html>`;
}

/** Print through a hidden iframe — the same approach as printReceipt, so there
    is no PDF dependency and the OS print dialog does the work. */
export function printKot(order: CloudOrder, businessName: string): void {
  const html = kotHtml(order, businessName);
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);

  const doc = frame.contentWindow?.document;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();

  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- kot`
Expected: PASS, 7 cases.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/kot.ts src/services/billing/__tests__/kot.test.ts
git commit -m "feat: add KOT docket with customer name and contact"
```

---

### Task 18: Auto-accept paid orders on the till

**Files:**
- Create: `src/features/orders/useOrderIntake.ts`
- Test: `src/features/orders/__tests__/claim.test.ts`

**Interfaces:**
- Consumes: `subscribeToKitchen`, `fetchKitchenOrders`, `advanceStatus`, `orderToBill`, `useAppStore`
- Produces: `useOrderIntake()`; `claimOrder(orderId)`

**The concurrency rule:** two tills may both be watching. Auto-accept is claimed
with a conditional update so only one writes the bill. Without this, one order
becomes two bills with two invoice numbers.

- [ ] **Step 1: Write the failing test**

Create `src/features/orders/__tests__/claim.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildClaim } from '../useOrderIntake';

describe('buildClaim', () => {
  it('claims only an order that has not been accepted yet', () => {
    const claim = buildClaim('o1');
    expect(claim.match).toEqual({ id: 'o1', status: 'PAID' });
    expect(claim.patch.status).toBe('ACCEPTED');
    expect(claim.patch.accepted_at).toBeTruthy();
  });

  it('never claims by id alone — a second till must lose the race', () => {
    expect(Object.keys(buildClaim('o1').match)).toContain('status');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- claim`
Expected: FAIL — cannot resolve `../useOrderIntake`.

- [ ] **Step 3: Write the intake hook**

Create `src/features/orders/useOrderIntake.ts`:

```ts
import { useEffect, useState } from 'react';
import { supabase } from '@/services/cloud/client';
import { fetchKitchenOrders, subscribeToKitchen } from '@/services/cloud/orders';
import { orderToBill } from '@/services/billing/orderToBill';
import { useAppStore } from '@/store/useAppStore';
import type { CloudOrder } from '@/types/order';

/* Turns paid cloud orders into local bills.

   Two tills may both be watching the same order. The claim is a conditional
   update — status must still be PAID — so exactly one device wins and writes
   the bill. The loser finds nothing updated and does nothing, which is what
   stops one order becoming two bills with two invoice numbers. */

export const buildClaim = (orderId: string) => ({
  match: { id: orderId, status: 'PAID' as const },
  patch: { status: 'ACCEPTED' as const, accepted_at: new Date().toISOString() },
});

/** Returns true if this device won the claim and should write the bill. */
export async function claimOrder(orderId: string): Promise<boolean> {
  if (!supabase) return false;
  const { match, patch } = buildClaim(orderId);
  const { data } = await supabase
    .from('orders').update(patch)
    .eq('id', match.id).eq('status', match.status)
    .select();
  return Boolean(data?.length);
}

export function useOrderIntake(enabled: boolean) {
  const [orders, setOrders] = useState<CloudOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !supabase) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const list = await fetchKitchenOrders();
        if (cancelled) return;
        setOrders(list);
        setError(null);

        // Auto-accept: every PAID order becomes a bill on whichever till
        // wins the claim.
        for (const order of list.filter((o) => o.status === 'PAID')) {
          if (!await claimOrder(order.id)) continue;

          const store = useAppStore.getState();
          const { seq, billNo } = await store.reserveBillNo();
          const bill = orderToBill(order, {
            seq, billNo,
            settings: store.settings,
            cashierId: store.currentUser?.id ?? 'online',
            cashierName: store.currentUser?.name ?? 'Online',
          });
          await store.saveBill(bill);
          await supabase!.from('orders').update({ bill_id: bill.id }).eq('id', order.id);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load orders');
      }
    };

    void refresh();
    const unsubscribe = subscribeToKitchen(() => { void refresh(); });

    // A fallback poll, because a delayed webhook or a dropped socket must not
    // strand a paid order.
    const poll = setInterval(() => { void refresh(); }, 30_000);

    return () => { cancelled = true; unsubscribe(); clearInterval(poll); };
  }, [enabled]);

  return { orders, error };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- claim`
Expected: PASS, 2 cases.

- [ ] **Step 5: Commit**

```bash
git add src/features/orders/useOrderIntake.ts src/features/orders/__tests__/claim.test.ts
git commit -m "feat: auto-accept paid orders into local bills with a single-winner claim"
```

---

### Task 19: Kitchen display screen

**Files:**
- Create: `src/pages/Kitchen/KitchenPage.tsx`
- Modify: `src/routes/index.tsx` (add `/kitchen` behind `kot`)
- Modify: `src/components/layout/AppLayout.tsx` (nav entry for kitchen users)

**Interfaces:**
- Consumes: `useOrderIntake`, `advanceStatus`, `printKot`, `can` from `@/features/auth/permissions`

**Note:** the `kot` permission and `kitchen` role already exist in
`src/features/auth/permissions.ts`. Use them; do not invent new ones.

- [ ] **Step 1: Build the ticket board**

Create `src/pages/Kitchen/KitchenPage.tsx`:

- `useOrderIntake(true)` for live tickets.
- Three columns on a wide screen — New (`PAID`/`ACCEPTED`), Preparing, Ready —
  stacking to one column on a tablet held upright.
- Each ticket card: token large, table, customer name and phone, the item lines
  with quantities and notes, and how long it has been waiting.
- A ticket older than 15 minutes takes a warning treatment.
- Primary action per card advances the status: Start → `PREPARING`,
  Ready → `READY`, Picked up → `SERVED` (which removes it from the board).
- A Print button per card calling `printKot`.
- Kitchen screens are read across a room: large type, high contrast, no hover-only
  affordances.
- When online ordering is not configured, show a clear explanation instead of
  an empty board.

- [ ] **Step 2: Add the route**

In `src/routes/index.tsx`, alongside the other lazy imports:

```tsx
const KitchenPage = lazy(() =>
  import('@/pages/Kitchen/KitchenPage').then((m) => ({ default: m.KitchenPage })));
```

and inside the authenticated block:

```tsx
        <Route path="kitchen" element={<RequirePermission permission="kot"><Suspense fallback={<RouteFallback />}><KitchenPage /></Suspense></RequirePermission>} />
```

- [ ] **Step 3: Send kitchen users to the right landing page**

In `src/features/auth/permissions.ts`, `landingRoute` currently sends a kitchen
user to `/billing`, which they cannot use. Change the `kot` branch to:

```ts
  if (can(user, 'kot')) return '/kitchen';
```

Keep it after the `reports` and `billing` checks so owners and managers still
land on the dashboard.

- [ ] **Step 4: Add the nav entry**

In `src/components/layout/AppLayout.tsx`, follow the existing nav-item pattern to
add "Kitchen" guarded by `can(user, 'kot')`.

- [ ] **Step 5: Verify permissions by hand**

Run `npm run dev`. Sign in with the Kitchen PIN `4567`.
Expected: lands on `/kitchen`; no Reports or Settings in the nav.
Sign in as Cashier `3456` and open `/kitchen` directly.
Expected: the permission explanation, not the board.

- [ ] **Step 6: Confirm nothing broke**

Run: `npm test && npx tsc -b && npm run lint && node .verify/e2e.mjs`

- [ ] **Step 7: Commit**

```bash
git add src/pages/Kitchen/KitchenPage.tsx src/routes/index.tsx src/components/layout/AppLayout.tsx src/features/auth/permissions.ts
git commit -m "feat: add the kitchen display screen"
```

---

### Task 20: Online Orders page on the billing portal

**Files:**
- Create: `src/pages/Billing/OnlineOrdersPage.tsx`
- Modify: `src/routes/index.tsx` (add `/billing/online`)
- Modify: `src/components/layout/AppLayout.tsx` (nav entry with a count badge)

**Interfaces:**
- Consumes: `useOrderIntake`, `printKot`, `useAppStore`, `useOrderAlerts`
- Produces: `OnlineOrdersPage`

**The point of this page:** a paid order must not appear silently in Bill
History. This is the cashier's live view of what has been paid for and what the
kitchen is cooking.

- [ ] **Step 1: Build the Online Orders page**

Create `src/pages/Billing/OnlineOrdersPage.tsx`:

- `useOrderIntake(true)`, newest first, showing every order not yet served.
- Each row: token (large — it is what gets called out), table, customer name and
  phone, the item lines, total, kitchen status, and the bill number once one
  exists (linking to it in Bill History).
- Per-row actions: **Print KOT** (`printKot`) and **Mark served**.
- A row whose order contains a now-unavailable item is flagged "Refund needed"
  — the cashier decides; the app never silently cooks it.
- An "online ordering not configured" state when there is no cloud, matching the
  Settings tab's wording.
- Opening this page clears the unseen-order badge (see Task 21).

- [ ] **Step 2: Add the route and the nav entry**

```tsx
        <Route path="billing/online" element={<RequirePermission permission="billing"><Suspense fallback={<RouteFallback />}><OnlineOrdersPage /></Suspense></RequirePermission>} />
```

with a matching lazy import, and a nav entry labelled "Online Orders" beside
Bill History carrying the count badge from `useOrderAlerts`.

- [ ] **Step 3: Verify by hand**

Run `npm run dev`, sign in as Owner (PIN 1234), open `/billing/online`.
Expected with no `.env.local`: the "not configured" state, no crash, no console
error, and the rest of the billing section still working.

- [ ] **Step 4: Confirm nothing broke**

Run: `npm test && npx tsc -b && npm run lint && node .verify/e2e.mjs`

- [ ] **Step 5: Commit**

```bash
git add src/pages/Billing/OnlineOrdersPage.tsx src/routes/index.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: add the Online Orders page to the billing portal"
```

---

### Task 21: Announce a paid order to the cashier

**Files:**
- Create: `src/features/orders/useOrderAlerts.ts`
- Create: `src/features/orders/OrderAlertHost.tsx`
- Modify: `src/components/layout/AppLayout.tsx` (mount the host, badge the nav)
- Modify: `src/pages/Settings/SettingsPage.tsx` (a mute toggle in Notifications)
- Modify: `src/types/index.ts` (add `onlineOrderAlert` to `NotificationSettings`)
- Modify: `src/data/defaults.ts` (default it true)
- Test: `src/features/orders/__tests__/alerts.test.ts`

**Interfaces:**
- Consumes: `CloudOrder`, `useOrderIntake`, `useAppStore`
- Produces: `useOrderAlerts()` returning `{ orders, unseen, banner, dismissBanner, markSeen }`; `newlyArrived(previous, current)`; `OrderAlertHost`

**Why this task exists:** a bill that appears silently is one the counter learns
about when the customer asks where their food is. The order has to announce
itself — without hijacking a walk-in sale in progress.

- [ ] **Step 1: Write the failing test**

Create `src/features/orders/__tests__/alerts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newlyArrived } from '../useOrderAlerts';
import type { CloudOrder } from '@/types/order';

const order = (id: string, status: CloudOrder['status'] = 'PAID'): CloudOrder => ({
  id, token: `A-${id}`, tableCode: 'T04', customerId: 'u1',
  customerName: 'Priya', customerPhone: '9876543210', status,
  subtotal: 95, tax: 4.75, total: 99.75,
  createdAt: '2026-09-10T10:00:00Z', lines: [],
});

describe('newlyArrived', () => {
  it('reports an order that was not there before', () => {
    expect(newlyArrived([], [order('o1')]).map((o) => o.id)).toEqual(['o1']);
  });

  it('stays silent when nothing changed', () => {
    const same = [order('o1')];
    expect(newlyArrived(same, same)).toEqual([]);
  });

  it('does not re-announce an order that only changed status', () => {
    expect(newlyArrived([order('o1', 'PAID')], [order('o1', 'PREPARING')])).toEqual([]);
  });

  it('announces only the new one when others are already known', () => {
    const before = [order('o1')];
    const after = [order('o1'), order('o2')];
    expect(newlyArrived(before, after).map((o) => o.id)).toEqual(['o2']);
  });

  it('never announces an unpaid order', () => {
    expect(newlyArrived([], [order('o1', 'AWAITING_PAYMENT')])).toEqual([]);
    expect(newlyArrived([], [order('o1', 'PAYMENT_FAILED')])).toEqual([]);
  });

  it('says nothing on the very first load', () => {
    // A till opening in the morning must not chime once per order left on the
    // board from last night. `previous === null` means "we had not looked yet".
    expect(newlyArrived(null, [order('o1'), order('o2')])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- alerts`
Expected: FAIL — cannot resolve `../useOrderAlerts`.

- [ ] **Step 3: Write the alert hook**

Create `src/features/orders/useOrderAlerts.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { useOrderIntake } from './useOrderIntake';
import { useAppStore } from '@/store/useAppStore';
import type { CloudOrder } from '@/types/order';

/* Deciding what counts as NEW is the whole job here, and it is pure, so it is
   tested directly. The chime, the badge and the banner all hang off it. */

export function newlyArrived(
  previous: CloudOrder[] | null,
  current: CloudOrder[],
): CloudOrder[] {
  // The first load is not an event. A till opening in the morning must not
  // chime once for every order still on the board from last night.
  if (previous === null) return [];
  const known = new Set(previous.map((o) => o.id));
  return current.filter((o) => o.status === 'PAID' && !known.has(o.id));
}

/** A short chime built with WebAudio — no asset to bundle, works offline. */
function playChime(): void {
  try {
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    for (const [freq, at] of [[880, 0], [1320, 0.12]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.3);
    }
    setTimeout(() => void ctx.close(), 900);
  } catch {
    // A till with audio blocked still gets the badge and the banner.
  }
}

export function useOrderAlerts() {
  const { orders } = useOrderIntake(true);
  const soundOn = useAppStore((s) => s.settings.notifications.onlineOrderAlert);

  const previous = useRef<CloudOrder[] | null>(null);
  const [unseen, setUnseen] = useState<string[]>([]);
  const [banner, setBanner] = useState<CloudOrder | null>(null);

  useEffect(() => {
    const arrived = newlyArrived(previous.current, orders);
    previous.current = orders;
    if (!arrived.length) return;

    setUnseen((u) => [...u, ...arrived.map((o) => o.id).filter((id) => !u.includes(id))]);
    setBanner(arrived[arrived.length - 1]);
    if (soundOn) playChime();
  }, [orders, soundOn]);

  // An order that has been served stops counting, even if never opened.
  useEffect(() => {
    const live = new Set(orders.map((o) => o.id));
    setUnseen((u) => (u.every((id) => live.has(id)) ? u : u.filter((id) => live.has(id))));
  }, [orders]);

  const markSeen = () => { setUnseen([]); setBanner(null); };

  return {
    orders,
    unseen: unseen.length,
    banner,
    dismissBanner: () => setBanner(null),
    markSeen,
  };
}
```

- [ ] **Step 4: Add the setting**

In `src/types/index.ts`, add to `NotificationSettings`:

```ts
  onlineOrderAlert: boolean;
```

In `src/data/defaults.ts`, add `onlineOrderAlert: true` to the notifications
defaults. Then add a toggle to the Notifications section of
`src/pages/Settings/SettingsPage.tsx` labelled "Sound for new online orders",
following the `ToggleRow` pattern already used in that section.

- [ ] **Step 5: Build the banner host**

Create `src/features/orders/OrderAlertHost.tsx`. It renders `null` unless there
is a banner; otherwise a fixed, NON-MODAL card near the top of the screen showing
the token, table and item count, with a *View order* button routing to
`/billing/online` and a dismiss control.

It MUST NOT block the screen: a cashier mid-bill for a walk-in customer has to be
able to keep typing. Auto-dismiss after about 8 seconds, leaving the nav badge as
the persistent signal. Use the existing UI primitives and semantic tokens.

Mount it inside `AppLayout` gated on `can(user, 'billing')`, and put the `unseen`
count as a badge on the Online Orders nav entry.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test -- alerts`
Expected: PASS, 6 cases.

- [ ] **Step 7: Confirm nothing broke**

Run: `npm test && npx tsc -b && npm run lint && node .verify/e2e.mjs`

- [ ] **Step 8: Commit**

```bash
git add src/features/orders/useOrderAlerts.ts src/features/orders/OrderAlertHost.tsx src/features/orders/__tests__/alerts.test.ts src/components/layout/AppLayout.tsx src/pages/Settings/SettingsPage.tsx src/types/index.ts src/data/defaults.ts
git commit -m "feat: announce a paid online order to the cashier"
```

---

### Task 22: Mark online bills in history

**Files:**
- Modify: `src/services/reports/analytics.ts`
- Modify: `src/pages/Billing/BillHistoryPage.tsx`
- Test: `src/services/reports/__tests__/online.test.ts`

**Interfaces:**
- Consumes: `Bill.sourceOrderId`
- Produces: `isOnlineBill(bill)`

**Why:** the bill must behave like every other bill — same invoice number, same
receipt, same refund path — while still being identifiable at a glance.

- [ ] **Step 1: Write the failing test**

Create `src/services/reports/__tests__/online.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isOnlineBill } from '../analytics';
import type { Bill } from '@/types';

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: 'b1', billNo: 'INV-1', seq: 1, createdAt: '2026-09-10T10:00:00Z',
  lines: [], billDiscount: 0, billDiscountType: 'fixed',
  totals: { subtotal: 0, itemDiscount: 0, billDiscount: 0, taxableValue: 0, tax: 0, total: 0, cost: 0 },
  payment: 'cash', status: 'completed', cashierId: 'u', cashierName: 'C', synced: 0, ...over,
});

describe('isOnlineBill', () => {
  it('is true only when the bill came from a QR order', () => {
    expect(isOnlineBill(bill({ sourceOrderId: 'o1' }))).toBe(true);
  });

  it('is false for an ordinary walk-in bill', () => {
    expect(isOnlineBill(bill())).toBe(false);
  });

  it('is false when the field is present but empty', () => {
    expect(isOnlineBill(bill({ sourceOrderId: '' }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- online`
Expected: FAIL — `isOnlineBill` is not exported.

- [ ] **Step 3: Add the helper**

In `src/services/reports/analytics.ts`:

```ts
/** A bill raised from a QR order rather than taken at the counter. */
export const isOnlineBill = (b: Bill): boolean => Boolean(b.sourceOrderId);
```

- [ ] **Step 4: Show it in Bill History**

Read the existing row and filter patterns in
`src/pages/Billing/BillHistoryPage.tsx` first, then:

- Render an **Online** `Badge` on any row where `isOnlineBill(bill)`, beside the
  existing payment indicator.
- Add "Online" to whatever filter control the page already has — match the
  existing control style, do not introduce a new one.
- In the bill detail view, surface the order token and table. `orderToBill`
  already writes them into the bill's `note` as `Online order A-07 · Table T04`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- online`
Expected: PASS, 3 cases.

- [ ] **Step 6: Confirm nothing broke**

Run: `npm test && npx tsc -b && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add src/services/reports/analytics.ts src/services/reports/__tests__/online.test.ts src/pages/Billing/BillHistoryPage.tsx
git commit -m "feat: mark online orders in bill history"
```

---

### Task 23: Online sales on the daily closing

**Files:**
- Modify: `src/types/index.ts` (add `onlineSales` to `DayClose`)
- Modify: `src/services/reports/analytics.ts`
- Modify: `src/pages/Billing/DayClosePage.tsx`
- Test: `src/services/reports/__tests__/dayclose-online.test.ts`

**Interfaces:**
- Consumes: `isOnlineBill`, `cashInDrawer`
- Produces: `onlineSalesTotal(bills)`

**The rule:** online money is in the bank, not the drawer. It counts as sales but
must never inflate the expected cash a shop reconciles against.

- [ ] **Step 1: Write the failing test**

Create `src/services/reports/__tests__/dayclose-online.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { onlineSalesTotal, cashInDrawer } from '../analytics';
import type { Bill } from '@/types';

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: Math.random().toString(36).slice(2), billNo: 'INV-1', seq: 1,
  createdAt: '2026-09-10T10:00:00Z', lines: [], billDiscount: 0, billDiscountType: 'fixed',
  totals: { subtotal: 100, itemDiscount: 0, billDiscount: 0, taxableValue: 100, tax: 0, total: 100, cost: 0 },
  payment: 'cash', status: 'completed', cashierId: 'u', cashierName: 'C', synced: 0, ...over,
});

describe('onlineSalesTotal', () => {
  it('counts only bills raised from a QR order', () => {
    const bills = [bill({ sourceOrderId: 'o1', payment: 'upi' }), bill({ payment: 'cash' })];
    expect(onlineSalesTotal(bills)).toBe(100);
  });

  it('excludes refunded and cancelled online orders', () => {
    const bills = [
      bill({ sourceOrderId: 'o1', payment: 'upi', status: 'refunded' }),
      bill({ sourceOrderId: 'o2', payment: 'upi', status: 'cancelled' }),
    ];
    expect(onlineSalesTotal(bills)).toBe(0);
  });

  it('is zero on a day with no online orders', () => {
    expect(onlineSalesTotal([bill(), bill()])).toBe(0);
  });
});

describe('online money never reaches the drawer', () => {
  it('is excluded from expected cash', () => {
    const bills = [
      bill({ payment: 'cash' }),                       // in the drawer
      bill({ sourceOrderId: 'o1', payment: 'upi' }),   // in the bank
    ];
    expect(cashInDrawer(bills)).toBe(100);
  });

  it('stays excluded even if an online order were somehow marked cash', () => {
    // Defensive: orderToBill always writes 'upi', but the drawer figure is what
    // a shop reconciles against, so it must not be one edit away from wrong.
    expect(cashInDrawer([bill({ sourceOrderId: 'o1', payment: 'cash' })])).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- dayclose-online`
Expected: FAIL — `onlineSalesTotal` is not exported, and the last case fails
because `cashInDrawer` does not yet exclude online bills.

- [ ] **Step 3: Add the analytics**

In `src/services/reports/analytics.ts`:

```ts
/** Sales taken through QR ordering. Settled by the gateway, not the drawer. */
export function onlineSalesTotal(bills: Bill[]): number {
  return money(
    bills.filter((b) => isSale(b) && isOnlineBill(b)).reduce((a, b) => a + b.totals.total, 0),
  );
}
```

and amend `cashInDrawer` so gateway money can never be counted as cash:

```ts
export function cashInDrawer(bills: Bill[]): number {
  return money(
    bills
      // `!isOnlineBill` is belt and braces: orderToBill always writes 'upi', but
      // this figure is what a shop counts its drawer against, so it must not be
      // one future edit away from being wrong.
      .filter((b) => isSale(b) && b.payment === 'cash' && !isOnlineBill(b))
      .reduce((a, b) => a + b.totals.total, 0),
  );
}
```

- [ ] **Step 4: Add the field and the row**

In `src/types/index.ts`, add to `DayClose`:

```ts
  onlineSales: number;      // QR orders — settled by the gateway, not the drawer
```

In `src/pages/Billing/DayClosePage.tsx`: compute it with `onlineSalesTotal`,
persist it in the saved `DayClose`, and render a `CloseRow` labelled
"Online (UPI)" beside the existing Cash / UPI / Card rows — in BOTH the live view
and the already-closed view. Add one line of helper text making clear that online
sales are not part of the expected cash.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test -- dayclose-online`
Expected: PASS, 5 cases.

- [ ] **Step 6: Confirm the whole closing flow still works**

Run: `npm test && npx tsc -b && npm run lint && node .verify/e2e.mjs`
The e2e script walks through Day Close, so it exercises this screen.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/services/reports/analytics.ts src/services/reports/__tests__/dayclose-online.test.ts src/pages/Billing/DayClosePage.tsx
git commit -m "feat: show online sales on the daily closing without touching the drawer"
```

---

### Task 24: End-to-end verification and README

**Files:**
- Create: `.verify/qr-order-e2e.mjs`
- Modify: `README.md`

- [ ] **Step 1: Write the end-to-end verification script**

Create `.verify/qr-order-e2e.mjs`, modelled on `.verify/e2e.mjs` and using the
shared `launch()` helper from `.verify/launch.mjs` (Playwright's pinned chromium
is not installed in this environment; the helper falls back to what is).

Because it needs a live Supabase and Razorpay test mode, it must SKIP cleanly
with a clear message when `VITE_SUPABASE_URL` is unset, rather than failing.

When configured, it asserts:
1. `/order?t=T04` loads the published menu with no session.
2. Adding items updates the cart total.
3. Checkout without sign-in prompts for Google.
4. An order inserted directly with status `PAID` (bypassing the gateway, which
   cannot be automated) appears on `/kitchen` within 10 seconds.
5. The same order does **not** appear on `/kitchen` while its status is
   `AWAITING_PAYMENT`.
6. It also appears on `/billing/online`, and a bill exists for it in history
   carrying the Online badge.
7. Advancing it to `READY` on the kitchen board updates the customer's status page.

- [ ] **Step 2: Run the full verification suite**

Run:
```bash
npm test && npx tsc -b && npm run lint && npm run build
node .verify/e2e.mjs && node .verify/mobile.mjs && node .verify/dark.mjs && node .verify/offline.mjs && node .verify/customer-routes.mjs && node .verify/qr-order-e2e.mjs
```
Expected: every check passes. `offline.mjs` passing matters most — it proves the
till still works with the network down.

- [ ] **Step 3: Update the README**

Add a section covering: the customer ordering flow, the three surfaces and their
URLs, the setup steps (publish menu, print QR codes, configure Google and
Razorpay), how a paid order reaches the cashier and the kitchen, and the
single-writer rule for `PAID`. Correct the existing "Notes for going further"
entry saying payments are confirmed manually — no longer true for QR orders,
though still true for walk-in bills.

- [ ] **Step 4: Commit**

```bash
git add .verify/qr-order-e2e.mjs README.md
git commit -m "feat: end-to-end QR order verification and README"
```

---

## Deployment checklist

Not tasks — the owner does these once, after Task 20.

- [ ] Apply `supabase/migrations/*.sql` (SQL editor, or `supabase db push`)
- [ ] Enable the Google provider in Supabase Auth with a Google Cloud OAuth client
- [ ] `npx supabase functions deploy create-order verify-payment`
- [ ] `npx supabase secrets set RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… RAZORPAY_WEBHOOK_SECRET=…`
- [ ] Register the Razorpay webhook at `/functions/v1/verify-payment` for
      `payment.captured` and `payment.failed`
- [ ] Deploy to Vercel, setting `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
      `VITE_RAZORPAY_KEY_ID` and `VITE_PUBLIC_ORDER_URL`
- [ ] Settings → Online Ordering → Publish menu
- [ ] Settings → Online Ordering → print the table QR codes
- [ ] Place one real test order end to end before going live
- [ ] Switch Razorpay from test keys to live keys
