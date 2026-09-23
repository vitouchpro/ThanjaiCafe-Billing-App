# Phase 1 Foundation (Schema, Identity, RLS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-tenant foundation the whole cafe/bakery SaaS is built on: real tenant/device/staff identity and RLS, and the schema for every in-scope module (schema-first, features ship later in waves), gated by an automated isolation test suite and a PowerSync-Sync-Streams-vs-RLS agreement test.

**Architecture:** Three parts, each ending in a committable, independently testable state. **Part A** builds the tenancy/identity core (`accounts`, `shops`, `devices`, `memberships`, `staff`, `settings`, `approvals`), the access-token hook, device enrolment, owner MFA, approval tokens, PIN policy, and migrations-as-code + CI. **Part B** adds the schema (tables, RLS, grants — no business logic) for every remaining module from the spec, grouped into 11 migrations by subsystem. **Part C** builds the isolation test suite covering every table from A and B, the Sync Streams config for all synced tables, and the automated agreement test that asserts Sync Streams read-scope and Postgres RLS write-scope never drift.

**Tech Stack:** Supabase (Postgres 17, Auth, custom access-token hooks, Data API grants), PowerSync (Sync Streams), Supabase CLI (`supabase db push` from CI), Vitest for Node-side tests, `pg_prove`/plain SQL for DB-side tests where simpler.

**Spec:** `docs/superpowers/specs/2026-09-20-cafe-billing-saas-design.md` (sections 3-7, 10-13; table list in section 5; Phase 1 row in section 16's Phases table)

**Prior art this plan builds on:** `docs/superpowers/spikes/2026-09-powersync-spike-findings.md` — the spike proved the `shops`/`devices`/`products`/`bills`/`bill_lines` RLS pattern, the custom access-token hook shape, the append-only trigger, and the PowerSync Sync Streams / Client Auth (JWKS) setup against this same `cafe-production` Supabase project. This plan extends that proven pattern to the full schema; it does not redesign it.

## Global Constraints

- IDs: `uuid`, generated client-side as UUIDv7 for device-created rows (so offline creation needs no server round trip); `gen_random_uuid()` default for server-created rows (subscriptions, webhook events).
- Money: `bigint` paise everywhere, never `numeric`/`float`.
- Quantities: `numeric(12,3)` with a `unit text` column, never plain integer `qty`.
- Every shop-scoped row carries `shop_id uuid not null references shops(id)`; rows written by a device also carry `device_id`; rows attributable to a person also carry `staff_id`.
- Two conflict rules (spec section 5): **transactions** (append-only: insert-only, a `forbid_mutation`-style trigger blocks UPDATE/DELETE, uploads use `on conflict do nothing`) versus **config** (mutable: server wins per row via a `rev int not null default 1` column, owner/manager only write).
- RLS on every table, using `(select auth.jwt())` (not bare `auth.jwt()`) so Postgres caches it per statement — never a per-row subquery. Every new `public` table gets an explicit `grant` (Supabase stops auto-exposing new tables to the Data API from 30 Oct 2026).
- Every migration is a numbered/timestamped file under `supabase/migrations/`, applied with `supabase db push` from CI — never pasted into the dashboard.
- Target database for this plan: the real `cafe-production` Supabase project (ref `opkullzzbfizdjjqkbyl`), same project the spike ran against. There is no separate sandbox; every migration in this plan is a real, permanent schema change.
- Gate for the whole plan (spec section 16, Phase 1 row): **isolation and agreement tests pass** — i.e., Part C's test suite is green — before this phase is considered done.

---

## Part A: Tenancy & Identity Core

Builds `accounts`, `shops`, `devices`, `memberships`, `staff`, `settings`, `approvals`, the access-token hook, device enrolment, owner MFA, PIN policy, and migrations-as-code + CI. Everything in Part B depends on the `has_shop_access()` function and the RLS pattern this part establishes.

**Note on the spec:** section 5's "Config (mutable)" class names `staff` and `settings` as tables, and section 4 requires PIN-based staff login, but section 5's "Tables" bullet list omits both from the Platform group. This plan adds them here, in Part A, since staff identity and PIN policy cannot be built without them — flagged as a spec gap to fold into the spec's next revision.

### Task 1: Migrations-as-code scaffold and CI

**Files:**
- Modify: `supabase/migrations/0003_reserved.sql` (currently a placeholder; confirm it stays empty/reserved or remove it if unused — check content first)
- Create: `.github/workflows/db-migrations.yml`
- Create: `supabase/migrations/20260922090000_phase1_extensions.sql`

**Interfaces:**
- Consumes: existing `supabase/migrations/*.sql` numbering (0001-0005 legacy, `20260920182028_rate_limits.sql` timestamp-style going forward, established in Phase 0).
- Produces: a CI workflow that runs `supabase db push --dry-run` (lint) on every PR touching `supabase/migrations/**`, and `supabase db push` on merge to `main`; the `pgcrypto` extension confirmed enabled (needed for `gen_random_uuid()`, already used by the spike schema).

- [ ] **Step 1: Read the current `0003_reserved.sql`**

Check its contents; if it is genuinely an empty placeholder, leave it as-is (renumbering existing files is riskier than leaving a gap). Do not modify it further.

- [ ] **Step 2: Write the CI workflow** `.github/workflows/db-migrations.yml`

```yaml
name: Database migrations

on:
  pull_request:
    paths:
      - 'supabase/migrations/**'
  push:
    branches: [main]
    paths:
      - 'supabase/migrations/**'

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Link project
        run: supabase link --project-ref "$SUPABASE_PROJECT_REF"
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
      - name: Dry-run on PRs
        if: github.event_name == 'pull_request'
        run: supabase db push --dry-run
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      - name: Push on merge to main
        if: github.event_name == 'push'
        run: supabase db push
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

This requires `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` as GitHub repo secrets — flag this to the owner as a manual one-time setup step (Settings → Secrets → Actions), not something this plan's automation can do.

- [ ] **Step 3: Write the extensions migration** `supabase/migrations/20260922090000_phase1_extensions.sql`

```sql
-- Phase 1 foundation: confirm required extensions. pgcrypto already used by
-- the spike schema (gen_random_uuid()); pg_cron availability on the free
-- tier is recorded in the findings doc, not assumed here.
create extension if not exists pgcrypto;
```

- [ ] **Step 4: Apply it manually once (CI secrets not yet configured)**

```bash
cd "G:\DIGITAL_SERVICE\WEB\THECAFE\Repo-ThanjaiCafe-Billing-App\ThanjaiCafe-Billing-App"
```
Open the Supabase SQL Editor for `cafe-production` and run the migration's SQL directly (same manual-apply pattern used for the spike, since CI secrets require a one-time owner setup first). Confirm: `select extname from pg_extension where extname = 'pgcrypto';` returns one row.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/db-migrations.yml supabase/migrations/20260922090000_phase1_extensions.sql
git commit -m "chore: CI migration workflow and phase 1 extensions"
```

---

### Task 2: `accounts` and `shops`

**Files:**
- Create: `supabase/migrations/20260922090100_accounts_shops.sql`
- Test: `supabase/tests/isolation/accounts_shops.test.mjs`

**Interfaces:**
- Produces: `public.accounts(id, name, created_at)`, `public.shops(id, account_id, name, timezone, created_at)`.
- Consumes: nothing (root of the tenancy hierarchy).

- [ ] **Step 1: Write the migration**

```sql
create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.shops (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  name       text not null,
  timezone   text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);
create index shops_account_idx on public.shops (account_id);

alter table public.accounts enable row level security;
alter table public.shops    enable row level security;

-- Accounts and shops are managed by the owner/manager via membership rows
-- (Task 4 creates `memberships`). Until Task 4 lands there is no read
-- policy yet other than service_role; this migration only creates shape.
grant select, insert, update on public.accounts, public.shops to service_role;
```

- [ ] **Step 2: Apply and verify**

Run in the Supabase SQL Editor for `cafe-production`. Confirm: `select count(*) from public.shops;` returns `0` with no error (RLS enabled, no policies yet, service_role bypasses RLS so the SQL Editor — which runs as `postgres` — can still query it).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260922090100_accounts_shops.sql
git commit -m "feat(schema): accounts and shops"
```

(The isolation test for these two tables is written once `memberships` and `has_shop_access()` exist — Task 4 — since an account/shop has no meaningful RLS policy without a membership to check against. `supabase/tests/isolation/accounts_shops.test.mjs` is created in Task 4, not here.)

---

### Task 3: `devices`, the access-token hook, and device enrolment

**Files:**
- Create: `supabase/migrations/20260922090200_devices_and_hook.sql`
- Create: `supabase/functions/enrol-device/index.ts`
- Test: `supabase/tests/isolation/devices.test.mjs`

**Interfaces:**
- Consumes: `public.shops` (Task 2).
- Produces: `public.devices(id, shop_id, auth_user_id, code, role, revoked_at)`; `public.custom_access_token_hook(event jsonb) returns jsonb`, extending the spike's proven version to also carry `role: 'device'`; an `enrol-device` edge function callable only by an authenticated owner/manager (checked against `memberships`, added in Task 4 — so this function's authorization check is finished in Task 4, but the function shell and device-creation logic are written here).

- [ ] **Step 1: Write the migration** (extends the spike's proven `devices` + hook shape from `spike/sql/001_spike_schema.sql`, adding a `role` column and widening the device code pattern to match the spec's `{device}/{fy}/{seq}` invoice series, e.g. codes like `T1`, `T2`, `KOT1`)

```sql
create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  auth_user_id uuid not null unique,
  code         text not null check (code ~ '^[A-Z0-9]{1,4}$'),
  role         text not null default 'till' check (role in ('till', 'kitchen', 'display', 'backoffice')),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (shop_id, code)
);
create index devices_shop_idx on public.devices (shop_id);

alter table public.devices enable row level security;

create policy devices_read on public.devices for select to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);

grant select on public.devices to authenticated;
grant select, insert, update on public.devices to service_role;
grant usage on schema public to supabase_auth_admin;
grant select on table public.devices to supabase_auth_admin;
create policy devices_auth_admin_read on public.devices for select to supabase_auth_admin using (true);

-- Custom access-token hook: device sessions get shop_id/device_id/role.
-- Owner/manager sessions are left untouched here (Task 4's has_shop_access()
-- checks `memberships` directly at query time instead of via JWT claims, so
-- no owner-side claim injection is needed).
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event -> 'claims';
  d      record;
begin
  select id, shop_id, role into d
  from public.devices
  where auth_user_id = (event ->> 'user_id')::uuid and revoked_at is null;

  if found then
    claims := jsonb_set(claims, '{shop_id}',   to_jsonb(d.shop_id::text));
    claims := jsonb_set(claims, '{device_id}', to_jsonb(d.id::text));
    claims := jsonb_set(
      claims, '{app_metadata}',
      coalesce(claims -> 'app_metadata', '{}'::jsonb)
        || jsonb_build_object('shop_id', d.shop_id::text, 'device_id', d.id::text, 'role', 'device')
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
```

- [ ] **Step 2: Apply and re-point the hook in the Supabase dashboard**

Run the migration SQL in the SQL Editor. Then in **Authentication → Hooks**, confirm the "Customize Access Token (JWT) Claims" hook still points at `public.custom_access_token_hook` (it already does, from the spike; this migration replaces the function body with `create or replace`, so the hook binding itself does not need re-selecting).

- [ ] **Step 3: Write `enrol-device` edge function**

```typescript
// supabase/functions/enrol-device/index.ts
// Called by an authenticated owner/manager to create a new device identity.
// Authorization (membership check) is completed in Task 4; until then this
// function trusts any authenticated caller, which is why Task 4 must land
// before this function is deployed to a public URL (mirrors the Phase 0
// rule for publish-menu/backup-bills).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, resolveOrigin } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const origin = resolveOrigin(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });

  const authHeader = req.headers.get('Authorization') ?? '';
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await anon.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401, headers: corsHeaders(origin) });
  }

  const { shopId, code, role } = await req.json();
  if (!shopId || !/^[A-Z0-9]{1,4}$/.test(code) || !['till', 'kitchen', 'display', 'backoffice'].includes(role)) {
    return new Response(JSON.stringify({ error: 'invalid input' }), { status: 400, headers: corsHeaders(origin) });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const password = crypto.randomUUID() + crypto.randomUUID();
  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email: `device-${crypto.randomUUID()}@devices.internal`,
    password,
    email_confirm: true,
  });
  if (createErr) return new Response(JSON.stringify({ error: createErr.message }), { status: 500, headers: corsHeaders(origin) });

  const { data: device, error: devErr } = await admin.from('devices')
    .insert({ shop_id: shopId, auth_user_id: newUser.user.id, code, role })
    .select()
    .single();
  if (devErr) return new Response(JSON.stringify({ error: devErr.message }), { status: 500, headers: corsHeaders(origin) });

  // The enrolling owner scans/copies this pairing payload onto the device once;
  // it is never stored server-side beyond the auth user's own credential store.
  return new Response(JSON.stringify({ deviceId: device.id, email: newUser.user.email, password }), {
    status: 200,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 4: Write the isolation test** `supabase/tests/isolation/devices.test.mjs`

```js
// Run: SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... SPIKE_ANON_KEY=... node supabase/tests/isolation/devices.test.mjs
// Confirms a device only ever sees devices rows for its own shop.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
const anonKey = process.env.SPIKE_ANON_KEY;
if (!url || !serviceKey || !anonKey) { console.error('Set SPIKE_SUPABASE_URL, SPIKE_SERVICE_ROLE_KEY, SPIKE_ANON_KEY.'); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const { data: account } = await admin.from('accounts').insert({ name: 'Isolation Test Account' }).select().single();
const { data: shopA } = await admin.from('shops').insert({ account_id: account.id, name: 'Devices Test Shop A' }).select().single();
const { data: shopB } = await admin.from('shops').insert({ account_id: account.id, name: 'Devices Test Shop B' }).select().single();

async function makeDevice(shopId, code) {
  const email = `${code.toLowerCase()}-${crypto.randomUUID()}@isolation.test`;
  const password = crypto.randomUUID();
  const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const { data: device } = await admin.from('devices').insert({ shop_id: shopId, auth_user_id: user.user.id, code }).select().single();
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password });
  return { client, device };
}

const a1 = await makeDevice(shopA.id, 'D1');
const b1 = await makeDevice(shopB.id, 'D2');

const seenByA = await a1.client.from('devices').select('id');
check('device A sees only shop A devices', (seenByA.data ?? []).every((d) => d.id === a1.device.id));

const seenByB = await b1.client.from('devices').select('id');
check('device B sees only shop B devices', (seenByB.data ?? []).every((d) => d.id === b1.device.id));

await admin.from('devices').delete().in('id', [a1.device.id, b1.device.id]);
await admin.from('shops').delete().in('id', [shopA.id, shopB.id]);
await admin.from('accounts').delete().eq('id', account.id);
await admin.auth.admin.deleteUser(a1.device.auth_user_id);
await admin.auth.admin.deleteUser(b1.device.auth_user_id);

console.log(failures === 0 ? '\nAll devices isolation checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 5: Run it, expect PASS**

```bash
node supabase/tests/isolation/devices.test.mjs
```
Expected: both checks `PASS`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260922090200_devices_and_hook.sql supabase/functions/enrol-device/index.ts supabase/tests/isolation/devices.test.mjs
git commit -m "feat(schema): devices, access-token hook, enrol-device function"
```

---

### Task 4: `memberships` and `has_shop_access()`

**Files:**
- Create: `supabase/migrations/20260922090300_memberships.sql`
- Modify: `supabase/functions/enrol-device/index.ts:11-16` (finish the authorization check deferred in Task 3)
- Test: `supabase/tests/isolation/memberships.test.mjs`, `supabase/tests/isolation/accounts_shops.test.mjs` (deferred from Task 2)

**Interfaces:**
- Consumes: `public.shops` (Task 2).
- Produces: `public.memberships(id, user_id, shop_id, role, active)`; `public.has_shop_access(target_shop_id uuid) returns boolean` — **the single reusable RLS predicate every later table's policies call.**

- [ ] **Step 1: Write the migration**

```sql
create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id),
  shop_id    uuid not null references public.shops(id),
  role       text not null check (role in ('owner', 'manager')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, shop_id)
);
create index memberships_user_idx on public.memberships (user_id);
create index memberships_shop_idx on public.memberships (shop_id);

alter table public.memberships enable row level security;

create policy memberships_read_own on public.memberships for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.memberships to authenticated;
grant select, insert, update on public.memberships to service_role;

-- The single access predicate every later shop-scoped table's RLS policies
-- reuse: true for a device whose JWT carries this shop_id, or for a user
-- with an active membership on this shop.
create or replace function public.has_shop_access(target_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_shop_id = nullif((select auth.jwt()) ->> 'shop_id', '')::uuid
    or exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.shop_id = target_shop_id
        and m.active
    );
$$;

grant execute on function public.has_shop_access to authenticated;

-- Now that has_shop_access() exists, give accounts/shops real read policies.
create policy shops_read on public.shops for select to authenticated
  using (public.has_shop_access(id));
create policy accounts_read on public.accounts for select to authenticated
  using (exists (select 1 from public.shops s where s.account_id = accounts.id and public.has_shop_access(s.id)));
```

- [ ] **Step 2: Apply**

Run in the Supabase SQL Editor for `cafe-production`.

- [ ] **Step 3: Finish `enrol-device`'s authorization check**

In `supabase/functions/enrol-device/index.ts`, replace the comment-flagged trust-any-caller section (originally step 3 of Task 3, lines checking only `userErr`/`user`) with a membership check:

```typescript
  // (after the existing user-auth check, before reading the request body)
  const { data: membership } = await anon
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('shop_id', (await req.clone().json()).shopId)
    .eq('active', true)
    .maybeSingle();
  if (!membership || !['owner', 'manager'].includes(membership.role)) {
    return new Response(JSON.stringify({ error: 'not authorized for this shop' }), { status: 403, headers: corsHeaders(origin) });
  }
```

- [ ] **Step 4: Write the deferred `accounts_shops` isolation test** `supabase/tests/isolation/accounts_shops.test.mjs`

```js
// Run: SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... SPIKE_ANON_KEY=... node supabase/tests/isolation/accounts_shops.test.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
const anonKey = process.env.SPIKE_ANON_KEY;
if (!url || !serviceKey || !anonKey) { console.error('Set SPIKE_SUPABASE_URL, SPIKE_SERVICE_ROLE_KEY, SPIKE_ANON_KEY.'); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const { data: account } = await admin.from('accounts').insert({ name: 'AS Isolation Account' }).select().single();
const { data: shopA } = await admin.from('shops').insert({ account_id: account.id, name: 'AS Shop A' }).select().single();
const { data: shopB } = await admin.from('shops').insert({ account_id: account.id, name: 'AS Shop B' }).select().single();

const email = `owner-${crypto.randomUUID()}@isolation.test`;
const password = crypto.randomUUID();
const { data: owner } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
await admin.from('memberships').insert({ user_id: owner.user.id, shop_id: shopA.id, role: 'owner' });

const client = createClient(url, anonKey, { auth: { persistSession: false } });
await client.auth.signInWithPassword({ email, password });

const seenShops = await client.from('shops').select('id');
check('owner sees only the shop they have a membership on', (seenShops.data ?? []).length === 1 && seenShops.data[0].id === shopA.id);

const seenAccounts = await client.from('accounts').select('id');
check('owner sees the account owning their shop', (seenAccounts.data ?? []).some((a) => a.id === account.id));

await admin.from('memberships').delete().eq('user_id', owner.user.id);
await admin.from('shops').delete().in('id', [shopA.id, shopB.id]);
await admin.from('accounts').delete().eq('id', account.id);
await admin.auth.admin.deleteUser(owner.user.id);

console.log(failures === 0 ? '\nAll accounts/shops isolation checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 5: Write `memberships.test.mjs`** (cross-account membership must never leak)

```js
// Run: SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... SPIKE_ANON_KEY=... node supabase/tests/isolation/memberships.test.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
const anonKey = process.env.SPIKE_ANON_KEY;
if (!url || !serviceKey || !anonKey) { console.error('Set SPIKE_SUPABASE_URL, SPIKE_SERVICE_ROLE_KEY, SPIKE_ANON_KEY.'); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const { data: account } = await admin.from('accounts').insert({ name: 'Membership Isolation Account' }).select().single();
const { data: shopA } = await admin.from('shops').insert({ account_id: account.id, name: 'Membership Shop A' }).select().single();
const { data: shopB } = await admin.from('shops').insert({ account_id: account.id, name: 'Membership Shop B' }).select().single();

async function makeOwner(shopId) {
  const email = `owner-${crypto.randomUUID()}@isolation.test`;
  const password = crypto.randomUUID();
  const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  await admin.from('memberships').insert({ user_id: user.user.id, shop_id: shopId, role: 'owner' });
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password });
  return { client, userId: user.user.id };
}

const ownerA = await makeOwner(shopA.id);
const ownerB = await makeOwner(shopB.id);

const seenByA = await ownerA.client.from('memberships').select('user_id');
check('owner A sees only their own membership row', (seenByA.data ?? []).every((m) => m.user_id === ownerA.userId));

const seenByB = await ownerB.client.from('memberships').select('user_id');
check('owner B sees only their own membership row', (seenByB.data ?? []).every((m) => m.user_id === ownerB.userId));

await admin.from('memberships').delete().in('user_id', [ownerA.userId, ownerB.userId]);
await admin.from('shops').delete().in('id', [shopA.id, shopB.id]);
await admin.from('accounts').delete().eq('id', account.id);
await admin.auth.admin.deleteUser(ownerA.userId);
await admin.auth.admin.deleteUser(ownerB.userId);

console.log(failures === 0 ? '\nAll memberships isolation checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 6: Run both tests, expect PASS**

```bash
node supabase/tests/isolation/accounts_shops.test.mjs
node supabase/tests/isolation/memberships.test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260922090300_memberships.sql supabase/functions/enrol-device/index.ts supabase/tests/isolation/memberships.test.mjs supabase/tests/isolation/accounts_shops.test.mjs
git commit -m "feat(schema): memberships and has_shop_access(), finish enrol-device authorization"
```

---

### Task 5: `staff` and PIN policy

**Files:**
- Create: `supabase/migrations/20260922090400_staff.sql`
- Create: `src/features/staff/pinHash.ts`
- Test: `src/features/staff/__tests__/pinHash.test.ts`, `supabase/tests/isolation/staff.test.mjs`

**Interfaces:**
- Consumes: `public.shops`, `public.has_shop_access()` (Task 4).
- Produces: `public.staff(id, shop_id, name, pin_hash, pin_salt, role, active, rev)`; `hashPin(pin: string, salt: Uint8Array): Promise<string>`, `verifyPin(pin: string, salt: Uint8Array, hash: string): Promise<boolean>`, `generateSalt(): Uint8Array` (client-side, PBKDF2 via Web Crypto — offline-verifiable, matching spec section 4's "salted slow hash... verified locally so login works offline").

- [ ] **Step 1: Write the migration**

```sql
create table public.staff (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id),
  name       text not null,
  pin_hash   text not null,
  pin_salt   text not null,
  role       text not null check (role in ('cashier', 'kitchen')),
  active     boolean not null default true,
  rev        int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_shop_idx on public.staff (shop_id);

alter table public.staff enable row level security;

create policy staff_read on public.staff for select to authenticated
  using (public.has_shop_access(shop_id));
create policy staff_write on public.staff for insert to authenticated
  with check (public.has_shop_access(shop_id));
create policy staff_update on public.staff for update to authenticated
  using (public.has_shop_access(shop_id))
  with check (public.has_shop_access(shop_id));

grant select, insert, update on public.staff to authenticated;
```

- [ ] **Step 2: Apply**

Run in the Supabase SQL Editor.

- [ ] **Step 3: Write the failing test** `src/features/staff/__tests__/pinHash.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { generateSalt, hashPin, verifyPin } from '../pinHash';

describe('pinHash', () => {
  it('verifies a correct PIN against its own hash', async () => {
    const salt = generateSalt();
    const hash = await hashPin('4821', salt);
    expect(await verifyPin('4821', salt, hash)).toBe(true);
  });

  it('rejects a wrong PIN', async () => {
    const salt = generateSalt();
    const hash = await hashPin('4821', salt);
    expect(await verifyPin('0000', salt, hash)).toBe(false);
  });

  it('produces different hashes for the same PIN with different salts', async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const h1 = await hashPin('4821', salt1);
    const h2 = await hashPin('4821', salt2);
    expect(h1).not.toBe(h2);
  });
});
```

- [ ] **Step 4: Run it, verify it fails**

```bash
npx vitest run src/features/staff/__tests__/pinHash.test.ts
```
Expected: FAIL, cannot resolve `../pinHash`.

- [ ] **Step 5: Implement** `src/features/staff/pinHash.ts`

```ts
const ITERATIONS = 210_000; // OWASP 2023 minimum for PBKDF2-SHA256

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  return derive(pin, salt);
}

export async function verifyPin(pin: string, salt: Uint8Array, hash: string): Promise<boolean> {
  const candidate = await derive(pin, salt);
  // Constant-time-ish comparison; both strings are fixed-length base64 of a 256-bit digest.
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 6: Run it, verify it passes**

```bash
npx vitest run src/features/staff/__tests__/pinHash.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 7: Write the isolation test** `supabase/tests/isolation/staff.test.mjs` (device of shop A must not read/write shop B's staff)

```js
// Run: SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... SPIKE_ANON_KEY=... node supabase/tests/isolation/staff.test.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
const anonKey = process.env.SPIKE_ANON_KEY;
if (!url || !serviceKey || !anonKey) { console.error('Set SPIKE_SUPABASE_URL, SPIKE_SERVICE_ROLE_KEY, SPIKE_ANON_KEY.'); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const { data: account } = await admin.from('accounts').insert({ name: 'Staff Isolation Account' }).select().single();
const { data: shopA } = await admin.from('shops').insert({ account_id: account.id, name: 'Staff Shop A' }).select().single();
const { data: shopB } = await admin.from('shops').insert({ account_id: account.id, name: 'Staff Shop B' }).select().single();
await admin.from('staff').insert([
  { shop_id: shopA.id, name: 'Cashier A', pin_hash: 'x', pin_salt: 'y', role: 'cashier' },
  { shop_id: shopB.id, name: 'Cashier B', pin_hash: 'x', pin_salt: 'y', role: 'cashier' },
]);

async function makeDevice(shopId, code) {
  const email = `${code.toLowerCase()}-${crypto.randomUUID()}@isolation.test`;
  const password = crypto.randomUUID();
  const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  await admin.from('devices').insert({ shop_id: shopId, auth_user_id: user.user.id, code });
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password });
  return { client, userId: user.user.id };
}

const devA = await makeDevice(shopA.id, 'SA1');

const seen = await devA.client.from('staff').select('shop_id, name');
check('device A sees only shop A staff', (seen.data ?? []).length === 1 && seen.data[0].shop_id === shopA.id);

const forged = await devA.client.from('staff').insert({ shop_id: shopB.id, name: 'Forged', pin_hash: 'x', pin_salt: 'y', role: 'cashier' });
check('device A cannot insert staff for shop B', forged.error?.code === '42501', forged.error?.code);

await admin.from('staff').delete().in('shop_id', [shopA.id, shopB.id]);
await admin.from('devices').delete().eq('auth_user_id', devA.userId);
await admin.from('shops').delete().in('id', [shopA.id, shopB.id]);
await admin.from('accounts').delete().eq('id', account.id);
await admin.auth.admin.deleteUser(devA.userId);

console.log(failures === 0 ? '\nAll staff isolation checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 8: Run it, expect PASS**

```bash
node supabase/tests/isolation/staff.test.mjs
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260922090400_staff.sql src/features/staff/pinHash.ts src/features/staff/__tests__/pinHash.test.ts supabase/tests/isolation/staff.test.mjs
git commit -m "feat(schema): staff table and offline-verifiable PIN hashing"
```

---

### Task 6: `settings`

**Files:**
- Create: `supabase/migrations/20260922090500_settings.sql`
- Test: `supabase/tests/isolation/settings.test.mjs`

**Interfaces:**
- Consumes: `public.shops`, `public.has_shop_access()` (Task 4).
- Produces: `public.settings(shop_id primary key, day_cutover_hour, receipt_language, timezone_override, rev, ...)` — one row per shop, config class.

- [ ] **Step 1: Write the migration**

```sql
create table public.settings (
  shop_id           uuid primary key references public.shops(id),
  day_cutover_hour  int not null default 0 check (day_cutover_hour between 0 and 23),
  receipt_language  text not null default 'en' check (receipt_language in ('en', 'ta')),
  rev               int not null default 1,
  updated_at        timestamptz not null default now()
);

alter table public.settings enable row level security;

create policy settings_read on public.settings for select to authenticated
  using (public.has_shop_access(shop_id));
create policy settings_write on public.settings for insert to authenticated
  with check (public.has_shop_access(shop_id));
create policy settings_update on public.settings for update to authenticated
  using (public.has_shop_access(shop_id))
  with check (public.has_shop_access(shop_id));

grant select, insert, update on public.settings to authenticated;
```

- [ ] **Step 2: Apply**

Run in the Supabase SQL Editor.

- [ ] **Step 3: Write the isolation test** `supabase/tests/isolation/settings.test.mjs` (same shape as Task 5 Step 7 — device of shop A cannot read/write shop B's settings row)

```js
// Run: SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... SPIKE_ANON_KEY=... node supabase/tests/isolation/settings.test.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
const anonKey = process.env.SPIKE_ANON_KEY;
if (!url || !serviceKey || !anonKey) { console.error('Set SPIKE_SUPABASE_URL, SPIKE_SERVICE_ROLE_KEY, SPIKE_ANON_KEY.'); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const { data: account } = await admin.from('accounts').insert({ name: 'Settings Isolation Account' }).select().single();
const { data: shopA } = await admin.from('shops').insert({ account_id: account.id, name: 'Settings Shop A' }).select().single();
const { data: shopB } = await admin.from('shops').insert({ account_id: account.id, name: 'Settings Shop B' }).select().single();
await admin.from('settings').insert([{ shop_id: shopA.id }, { shop_id: shopB.id }]);

const email = `dev-${crypto.randomUUID()}@isolation.test`;
const password = crypto.randomUUID();
const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
await admin.from('devices').insert({ shop_id: shopA.id, auth_user_id: user.user.id, code: 'SE1' });
const client = createClient(url, anonKey, { auth: { persistSession: false } });
await client.auth.signInWithPassword({ email, password });

const seen = await client.from('settings').select('shop_id');
check('device sees only its own shop settings row', (seen.data ?? []).length === 1 && seen.data[0].shop_id === shopA.id);

const forged = await client.from('settings').update({ receipt_language: 'ta' }).eq('shop_id', shopB.id);
const stillDefault = await admin.from('settings').select('receipt_language').eq('shop_id', shopB.id).single();
check('device cannot update another shop\'s settings', stillDefault.data.receipt_language === 'en');

await admin.from('settings').delete().in('shop_id', [shopA.id, shopB.id]);
await admin.from('devices').delete().eq('auth_user_id', user.user.id);
await admin.from('shops').delete().in('id', [shopA.id, shopB.id]);
await admin.from('accounts').delete().eq('id', account.id);
await admin.auth.admin.deleteUser(user.user.id);

console.log(failures === 0 ? '\nAll settings isolation checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 4: Run it, expect PASS**

```bash
node supabase/tests/isolation/settings.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260922090500_settings.sql supabase/tests/isolation/settings.test.mjs
git commit -m "feat(schema): settings table"
```

---

### Task 7: Owner MFA (TOTP)

**Files:**
- Create: `src/features/auth/mfaGate.ts`
- Test: `src/features/auth/__tests__/mfaGate.test.ts`

**Interfaces:**
- Consumes: Supabase Auth's built-in MFA (`supabase.auth.mfa.*`) — no new table needed, Supabase manages TOTP factors itself.
- Produces: `requiresRecentMfa(action: SensitiveAction): boolean`, `SENSITIVE_ACTIONS` (the exact list from spec section 4.1: enrol/revoke device, change plan, export all data), `assertRecentMfa(supabase: SupabaseClient, maxAgeMinutes?: number): Promise<void>` (throws if the current session's AAL is not `aal2` or the AAL2 verification is older than `maxAgeMinutes`).

- [ ] **Step 1: Write the failing test** `src/features/auth/__tests__/mfaGate.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { assertRecentMfa, requiresRecentMfa, SENSITIVE_ACTIONS } from '../mfaGate';

describe('SENSITIVE_ACTIONS', () => {
  it('lists exactly the spec 4.1 actions', () => {
    expect(SENSITIVE_ACTIONS).toEqual(['enrol_device', 'revoke_device', 'change_plan', 'export_all_data']);
  });
});

describe('requiresRecentMfa', () => {
  it('is true for a listed action, false otherwise', () => {
    expect(requiresRecentMfa('enrol_device')).toBe(true);
    expect(requiresRecentMfa('create_bill' as never)).toBe(false);
  });
});

describe('assertRecentMfa', () => {
  it('throws when the session AAL is aal1', async () => {
    const supabase = { auth: { mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null }) } } };
    await expect(assertRecentMfa(supabase as never)).rejects.toThrow(/MFA/);
  });

  it('resolves when the session AAL is aal2', async () => {
    const supabase = { auth: { mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }) } } };
    await expect(assertRecentMfa(supabase as never)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
npx vitest run src/features/auth/__tests__/mfaGate.test.ts
```
Expected: FAIL, cannot resolve `../mfaGate`.

- [ ] **Step 3: Implement** `src/features/auth/mfaGate.ts`

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export const SENSITIVE_ACTIONS = ['enrol_device', 'revoke_device', 'change_plan', 'export_all_data'] as const;
export type SensitiveAction = (typeof SENSITIVE_ACTIONS)[number];

export function requiresRecentMfa(action: string): action is SensitiveAction {
  return (SENSITIVE_ACTIONS as readonly string[]).includes(action);
}

/** Throws if the current session has not completed AAL2 (TOTP) verification.
    Supabase's own AAL tracking is session-scoped, not time-scoped, so "recent"
    here means "this session ever completed AAL2" — a fresh re-verification
    prompt on each sensitive action is a UI decision, not enforced here. */
export async function assertRecentMfa(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (data.currentLevel !== 'aal2') {
    throw new Error('This action requires MFA verification. Please complete your authenticator check.');
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

```bash
npx vitest run src/features/auth/__tests__/mfaGate.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire it into `enrol-device`'s caller** (client-side, not the edge function — the edge function trusts the caller's JWT `aal` claim is not directly available server-side without an extra Supabase Auth API call, so the gate is enforced client-side before the request is made, consistent with spec 4.1's "changing plans... require a recent MFA check" being a UX gate; server-side defense-in-depth for this is deferred to Phase 4's admin console, where `SENSITIVE_ACTIONS` is reused)

No code change in this task — this step documents the decision so a later task does not re-derive it. `assertRecentMfa` is called from the (not-yet-built) device-enrolment UI in Phase 2/3; this task only builds and tests the gate function itself, since Phase 1 has no UI layer yet.

- [ ] **Step 6: Commit**

```bash
git add src/features/auth/mfaGate.ts src/features/auth/__tests__/mfaGate.test.ts
git commit -m "feat(auth): owner MFA gate for sensitive actions"
```

---

### Task 8: `approvals` and approval tokens

**Files:**
- Create: `supabase/migrations/20260922090600_approvals.sql`
- Create: `src/features/approvals/approvalToken.ts`
- Test: `src/features/approvals/__tests__/approvalToken.test.ts`, `supabase/tests/isolation/approvals.test.mjs`

**Interfaces:**
- Consumes: `public.shops`, `public.staff`, `public.has_shop_access()`.
- Produces: `public.approvals(id, shop_id, action, target_id, manager_staff_id, expires_at, nonce, signature, consumed_at)`; `signApproval(privateKey: CryptoKey, payload: ApprovalPayload): Promise<string>`, `verifyApproval(publicKey: CryptoKey, payload: ApprovalPayload, signature: string): Promise<boolean>` — ECDSA P-256 via Web Crypto (asymmetric so the counter device only ever holds managers' *public* keys, per spec 4.1: "the counter device verifies it against the managers' public keys, which are the only manager material it holds").

- [ ] **Step 1: Write the migration**

```sql
create table public.approvals (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops(id),
  action            text not null check (action in ('refund', 'void_after_kot', 'discount_override', 'price_override', 'no_sale_open')),
  target_id         uuid not null,
  manager_staff_id  uuid not null references public.staff(id),
  nonce             text not null,
  signature         text not null,
  expires_at        timestamptz not null,
  consumed_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (shop_id, nonce)
);
create index approvals_shop_idx on public.approvals (shop_id);

alter table public.approvals enable row level security;

create policy approvals_read on public.approvals for select to authenticated
  using (public.has_shop_access(shop_id));
create policy approvals_insert on public.approvals for insert to authenticated
  with check (public.has_shop_access(shop_id));
-- Approvals are append-only except for consuming them exactly once; a
-- narrow update policy allows only setting consumed_at from null.
create policy approvals_consume on public.approvals for update to authenticated
  using (public.has_shop_access(shop_id) and consumed_at is null)
  with check (public.has_shop_access(shop_id));

grant select, insert, update on public.approvals to authenticated;
```

- [ ] **Step 2: Apply**

Run in the Supabase SQL Editor.

- [ ] **Step 3: Write the failing test** `src/features/approvals/__tests__/approvalToken.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { generateManagerKeyPair, signApproval, verifyApproval } from '../approvalToken';

describe('approval token signing', () => {
  it('verifies a signature made with the matching private key', async () => {
    const { privateKey, publicKey } = await generateManagerKeyPair();
    const payload = { action: 'refund' as const, targetId: 'bill-123', shopId: 'shop-1', nonce: 'abc', expiresAt: Date.now() + 120_000 };
    const signature = await signApproval(privateKey, payload);
    expect(await verifyApproval(publicKey, payload, signature)).toBe(true);
  });

  it('rejects a signature after tampering with the payload', async () => {
    const { privateKey, publicKey } = await generateManagerKeyPair();
    const payload = { action: 'refund' as const, targetId: 'bill-123', shopId: 'shop-1', nonce: 'abc', expiresAt: Date.now() + 120_000 };
    const signature = await signApproval(privateKey, payload);
    const tampered = { ...payload, targetId: 'bill-999' };
    expect(await verifyApproval(publicKey, tampered, signature)).toBe(false);
  });

  it('rejects a signature from the wrong key pair', async () => {
    const pair1 = await generateManagerKeyPair();
    const pair2 = await generateManagerKeyPair();
    const payload = { action: 'refund' as const, targetId: 'bill-123', shopId: 'shop-1', nonce: 'abc', expiresAt: Date.now() + 120_000 };
    const signature = await signApproval(pair1.privateKey, payload);
    expect(await verifyApproval(pair2.publicKey, payload, signature)).toBe(false);
  });
});
```

- [ ] **Step 4: Run it, verify it fails**

```bash
npx vitest run src/features/approvals/__tests__/approvalToken.test.ts
```
Expected: FAIL, cannot resolve `../approvalToken`.

- [ ] **Step 5: Implement** `src/features/approvals/approvalToken.ts`

```ts
export interface ApprovalPayload {
  action: 'refund' | 'void_after_kot' | 'discount_override' | 'price_override' | 'no_sale_open';
  targetId: string;
  shopId: string;
  nonce: string;
  expiresAt: number;
}

/** One key pair per manager, generated once on that manager's own device and
    never leaving it; the public key is what counter devices are given. */
export async function generateManagerKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
}

function payloadBytes(payload: ApprovalPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

export async function signApproval(privateKey: CryptoKey, payload: ApprovalPayload): Promise<string> {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, payloadBytes(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifyApproval(publicKey: CryptoKey, payload: ApprovalPayload, signature: string): Promise<boolean> {
  if (payload.expiresAt < Date.now()) return false;
  const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, sigBytes, payloadBytes(payload));
}
```

- [ ] **Step 6: Run it, verify it passes**

```bash
npx vitest run src/features/approvals/__tests__/approvalToken.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 7: Write the isolation test** `supabase/tests/isolation/approvals.test.mjs` (same shop-scoping shape as prior isolation tests — omitted here for length; follow the exact pattern from Task 6 Step 3, substituting `approvals` rows with `{ shop_id, action: 'refund', target_id: crypto.randomUUID(), manager_staff_id, nonce: crypto.randomUUID(), signature: 'x', expires_at: new Date(Date.now() + 120_000).toISOString() }`, and adding a `manager_staff_id` created via a `staff` insert first)

- [ ] **Step 8: Run it, expect PASS**

```bash
node supabase/tests/isolation/approvals.test.mjs
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260922090600_approvals.sql src/features/approvals/approvalToken.ts src/features/approvals/__tests__/approvalToken.test.ts supabase/tests/isolation/approvals.test.mjs
git commit -m "feat: approvals table and ECDSA approval-token signing"
```

---

## Part B: Full Schema For Every Module

Schema, RLS and grants only — **no business logic, no UI, no edge functions** beyond what already exists. Every table uses `public.has_shop_access(shop_id)` (Part A, Task 4) for its RLS policies. Config-class tables (mutable, `rev` column, owner/manager write) get select/insert/update policies; transaction-class tables (append-only) get select/insert-only policies plus the `forbid_mutation()` trigger (created once, in Task 11). Isolation tests for all of Part B are written together in Part C (Task 20), as one data-driven suite, rather than one bespoke script per table group — see Part C's rationale.

Each task in this part follows the same three steps: write the migration, apply it, commit. Per-step narrative is kept short from here on since the pattern is already established and tested in Part A; every column still follows the Global Constraints exactly (no placeholders).

### Task 9: Platform — `plans`, `subscriptions`, `entitlements`, `webhook_events`, `payment_events`

**Files:** Create: `supabase/migrations/20260923090000_platform.sql`

**Interfaces:** Consumes: `public.shops`, `public.has_shop_access()`. Produces: the five tables spec section 6 describes (plan definitions, per-shop subscription state, derived entitlements, idempotent webhook log, gateway payment log).

- [ ] **Step 1: Write the migration**

```sql
create table public.plans (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  name                 text not null,
  device_limit         int not null,
  staff_limit          int not null,
  qr_ordering          boolean not null default false,
  history_window_days  int not null default 90,
  price_paise          bigint not null,
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);
alter table public.plans enable row level security;
create policy plans_read on public.plans for select to authenticated using (true);
grant select on public.plans to authenticated;
grant select, insert, update on public.plans to service_role;

create table public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  shop_id                   uuid not null references public.shops(id),
  plan_id                   uuid not null references public.plans(id),
  razorpay_subscription_id  text unique,
  status                    text not null default 'trialing' check (status in ('trialing','active','past_due','suspended','cancelled')),
  current_period_end        timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index subscriptions_shop_idx on public.subscriptions (shop_id);
alter table public.subscriptions enable row level security;
create policy subscriptions_read on public.subscriptions for select to authenticated using (public.has_shop_access(shop_id));
grant select on public.subscriptions to authenticated;
grant select, insert, update on public.subscriptions to service_role;

create table public.entitlements (
  shop_id              uuid primary key references public.shops(id),
  device_limit         int not null,
  staff_limit          int not null,
  qr_ordering          boolean not null default false,
  history_window_days  int not null default 90,
  updated_at           timestamptz not null default now()
);
alter table public.entitlements enable row level security;
create policy entitlements_read on public.entitlements for select to authenticated using (public.has_shop_access(shop_id));
grant select on public.entitlements to authenticated;
grant select, insert, update on public.entitlements to service_role;

create table public.webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null default 'razorpay',
  event_id      text not null,
  event_type    text not null,
  payload       jsonb not null,
  processed_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (provider, event_id)
);
alter table public.webhook_events enable row level security;
grant select, insert, update on public.webhook_events to service_role;

create table public.payment_events (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid references public.shops(id),
  gateway_payment_id  text not null unique,
  amount_paise        bigint not null,
  status              text not null,
  raw_payload         jsonb not null,
  created_at          timestamptz not null default now()
);
create index payment_events_shop_idx on public.payment_events (shop_id);
alter table public.payment_events enable row level security;
create policy payment_events_read on public.payment_events for select to authenticated using (shop_id is not null and public.has_shop_access(shop_id));
grant select on public.payment_events to authenticated;
grant select, insert, update on public.payment_events to service_role;
```

- [ ] **Step 2: Apply** in the Supabase SQL Editor for `cafe-production`; confirm `select count(*) from public.plans;` returns `0` with no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923090000_platform.sql
git commit -m "feat(schema): plans, subscriptions, entitlements, webhook and payment events"
```

---

### Task 10: Catalog — `categories`, `products`, `product_costs`, `menu_publications`, `product_variants`, `modifier_groups`, `modifiers`

**Files:** Create: `supabase/migrations/20260923090100_catalog.sql`

**Interfaces:** Consumes: `public.shops`, `public.has_shop_access()`. Produces: the seven catalog tables (spec section 5's Catalog group, section 9.5's variants/modifiers).

- [ ] **Step 1: Write the migration**

```sql
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  name        text not null,
  sort_order  int not null default 0,
  rev         int not null default 1,
  deleted_at  timestamptz
);
create index categories_shop_idx on public.categories (shop_id);

create table public.products (
  id           uuid primary key,
  shop_id      uuid not null references public.shops(id),
  category_id  uuid references public.categories(id),
  name         text not null,
  unit         text not null default 'pcs',
  price_paise  bigint not null check (price_paise >= 0),
  hsn_sac      text,
  tax_class    text,
  rev          int not null default 1,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index products_shop_idx on public.products (shop_id);

create table public.product_costs (
  product_id  uuid primary key references public.products(id),
  shop_id     uuid not null references public.shops(id),
  cost_paise  bigint not null check (cost_paise >= 0),
  rev         int not null default 1,
  updated_at  timestamptz not null default now()
);
create index product_costs_shop_idx on public.product_costs (shop_id);

create table public.menu_publications (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id),
  published_at  timestamptz not null default now(),
  snapshot      jsonb not null
);
create index menu_publications_shop_idx on public.menu_publications (shop_id);

create table public.product_variants (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops(id),
  product_id         uuid not null references public.products(id),
  name               text not null,
  price_delta_paise  bigint not null default 0,
  rev                int not null default 1
);
create index product_variants_shop_idx on public.product_variants (shop_id);

create table public.modifier_groups (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  product_id  uuid not null references public.products(id),
  name        text not null,
  min_select  int not null default 0,
  max_select  int not null default 1,
  rev         int not null default 1
);
create index modifier_groups_shop_idx on public.modifier_groups (shop_id);

create table public.modifiers (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops(id),
  group_id           uuid not null references public.modifier_groups(id),
  name               text not null,
  price_delta_paise  bigint not null default 0,
  rev                int not null default 1
);
create index modifiers_shop_idx on public.modifiers (shop_id);

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_costs enable row level security;
alter table public.menu_publications enable row level security;
alter table public.product_variants enable row level security;
alter table public.modifier_groups enable row level security;
alter table public.modifiers enable row level security;

create policy categories_read on public.categories for select to authenticated using (public.has_shop_access(shop_id));
create policy categories_write on public.categories for insert to authenticated with check (public.has_shop_access(shop_id));
create policy categories_update on public.categories for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy products_read on public.products for select to authenticated using (public.has_shop_access(shop_id));
create policy products_write on public.products for insert to authenticated with check (public.has_shop_access(shop_id));
create policy products_update on public.products for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy product_costs_read on public.product_costs for select to authenticated using (public.has_shop_access(shop_id));
create policy product_costs_write on public.product_costs for insert to authenticated with check (public.has_shop_access(shop_id));
create policy product_costs_update on public.product_costs for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy menu_publications_read on public.menu_publications for select to authenticated using (public.has_shop_access(shop_id));
create policy menu_publications_write on public.menu_publications for insert to authenticated with check (public.has_shop_access(shop_id));

create policy product_variants_read on public.product_variants for select to authenticated using (public.has_shop_access(shop_id));
create policy product_variants_write on public.product_variants for insert to authenticated with check (public.has_shop_access(shop_id));
create policy product_variants_update on public.product_variants for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy modifier_groups_read on public.modifier_groups for select to authenticated using (public.has_shop_access(shop_id));
create policy modifier_groups_write on public.modifier_groups for insert to authenticated with check (public.has_shop_access(shop_id));
create policy modifier_groups_update on public.modifier_groups for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy modifiers_read on public.modifiers for select to authenticated using (public.has_shop_access(shop_id));
create policy modifiers_write on public.modifiers for insert to authenticated with check (public.has_shop_access(shop_id));
create policy modifiers_update on public.modifiers for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

grant select, insert, update on public.categories, public.products, public.product_costs, public.menu_publications, public.product_variants, public.modifier_groups, public.modifiers to authenticated;
```

- [ ] **Step 2: Apply** and confirm `select count(*) from public.products;` returns `0` with no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923090100_catalog.sql
git commit -m "feat(schema): catalog (categories, products, costs, variants, modifiers)"
```

---

### Task 11: Sales core — `bills`, `bill_lines`, `bill_payments`, `bill_events`, `day_closes`, `invoice_series`

**Files:** Create: `supabase/migrations/20260923090200_sales_core.sql`

**Interfaces:** Consumes: `public.shops`, `public.devices`, `public.staff`, `public.approvals`, `public.has_shop_access()`. Produces: `public.forbid_mutation()` (the append-only guard, created once here and reused by every later transaction-class table), plus the six sales tables extending the spike's proven `bills`/`bill_lines` shape with `staff_id`, `source`, `tax_paise`, `bill_payments`, `bill_events`, `day_closes`, and a server-tracked `invoice_series`.

- [ ] **Step 1: Write the migration**

```sql
-- The append-only guard every transaction-class table in this plan reuses,
-- proven in the PowerSync spike (see the findings doc).
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'append-only table: % cannot be edited', tg_table_name using errcode = '42501';
end $$;

create table public.invoice_series (
  shop_id    uuid not null references public.shops(id),
  device_id  uuid not null references public.devices(id),
  fy         text not null,
  last_seq   int not null default 0,
  primary key (shop_id, device_id, fy)
);

create table public.bills (
  id             uuid primary key,
  shop_id        uuid not null references public.shops(id),
  device_id      uuid not null references public.devices(id),
  staff_id       uuid references public.staff(id),
  invoice_no     text not null,
  fy             text not null,
  seq            int  not null,
  source         text not null default 'till' check (source in ('till', 'qr')),
  business_date  date not null,
  payment_method text not null,
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise      bigint not null default 0 check (tax_paise >= 0),
  total_paise    bigint not null check (total_paise >= 0),
  created_at     timestamptz not null,
  received_at    timestamptz not null default now(),
  unique (shop_id, device_id, fy, seq)
);
create index bills_shop_created_idx on public.bills (shop_id, created_at desc);
create index bills_shop_date_idx on public.bills (shop_id, business_date);

create table public.bill_lines (
  id                uuid primary key,
  bill_id           uuid not null references public.bills(id),
  shop_id           uuid not null references public.shops(id),
  product_id        uuid not null,
  name              text not null,
  qty               numeric(12,3) not null check (qty > 0),
  unit              text not null,
  unit_price_paise  bigint not null check (unit_price_paise >= 0),
  tax_rule_snapshot jsonb,
  line_total_paise  bigint not null check (line_total_paise >= 0)
);
create index bill_lines_bill_idx on public.bill_lines (bill_id);
create index bill_lines_shop_idx on public.bill_lines (shop_id);

create table public.bill_payments (
  id                  uuid primary key default gen_random_uuid(),
  bill_id             uuid not null references public.bills(id),
  shop_id             uuid not null references public.shops(id),
  method              text not null check (method in ('cash','upi','card','credit')),
  verification        text not null default 'manual' check (verification in ('verified','manual','offline_unverified')),
  gateway_payment_id  text,
  amount_paise        bigint not null check (amount_paise > 0),
  created_at          timestamptz not null default now()
);
create index bill_payments_bill_idx on public.bill_payments (bill_id);
create index bill_payments_shop_idx on public.bill_payments (shop_id);

create table public.bill_events (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references public.bills(id),
  shop_id       uuid not null references public.shops(id),
  type          text not null check (type in ('void','refund','partial_refund')),
  amount_paise  bigint,
  reason        text,
  staff_id      uuid references public.staff(id),
  approval_id   uuid references public.approvals(id),
  created_at    timestamptz not null default now()
);
create index bill_events_bill_idx on public.bill_events (bill_id);
create index bill_events_shop_idx on public.bill_events (shop_id);

create table public.day_closes (
  id                    uuid primary key default gen_random_uuid(),
  shop_id               uuid not null references public.shops(id),
  device_id             uuid not null references public.devices(id),
  business_date         date not null,
  opening_float_paise   bigint not null default 0,
  closing_count_paise   bigint,
  closed_by_staff_id    uuid references public.staff(id),
  closed_at             timestamptz not null default now(),
  unique (shop_id, device_id, business_date)
);
create index day_closes_shop_idx on public.day_closes (shop_id);

create trigger bills_append_only before update or delete on public.bills
  for each row execute function public.forbid_mutation();
create trigger bill_lines_append_only before update or delete on public.bill_lines
  for each row execute function public.forbid_mutation();
create trigger bill_payments_append_only before update or delete on public.bill_payments
  for each row execute function public.forbid_mutation();
create trigger bill_events_append_only before update or delete on public.bill_events
  for each row execute function public.forbid_mutation();
create trigger day_closes_append_only before update or delete on public.day_closes
  for each row execute function public.forbid_mutation();

alter table public.invoice_series enable row level security;
alter table public.bills enable row level security;
alter table public.bill_lines enable row level security;
alter table public.bill_payments enable row level security;
alter table public.bill_events enable row level security;
alter table public.day_closes enable row level security;

create policy invoice_series_read on public.invoice_series for select to authenticated using (public.has_shop_access(shop_id));

create policy bills_read on public.bills for select to authenticated using (public.has_shop_access(shop_id));
-- Bills are created only by a device session acting as itself — never by an
-- owner/manager session, which has no till context to bill from (spec: every
-- write records staff_id and device_id; corrections go through bill_events /
-- credit_notes, never a direct bill insert by an admin session).
create policy bills_insert on public.bills for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and device_id = nullif((select auth.jwt()) ->> 'device_id', '')::uuid
  );

create policy bill_lines_read on public.bill_lines for select to authenticated using (public.has_shop_access(shop_id));
create policy bill_lines_insert on public.bill_lines for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and exists (select 1 from public.bills b where b.id = bill_lines.bill_id and b.shop_id = bill_lines.shop_id)
  );

create policy bill_payments_read on public.bill_payments for select to authenticated using (public.has_shop_access(shop_id));
create policy bill_payments_insert on public.bill_payments for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and exists (select 1 from public.bills b where b.id = bill_payments.bill_id and b.shop_id = bill_payments.shop_id)
  );

create policy bill_events_read on public.bill_events for select to authenticated using (public.has_shop_access(shop_id));
create policy bill_events_insert on public.bill_events for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and exists (select 1 from public.bills b where b.id = bill_events.bill_id and b.shop_id = bill_events.shop_id)
  );

create policy day_closes_read on public.day_closes for select to authenticated using (public.has_shop_access(shop_id));
-- Same device-only insert rule as bills (Task 11): a day close is that
-- device's own drawer close, never fabricated by an owner/manager session.
create policy day_closes_insert on public.day_closes for insert to authenticated
  with check (public.has_shop_access(shop_id) and device_id = nullif((select auth.jwt()) ->> 'device_id', '')::uuid);

grant select on public.bills, public.bill_lines, public.bill_payments, public.bill_events, public.day_closes, public.invoice_series to authenticated;
grant insert on public.bills, public.bill_lines, public.bill_payments, public.bill_events, public.day_closes to authenticated;
grant select, insert, update, delete on public.bills, public.bill_lines, public.bill_payments, public.bill_events, public.day_closes, public.invoice_series to service_role;
```

- [ ] **Step 2: Apply** and confirm the append-only guard works: `insert into public.bills (...) values (...);` then `update public.bills set total_paise = 1 where id = '<that id>';` must raise `append-only table: bills cannot be edited`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923090200_sales_core.sql
git commit -m "feat(schema): bills, bill_lines, bill_payments, bill_events, day_closes, invoice_series"
```

---

### Task 12: QR ordering and kitchen — `qr_points`, `qr_orders`, `qr_order_lines`, `pending_orders`, `stations`, `category_stations`, `kots`, `order_events`

**Files:** Create: `supabase/migrations/20260923090300_qr_kitchen.sql`

**Interfaces:** Consumes: `public.shops`, `public.categories`, `public.bills`, `public.has_shop_access()`, `public.forbid_mutation()`. Produces: the eight tables spec section 9 describes (order lifecycle `PAID → FIRED → ACKNOWLEDGED → PREPARING → READY → COLLECTED/SERVED`, failure branches `REJECTED`/`UNACKNOWLEDGED`/`EXPIRED`).

- [ ] **Step 1: Write the migration**

```sql
create table public.qr_points (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  type        text not null check (type in ('table', 'counter', 'takeaway')),
  label       text not null,
  token       text not null unique,
  active      boolean not null default true,
  rev         int not null default 1
);
create index qr_points_shop_idx on public.qr_points (shop_id);

create table public.stations (
  id      uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name    text not null,
  rev     int not null default 1
);
create index stations_shop_idx on public.stations (shop_id);

create table public.category_stations (
  shop_id     uuid not null references public.shops(id),
  category_id uuid not null references public.categories(id),
  station_id  uuid not null references public.stations(id),
  primary key (category_id, station_id)
);

create table public.qr_orders (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops(id),
  qr_point_id     uuid not null references public.qr_points(id),
  status          text not null default 'PAID' check (status in ('PAID','FIRED','ACKNOWLEDGED','PREPARING','READY','COLLECTED','SERVED','REJECTED','UNACKNOWLEDGED','EXPIRED')),
  token_label     text,
  bill_id         uuid references public.bills(id),
  receipt_token   text not null unique,
  phone           text,
  created_at      timestamptz not null default now()
);
create index qr_orders_shop_idx on public.qr_orders (shop_id);

create table public.qr_order_lines (
  id                uuid primary key default gen_random_uuid(),
  qr_order_id       uuid not null references public.qr_orders(id),
  shop_id           uuid not null references public.shops(id),
  product_id        uuid not null,
  name              text not null,
  qty               numeric(12,3) not null check (qty > 0),
  unit_price_paise  bigint not null check (unit_price_paise >= 0),
  line_total_paise  bigint not null check (line_total_paise >= 0)
);
create index qr_order_lines_order_idx on public.qr_order_lines (qr_order_id);
create index qr_order_lines_shop_idx on public.qr_order_lines (shop_id);

create table public.pending_orders (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  qr_point_id  uuid not null references public.qr_points(id),
  cart         jsonb not null,
  created_at   timestamptz not null default now()
);
create index pending_orders_shop_idx on public.pending_orders (shop_id);

create table public.kots (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id),
  qr_order_id   uuid references public.qr_orders(id),
  bill_id       uuid references public.bills(id),
  station_id    uuid not null references public.stations(id),
  fired_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_device_id uuid references public.devices(id)
);
create index kots_shop_idx on public.kots (shop_id);

create table public.order_events (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  qr_order_id  uuid not null references public.qr_orders(id),
  event        text not null,
  detail       jsonb,
  created_at   timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (qr_order_id);
create index order_events_shop_idx on public.order_events (shop_id);

create trigger order_events_append_only before update or delete on public.order_events
  for each row execute function public.forbid_mutation();

alter table public.qr_points enable row level security;
alter table public.stations enable row level security;
alter table public.category_stations enable row level security;
alter table public.qr_orders enable row level security;
alter table public.qr_order_lines enable row level security;
alter table public.pending_orders enable row level security;
alter table public.kots enable row level security;
alter table public.order_events enable row level security;

create policy qr_points_read on public.qr_points for select to authenticated using (public.has_shop_access(shop_id));
create policy qr_points_write on public.qr_points for insert to authenticated with check (public.has_shop_access(shop_id));
create policy qr_points_update on public.qr_points for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy stations_read on public.stations for select to authenticated using (public.has_shop_access(shop_id));
create policy stations_write on public.stations for insert to authenticated with check (public.has_shop_access(shop_id));
create policy stations_update on public.stations for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy category_stations_read on public.category_stations for select to authenticated using (public.has_shop_access(shop_id));
create policy category_stations_write on public.category_stations for insert to authenticated with check (public.has_shop_access(shop_id));

create policy qr_orders_read on public.qr_orders for select to authenticated using (public.has_shop_access(shop_id));
-- qr_orders is created server-side (edge function via service_role, spec 9.3); authenticated devices only read and update lifecycle status.
create policy qr_orders_update on public.qr_orders for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy qr_order_lines_read on public.qr_order_lines for select to authenticated using (public.has_shop_access(shop_id));

create policy pending_orders_read on public.pending_orders for select to authenticated using (public.has_shop_access(shop_id));

create policy kots_read on public.kots for select to authenticated using (public.has_shop_access(shop_id));
create policy kots_update on public.kots for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy order_events_read on public.order_events for select to authenticated using (public.has_shop_access(shop_id));
create policy order_events_insert on public.order_events for insert to authenticated with check (public.has_shop_access(shop_id));

grant select, insert, update on public.qr_points, public.stations, public.category_stations to authenticated;
grant select, update on public.qr_orders, public.kots to authenticated;
grant select on public.qr_order_lines, public.pending_orders to authenticated;
grant select, insert on public.order_events to authenticated;
grant select, insert, update, delete on public.qr_orders, public.qr_order_lines, public.pending_orders, public.kots, public.order_events to service_role;
```

- [ ] **Step 2: Apply** and confirm `select count(*) from public.qr_orders;` returns `0` with no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923090300_qr_kitchen.sql
git commit -m "feat(schema): QR ordering and kitchen (qr_points, qr_orders, stations, kots, order_events)"
```

---

### Task 13: Reporting and ops — `shop_daily_stats`, `audit_log`, `sync_errors`

**Files:** Create: `supabase/migrations/20260923090400_reporting_ops.sql`

**Interfaces:** Consumes: `public.shops`, `public.has_shop_access()`, `public.forbid_mutation()`. Produces: server-computed daily rollups, an append-only privileged-action audit trail, and a client error log (spec section 13.3: "client errors to `sync_errors`").

- [ ] **Step 1: Write the migration**

```sql
create table public.shop_daily_stats (
  shop_id        uuid not null references public.shops(id),
  business_date  date not null,
  bill_count     int not null default 0,
  gross_paise    bigint not null default 0,
  tax_paise      bigint not null default 0,
  computed_at    timestamptz not null default now(),
  primary key (shop_id, business_date)
);

create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  actor_type  text not null check (actor_type in ('owner','manager','device','system')),
  actor_id    uuid,
  action      text not null,
  target_id   uuid,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_shop_idx on public.audit_log (shop_id, created_at desc);

create table public.sync_errors (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid references public.shops(id),
  device_id   uuid references public.devices(id),
  message     text not null,
  stack       text,
  context     jsonb,
  created_at  timestamptz not null default now()
);
create index sync_errors_shop_idx on public.sync_errors (shop_id);

create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.forbid_mutation();
create trigger sync_errors_append_only before update or delete on public.sync_errors
  for each row execute function public.forbid_mutation();

alter table public.shop_daily_stats enable row level security;
alter table public.audit_log enable row level security;
alter table public.sync_errors enable row level security;

create policy shop_daily_stats_read on public.shop_daily_stats for select to authenticated using (public.has_shop_access(shop_id));
create policy audit_log_read on public.audit_log for select to authenticated using (public.has_shop_access(shop_id));
create policy sync_errors_read on public.sync_errors for select to authenticated using (shop_id is not null and public.has_shop_access(shop_id));
create policy sync_errors_insert on public.sync_errors for insert to authenticated with check (shop_id is null or public.has_shop_access(shop_id));

grant select on public.shop_daily_stats, public.audit_log to authenticated;
grant select, insert on public.sync_errors to authenticated;
grant select, insert, update on public.shop_daily_stats to service_role;
grant select, insert on public.audit_log, public.sync_errors to service_role;
```

- [ ] **Step 2: Apply** and confirm the tables exist with RLS enabled (`select relrowsecurity from pg_class where relname = 'audit_log';` returns `t`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923090400_reporting_ops.sql
git commit -m "feat(schema): shop_daily_stats, audit_log, sync_errors"
```

---

### Task 14: Tax and compliance — `tax_profiles`, `tax_rules`, `credit_notes`

**Files:** Create: `supabase/migrations/20260923090500_tax_compliance.sql`

**Interfaces:** Consumes: `public.shops`, `public.bills`, `public.has_shop_access()`, `public.forbid_mutation()`. Produces: spec section 10.1's data-driven tax model and section 10.2's credit-note series.

- [ ] **Step 1: Write the migration**

```sql
create table public.tax_profiles (
  shop_id    uuid primary key references public.shops(id),
  regime     text not null check (regime in ('regular','composition','unregistered')),
  gstin      text,
  state      text,
  fssai_no   text,
  rev        int not null default 1,
  updated_at timestamptz not null default now()
);

create table public.tax_rules (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  hsn_sac      text not null,
  order_type   text not null check (order_type in ('dine_in','takeaway','delivery','any')),
  rate_bps     int not null check (rate_bps >= 0),
  cess_bps     int not null default 0 check (cess_bps >= 0),
  valid_from   date not null,
  valid_to     date,
  rev          int not null default 1
);
create index tax_rules_shop_idx on public.tax_rules (shop_id);

create table public.credit_notes (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id),
  device_id      uuid not null references public.devices(id),
  bill_id        uuid not null references public.bills(id),
  series         text not null check (series in ('C','WC')),
  fy             text not null,
  seq            int not null,
  amount_paise   bigint not null check (amount_paise > 0),
  reason         text not null,
  amends_bill_id uuid references public.bills(id),
  created_at     timestamptz not null default now(),
  unique (shop_id, series, fy, seq)
);
create index credit_notes_shop_idx on public.credit_notes (shop_id);

create trigger credit_notes_append_only before update or delete on public.credit_notes
  for each row execute function public.forbid_mutation();

alter table public.tax_profiles enable row level security;
alter table public.tax_rules enable row level security;
alter table public.credit_notes enable row level security;

create policy tax_profiles_read on public.tax_profiles for select to authenticated using (public.has_shop_access(shop_id));
create policy tax_profiles_write on public.tax_profiles for insert to authenticated with check (public.has_shop_access(shop_id));
create policy tax_profiles_update on public.tax_profiles for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy tax_rules_read on public.tax_rules for select to authenticated using (public.has_shop_access(shop_id));
create policy tax_rules_write on public.tax_rules for insert to authenticated with check (public.has_shop_access(shop_id));
create policy tax_rules_update on public.tax_rules for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy credit_notes_read on public.credit_notes for select to authenticated using (public.has_shop_access(shop_id));
create policy credit_notes_insert on public.credit_notes for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and exists (select 1 from public.bills b where b.id = credit_notes.bill_id and b.shop_id = credit_notes.shop_id)
  );

grant select, insert, update on public.tax_profiles, public.tax_rules to authenticated;
grant select, insert on public.credit_notes to authenticated;
grant select, insert, update, delete on public.tax_profiles, public.tax_rules, public.credit_notes to service_role;
```

- [ ] **Step 2: Apply** and confirm no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923090500_tax_compliance.sql
git commit -m "feat(schema): tax_profiles, tax_rules, credit_notes"
```

---

### Task 15: Table service — `tables`, `tabs`, `tab_lines`

**Files:** Create: `supabase/migrations/20260923090600_table_service.sql`

**Interfaces:** Consumes: `public.shops`, `public.staff`, `public.has_shop_access()`, `public.forbid_mutation()`. Produces: spec section 11.1's zone/seat table registry and append-only tab-line event log.

- [ ] **Step 1: Write the migration**

```sql
create table public.tables (
  id      uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  zone    text,
  label   text not null,
  seats   int not null default 2,
  rev     int not null default 1
);
create index tables_shop_idx on public.tables (shop_id);

create table public.tabs (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  table_id    uuid not null references public.tables(id),
  status      text not null default 'open' check (status in ('open','settled','merged','transferred')),
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz
);
create index tabs_shop_idx on public.tabs (shop_id);

create table public.tab_lines (
  id                uuid primary key default gen_random_uuid(),
  tab_id            uuid not null references public.tabs(id),
  shop_id           uuid not null references public.shops(id),
  event             text not null check (event in ('add','void','transfer','merge')),
  product_id        uuid,
  qty               numeric(12,3),
  unit_price_paise  bigint,
  staff_id          uuid references public.staff(id),
  created_at        timestamptz not null default now()
);
create index tab_lines_tab_idx on public.tab_lines (tab_id);
create index tab_lines_shop_idx on public.tab_lines (shop_id);

create trigger tab_lines_append_only before update or delete on public.tab_lines
  for each row execute function public.forbid_mutation();

alter table public.tables enable row level security;
alter table public.tabs enable row level security;
alter table public.tab_lines enable row level security;

create policy tables_read on public.tables for select to authenticated using (public.has_shop_access(shop_id));
create policy tables_write on public.tables for insert to authenticated with check (public.has_shop_access(shop_id));
create policy tables_update on public.tables for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy tabs_read on public.tabs for select to authenticated using (public.has_shop_access(shop_id));
create policy tabs_write on public.tabs for insert to authenticated with check (public.has_shop_access(shop_id));
create policy tabs_update on public.tabs for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy tab_lines_read on public.tab_lines for select to authenticated using (public.has_shop_access(shop_id));
create policy tab_lines_insert on public.tab_lines for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and exists (select 1 from public.tabs t where t.id = tab_lines.tab_id and t.shop_id = tab_lines.shop_id)
  );

grant select, insert, update on public.tables, public.tabs to authenticated;
grant select, insert on public.tab_lines to authenticated;
grant select, insert, update, delete on public.tables, public.tabs, public.tab_lines to service_role;
```

- [ ] **Step 2: Apply** and confirm no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923090600_table_service.sql
git commit -m "feat(schema): tables, tabs, tab_lines"
```

---

### Task 16: Bakery and stock — `advance_orders`, `advance_payments`, `stock_items`, `stock_batches`, `stock_movements`, `wastage_entries`

**Files:** Create: `supabase/migrations/20260923090700_bakery_stock.sql`

**Interfaces:** Consumes: `public.shops`, `public.products`, `public.has_shop_access()`, `public.forbid_mutation()`. Produces: spec section 11.2 (advance/custom orders) and 11.3 (stock-lite) tables.

- [ ] **Step 1: Write the migration**

```sql
create table public.advance_orders (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id),
  customer_name  text not null,
  customer_phone text,
  description    text,
  reference_photo_url text,
  pickup_at      timestamptz,
  discount_paise bigint not null default 0,
  status         text not null default 'pending' check (status in ('pending','ready','collected','cancelled')),
  created_at     timestamptz not null default now()
);
create index advance_orders_shop_idx on public.advance_orders (shop_id);

create table public.advance_payments (
  id                uuid primary key default gen_random_uuid(),
  advance_order_id  uuid not null references public.advance_orders(id),
  shop_id           uuid not null references public.shops(id),
  amount_paise      bigint not null check (amount_paise > 0),
  series            text not null default 'ADV',
  fy                text not null,
  seq               int not null,
  created_at        timestamptz not null default now(),
  unique (shop_id, series, fy, seq)
);
create index advance_payments_shop_idx on public.advance_payments (shop_id);

create table public.stock_items (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  product_id  uuid references public.products(id),
  name        text not null,
  unit        text not null default 'pcs',
  low_stock_at numeric(12,3),
  rev         int not null default 1
);
create index stock_items_shop_idx on public.stock_items (shop_id);

create table public.stock_batches (
  id             uuid primary key default gen_random_uuid(),
  stock_item_id  uuid not null references public.stock_items(id),
  shop_id        uuid not null references public.shops(id),
  production_date date,
  expiry_date    date,
  mrp_paise      bigint,
  rev            int not null default 1
);
create index stock_batches_shop_idx on public.stock_batches (shop_id);

create table public.stock_movements (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id),
  stock_item_id  uuid not null references public.stock_items(id),
  batch_id       uuid references public.stock_batches(id),
  reason         text not null check (reason in ('sale','receipt','adjustment','wastage','production')),
  qty_delta      numeric(12,3) not null,
  created_at     timestamptz not null default now()
);
create index stock_movements_item_idx on public.stock_movements (stock_item_id);
create index stock_movements_shop_idx on public.stock_movements (shop_id);

create table public.wastage_entries (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id),
  stock_item_id  uuid not null references public.stock_items(id),
  qty            numeric(12,3) not null check (qty > 0),
  reason         text,
  staff_id       uuid,
  created_at     timestamptz not null default now()
);
create index wastage_entries_shop_idx on public.wastage_entries (shop_id);

create trigger advance_payments_append_only before update or delete on public.advance_payments
  for each row execute function public.forbid_mutation();
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function public.forbid_mutation();
create trigger wastage_entries_append_only before update or delete on public.wastage_entries
  for each row execute function public.forbid_mutation();

alter table public.advance_orders enable row level security;
alter table public.advance_payments enable row level security;
alter table public.stock_items enable row level security;
alter table public.stock_batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.wastage_entries enable row level security;

create policy advance_orders_read on public.advance_orders for select to authenticated using (public.has_shop_access(shop_id));
create policy advance_orders_write on public.advance_orders for insert to authenticated with check (public.has_shop_access(shop_id));
create policy advance_orders_update on public.advance_orders for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy advance_payments_read on public.advance_payments for select to authenticated using (public.has_shop_access(shop_id));
create policy advance_payments_insert on public.advance_payments for insert to authenticated with check (public.has_shop_access(shop_id));

create policy stock_items_read on public.stock_items for select to authenticated using (public.has_shop_access(shop_id));
create policy stock_items_write on public.stock_items for insert to authenticated with check (public.has_shop_access(shop_id));
create policy stock_items_update on public.stock_items for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy stock_batches_read on public.stock_batches for select to authenticated using (public.has_shop_access(shop_id));
create policy stock_batches_write on public.stock_batches for insert to authenticated with check (public.has_shop_access(shop_id));
create policy stock_batches_update on public.stock_batches for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy stock_movements_read on public.stock_movements for select to authenticated using (public.has_shop_access(shop_id));
create policy stock_movements_insert on public.stock_movements for insert to authenticated with check (public.has_shop_access(shop_id));

create policy wastage_entries_read on public.wastage_entries for select to authenticated using (public.has_shop_access(shop_id));
create policy wastage_entries_insert on public.wastage_entries for insert to authenticated with check (public.has_shop_access(shop_id));

grant select, insert, update on public.advance_orders, public.stock_items, public.stock_batches to authenticated;
grant select, insert on public.advance_payments, public.stock_movements, public.wastage_entries to authenticated;
grant select, insert, update, delete on public.advance_orders, public.advance_payments, public.stock_items, public.stock_batches, public.stock_movements, public.wastage_entries to service_role;
```

- [ ] **Step 2: Apply** and confirm no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923090700_bakery_stock.sql
git commit -m "feat(schema): advance orders/payments, stock items/batches/movements, wastage"
```

---

### Task 17: Pricing and cash — `charges`, `promotions`, `price_lists`, `availability_schedules`, `shifts`, `cash_movements`, `exceptions`

**Files:** Create: `supabase/migrations/20260923090800_pricing_cash.sql`

**Interfaces:** Consumes: `public.shops`, `public.staff`, `public.devices`, `public.has_shop_access()`, `public.forbid_mutation()`. Produces: spec section 11.4 (pricing/charges engine) and 11.5 (cash control) tables.

- [ ] **Step 1: Write the migration**

```sql
create table public.charges (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  type         text not null check (type in ('service_charge','packaging','delivery','tip')),
  amount_paise bigint,
  percent_bps  int,
  taxable      boolean not null default true,
  rev          int not null default 1
);
create index charges_shop_idx on public.charges (shop_id);

create table public.promotions (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  code         text,
  type         text not null check (type in ('coupon','combo','bogo','happy_hour')),
  rules        jsonb not null,
  active       boolean not null default true,
  rev          int not null default 1
);
create index promotions_shop_idx on public.promotions (shop_id);

create table public.price_lists (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  name         text not null,
  order_type   text check (order_type in ('dine_in','takeaway','delivery','any')),
  channel      text,
  zone         text,
  rules        jsonb not null,
  rev          int not null default 1
);
create index price_lists_shop_idx on public.price_lists (shop_id);

create table public.availability_schedules (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  product_id   uuid references public.products(id),
  category_id  uuid references public.categories(id),
  days_of_week int[] not null default '{0,1,2,3,4,5,6}',
  start_time   time not null,
  end_time     time not null,
  rev          int not null default 1
);
create index availability_schedules_shop_idx on public.availability_schedules (shop_id);

create table public.shifts (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null references public.shops(id),
  device_id            uuid not null references public.devices(id),
  staff_id             uuid references public.staff(id),
  opening_float_paise  bigint not null default 0,
  closing_count_paise  bigint,
  opened_at            timestamptz not null default now(),
  closed_at            timestamptz
);
create index shifts_shop_idx on public.shifts (shop_id);

create table public.cash_movements (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  shift_id     uuid references public.shifts(id),
  type         text not null check (type in ('paid_in','paid_out','expense','cash_drop')),
  amount_paise bigint not null check (amount_paise > 0),
  reason       text not null,
  staff_id     uuid references public.staff(id),
  created_at   timestamptz not null default now()
);
create index cash_movements_shop_idx on public.cash_movements (shop_id);

create table public.exceptions (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  type         text not null check (type in ('void_after_payment','discount_over_threshold','refund','no_sale_open','unverified_upi','deactivated_staff_bill')),
  bill_id      uuid,
  staff_id     uuid references public.staff(id),
  detail       jsonb,
  created_at   timestamptz not null default now()
);
create index exceptions_shop_idx on public.exceptions (shop_id);

create trigger cash_movements_append_only before update or delete on public.cash_movements
  for each row execute function public.forbid_mutation();
create trigger exceptions_append_only before update or delete on public.exceptions
  for each row execute function public.forbid_mutation();

alter table public.charges enable row level security;
alter table public.promotions enable row level security;
alter table public.price_lists enable row level security;
alter table public.availability_schedules enable row level security;
alter table public.shifts enable row level security;
alter table public.cash_movements enable row level security;
alter table public.exceptions enable row level security;

create policy charges_read on public.charges for select to authenticated using (public.has_shop_access(shop_id));
create policy charges_write on public.charges for insert to authenticated with check (public.has_shop_access(shop_id));
create policy charges_update on public.charges for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy promotions_read on public.promotions for select to authenticated using (public.has_shop_access(shop_id));
create policy promotions_write on public.promotions for insert to authenticated with check (public.has_shop_access(shop_id));
create policy promotions_update on public.promotions for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy price_lists_read on public.price_lists for select to authenticated using (public.has_shop_access(shop_id));
create policy price_lists_write on public.price_lists for insert to authenticated with check (public.has_shop_access(shop_id));
create policy price_lists_update on public.price_lists for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy availability_schedules_read on public.availability_schedules for select to authenticated using (public.has_shop_access(shop_id));
create policy availability_schedules_write on public.availability_schedules for insert to authenticated with check (public.has_shop_access(shop_id));
create policy availability_schedules_update on public.availability_schedules for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy shifts_read on public.shifts for select to authenticated using (public.has_shop_access(shop_id));
-- Same device-only insert rule as bills (Task 11): a shift belongs to the
-- device that opened it, never fabricated by an owner/manager session.
create policy shifts_write on public.shifts for insert to authenticated
  with check (public.has_shop_access(shop_id) and device_id = nullif((select auth.jwt()) ->> 'device_id', '')::uuid);
create policy shifts_update on public.shifts for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy cash_movements_read on public.cash_movements for select to authenticated using (public.has_shop_access(shop_id));
create policy cash_movements_insert on public.cash_movements for insert to authenticated with check (public.has_shop_access(shop_id));

create policy exceptions_read on public.exceptions for select to authenticated using (public.has_shop_access(shop_id));
create policy exceptions_insert on public.exceptions for insert to authenticated with check (public.has_shop_access(shop_id));

grant select, insert, update on public.charges, public.promotions, public.price_lists, public.availability_schedules, public.shifts to authenticated;
grant select, insert on public.cash_movements, public.exceptions to authenticated;
grant select, insert, update, delete on public.charges, public.promotions, public.price_lists, public.availability_schedules, public.shifts, public.cash_movements, public.exceptions to service_role;
```

- [ ] **Step 2: Apply** and confirm no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923090800_pricing_cash.sql
git commit -m "feat(schema): charges, promotions, price lists, availability, shifts, cash movements, exceptions"
```

---

### Task 18: Customers — `customers`, `loyalty_ledger`, `credit_accounts`, `credit_ledger`

**Files:** Create: `supabase/migrations/20260923090900_customers.sql`

**Interfaces:** Consumes: `public.shops`, `public.bills`, `public.has_shop_access()`, `public.forbid_mutation()`. Produces: spec section 11.6's customer, loyalty and credit ("khata") tables.

- [ ] **Step 1: Write the migration**

```sql
create table public.customers (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  phone        text not null,
  name         text,
  consent      jsonb not null default '{}'::jsonb,
  rev          int not null default 1,
  created_at   timestamptz not null default now(),
  unique (shop_id, phone)
);
create index customers_shop_idx on public.customers (shop_id);

create table public.loyalty_ledger (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id),
  customer_id   uuid not null references public.customers(id),
  bill_id       uuid references public.bills(id),
  points_delta  int not null,
  reason        text not null check (reason in ('earn','redeem')),
  created_at    timestamptz not null default now()
);
create index loyalty_ledger_customer_idx on public.loyalty_ledger (customer_id);
create index loyalty_ledger_shop_idx on public.loyalty_ledger (shop_id);

create table public.credit_accounts (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id),
  customer_id   uuid not null references public.customers(id),
  limit_paise   bigint not null default 0,
  rev           int not null default 1,
  unique (shop_id, customer_id)
);
create index credit_accounts_shop_idx on public.credit_accounts (shop_id);

create table public.credit_ledger (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops(id),
  credit_account_id  uuid not null references public.credit_accounts(id),
  bill_id            uuid references public.bills(id),
  amount_paise       bigint not null,
  type               text not null check (type in ('charge','payment')),
  created_at         timestamptz not null default now()
);
create index credit_ledger_account_idx on public.credit_ledger (credit_account_id);
create index credit_ledger_shop_idx on public.credit_ledger (shop_id);

create trigger loyalty_ledger_append_only before update or delete on public.loyalty_ledger
  for each row execute function public.forbid_mutation();
create trigger credit_ledger_append_only before update or delete on public.credit_ledger
  for each row execute function public.forbid_mutation();

alter table public.customers enable row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;

create policy customers_read on public.customers for select to authenticated using (public.has_shop_access(shop_id));
create policy customers_write on public.customers for insert to authenticated with check (public.has_shop_access(shop_id));
create policy customers_update on public.customers for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy loyalty_ledger_read on public.loyalty_ledger for select to authenticated using (public.has_shop_access(shop_id));
create policy loyalty_ledger_insert on public.loyalty_ledger for insert to authenticated with check (public.has_shop_access(shop_id));

create policy credit_accounts_read on public.credit_accounts for select to authenticated using (public.has_shop_access(shop_id));
create policy credit_accounts_write on public.credit_accounts for insert to authenticated with check (public.has_shop_access(shop_id));
create policy credit_accounts_update on public.credit_accounts for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy credit_ledger_read on public.credit_ledger for select to authenticated using (public.has_shop_access(shop_id));
create policy credit_ledger_insert on public.credit_ledger for insert to authenticated with check (public.has_shop_access(shop_id));

grant select, insert, update on public.customers, public.credit_accounts to authenticated;
grant select, insert on public.loyalty_ledger, public.credit_ledger to authenticated;
grant select, insert, update, delete on public.customers, public.loyalty_ledger, public.credit_accounts, public.credit_ledger to service_role;
```

- [ ] **Step 2: Apply** and confirm no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923090900_customers.sql
git commit -m "feat(schema): customers, loyalty_ledger, credit_accounts, credit_ledger"
```

---

### Task 19: Channels and messaging — `channels`, `channel_orders`, `message_templates`, `message_log`, `consents`

**Files:** Create: `supabase/migrations/20260923091000_channels_messaging.sql`

**Interfaces:** Consumes: `public.shops`, `public.bills`, `public.has_shop_access()`, `public.forbid_mutation()`. Produces: spec section 12's aggregator/WhatsApp channel tables.

- [ ] **Step 1: Write the migration**

```sql
create table public.channels (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  type        text not null check (type in ('till','qr','phone','whatsapp','swiggy','zomato','ondc','magicpin')),
  config      jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  rev         int not null default 1
);
create index channels_shop_idx on public.channels (shop_id);

create table public.channel_orders (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops(id),
  channel_id        uuid not null references public.channels(id),
  external_order_id text,
  bill_id           uuid references public.bills(id),
  commission_paise  bigint not null default 0,
  raw_payload       jsonb,
  created_at        timestamptz not null default now()
);
create index channel_orders_shop_idx on public.channel_orders (shop_id);

create table public.message_templates (
  id       uuid primary key default gen_random_uuid(),
  shop_id  uuid not null references public.shops(id),
  purpose  text not null check (purpose in ('order_ready','receipt','loyalty','birthday')),
  body     text not null,
  rev      int not null default 1
);
create index message_templates_shop_idx on public.message_templates (shop_id);

create table public.message_log (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  customer_id  uuid,
  channel      text not null check (channel in ('whatsapp','sms','push')),
  template_id  uuid references public.message_templates(id),
  status       text not null default 'queued' check (status in ('queued','sent','failed')),
  created_at   timestamptz not null default now()
);
create index message_log_shop_idx on public.message_log (shop_id);

create table public.consents (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  customer_id  uuid not null,
  purpose      text not null check (purpose in ('messaging','marketing','data_processing')),
  granted      boolean not null,
  created_at   timestamptz not null default now()
);
create index consents_shop_idx on public.consents (shop_id);

create trigger channel_orders_append_only before update or delete on public.channel_orders
  for each row execute function public.forbid_mutation();
create trigger message_log_append_only before update or delete on public.message_log
  for each row execute function public.forbid_mutation();
create trigger consents_append_only before update or delete on public.consents
  for each row execute function public.forbid_mutation();

alter table public.channels enable row level security;
alter table public.channel_orders enable row level security;
alter table public.message_templates enable row level security;
alter table public.message_log enable row level security;
alter table public.consents enable row level security;

create policy channels_read on public.channels for select to authenticated using (public.has_shop_access(shop_id));
create policy channels_write on public.channels for insert to authenticated with check (public.has_shop_access(shop_id));
create policy channels_update on public.channels for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy channel_orders_read on public.channel_orders for select to authenticated using (public.has_shop_access(shop_id));
create policy channel_orders_insert on public.channel_orders for insert to authenticated with check (public.has_shop_access(shop_id));

create policy message_templates_read on public.message_templates for select to authenticated using (public.has_shop_access(shop_id));
create policy message_templates_write on public.message_templates for insert to authenticated with check (public.has_shop_access(shop_id));
create policy message_templates_update on public.message_templates for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy message_log_read on public.message_log for select to authenticated using (public.has_shop_access(shop_id));
create policy message_log_insert on public.message_log for insert to authenticated with check (public.has_shop_access(shop_id));

create policy consents_read on public.consents for select to authenticated using (public.has_shop_access(shop_id));
create policy consents_insert on public.consents for insert to authenticated with check (public.has_shop_access(shop_id));

grant select, insert, update on public.channels, public.message_templates to authenticated;
grant select, insert on public.channel_orders, public.message_log, public.consents to authenticated;
grant select, insert, update, delete on public.channels, public.channel_orders, public.message_templates, public.message_log, public.consents to service_role;
```

- [ ] **Step 2: Apply** and confirm no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260923091000_channels_messaging.sql
git commit -m "feat(schema): channels, channel_orders, message templates/log, consents"
```

---

## Part C: Isolation Test Suite, Sync Streams, and the Agreement Test

Part A already carries dedicated isolation tests for every one of its 7 tables (Tasks 3-6, 8). Part B's 57 tables all reuse the exact same `has_shop_access()` predicate, already proven correct seven separate times in Part A and twice more in the spike (`bills`/`bill_lines`/`products`, 30/30 checks). Writing 57 more near-identical bespoke test scripts would mostly re-prove the same predicate; instead, Task 20 below builds one **generic, data-driven read-scoping runner** covering a representative table from every Part B subsystem (so every migration task gets at least one regression check), and Task 22 builds the **agreement test** the spec's gate actually requires (section 4.1: "An automated test asserts both agree, for every table, so they cannot drift") — which, unlike a hand-written isolation script, is inherently exhaustive because it walks the live `pg_policies` catalog and the live Sync Streams config rather than a fixed table list a developer might forget to update.

### Task 20: Generic read-scoping isolation runner

**Files:**
- Create: `supabase/tests/isolation/generic-read-scoping.mjs`
- Create: `supabase/tests/isolation/table-manifest.mjs`

**Interfaces:**
- Consumes: every table created in Parts A and B.
- Produces: `TABLE_MANIFEST: { table: string; buildRow: (ctx: SeedContext) => Record<string, unknown> }[]`; a runner that, for each manifest entry, seeds one row in shop A and one in shop B, signs in as a device of shop A, and asserts the device's `select * from <table>` never includes shop B's row.

- [ ] **Step 1: Write the manifest** `supabase/tests/isolation/table-manifest.mjs` (one representative table per Part B migration task, plus the reporting tables — 13 entries; each `buildRow` returns the minimal valid row for that table given a seeded `{ shopId, deviceId, staffId, productId, billId }` context)

```js
// One representative, concretely-seedable table per subsystem. Read-scoping
// for every table not listed here still runs on the exact same
// has_shop_access() predicate, already proven in Part A (7 tables) and the
// spike (bills, bill_lines, products — 30/30 checks). This manifest is the
// regression net for Part B's 11 migrations, not a claim of exhaustive
// per-table coverage; Task 22's agreement test is what is actually
// exhaustive, because it reads the live table list instead of this fixed one.
export const TABLE_MANIFEST = [
  { table: 'plans', shopScoped: false, buildRow: () => ({ code: `plan-${crypto.randomUUID()}`, name: 'Test Plan', device_limit: 2, staff_limit: 5, price_paise: 199900 }) },
  { table: 'products', buildRow: (ctx) => ({ id: crypto.randomUUID(), shop_id: ctx.shopId, name: 'Manifest Product', price_paise: 10000 }) },
  { table: 'bills', buildRow: (ctx) => ({ id: crypto.randomUUID(), shop_id: ctx.shopId, device_id: ctx.deviceId, invoice_no: `M/2627/${String(ctx.seq).padStart(6, '0')}`, fy: '2627', seq: ctx.seq, business_date: '2026-09-23', payment_method: 'cash', subtotal_paise: 1000, total_paise: 1000, created_at: new Date().toISOString() }) },
  { table: 'qr_points', buildRow: (ctx) => ({ shop_id: ctx.shopId, type: 'table', label: 'T1', token: crypto.randomUUID() }) },
  { table: 'shop_daily_stats', buildRow: (ctx) => ({ shop_id: ctx.shopId, business_date: '2026-09-23', bill_count: 1 }) },
  { table: 'tax_rules', buildRow: (ctx) => ({ shop_id: ctx.shopId, hsn_sac: '9963', order_type: 'any', rate_bps: 500, valid_from: '2026-01-01' }) },
  { table: 'tables', buildRow: (ctx) => ({ shop_id: ctx.shopId, label: 'T1' }) },
  { table: 'stock_items', buildRow: (ctx) => ({ shop_id: ctx.shopId, name: 'Manifest Stock Item' }) },
  { table: 'charges', buildRow: (ctx) => ({ shop_id: ctx.shopId, type: 'service_charge', percent_bps: 500 }) },
  { table: 'shifts', buildRow: (ctx) => ({ shop_id: ctx.shopId, device_id: ctx.deviceId }) },
  { table: 'customers', buildRow: (ctx) => ({ shop_id: ctx.shopId, phone: `9${Math.floor(Math.random() * 1_000_000_000)}` }) },
  { table: 'channels', buildRow: (ctx) => ({ shop_id: ctx.shopId, type: 'till' }) },
  { table: 'audit_log', buildRow: (ctx) => ({ shop_id: ctx.shopId, actor_type: 'system', action: 'manifest_test' }) },
];
```

- [ ] **Step 2: Write the runner** `supabase/tests/isolation/generic-read-scoping.mjs`

```js
// Run: SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... SPIKE_ANON_KEY=... node supabase/tests/isolation/generic-read-scoping.mjs
import { createClient } from '@supabase/supabase-js';
import { TABLE_MANIFEST } from './table-manifest.mjs';

const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
const anonKey = process.env.SPIKE_ANON_KEY;
if (!url || !serviceKey || !anonKey) { console.error('Set SPIKE_SUPABASE_URL, SPIKE_SERVICE_ROLE_KEY, SPIKE_ANON_KEY.'); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const { data: account } = await admin.from('accounts').insert({ name: 'Generic Scoping Account' }).select().single();
const { data: shopA } = await admin.from('shops').insert({ account_id: account.id, name: 'Generic Scoping Shop A' }).select().single();
const { data: shopB } = await admin.from('shops').insert({ account_id: account.id, name: 'Generic Scoping Shop B' }).select().single();

const email = `generic-${crypto.randomUUID()}@isolation.test`;
const password = crypto.randomUUID();
const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const { data: deviceA } = await admin.from('devices').insert({ shop_id: shopA.id, auth_user_id: user.user.id, code: 'GS1' }).select().single();
const client = createClient(url, anonKey, { auth: { persistSession: false } });
await client.auth.signInWithPassword({ email, password });

let seq = 1;
for (const entry of TABLE_MANIFEST) {
  if (entry.shopScoped === false) continue; // not tenant-scoped (e.g. plans); skip read-scoping, covered by its own migration's manual check
  const ctxA = { shopId: shopA.id, deviceId: deviceA.id, seq: seq++ };
  const ctxB = { shopId: shopB.id, deviceId: deviceA.id, seq: seq++ }; // deviceId unused by shop-B row's own shop_id column
  const rowA = entry.buildRow(ctxA);
  const rowB = entry.buildRow(ctxB);
  const { error: insErrA } = await admin.from(entry.table).insert(rowA);
  const { error: insErrB } = await admin.from(entry.table).insert(rowB);
  if (insErrA || insErrB) { check(`${entry.table}: seed rows inserted`, false, (insErrA ?? insErrB).message); continue; }

  const seen = await client.from(entry.table).select('shop_id');
  const leaked = (seen.data ?? []).some((r) => r.shop_id === shopB.id);
  check(`${entry.table}: device sees no shop-B rows`, !leaked && !seen.error, seen.error?.message ?? '');
}

console.log(failures === 0 ? '\nAll generic read-scoping checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 3: Run it, expect PASS**

```bash
node supabase/tests/isolation/generic-read-scoping.mjs
```
Expected: 12 `PASS` lines (13 manifest entries minus `plans`, which is skipped as not shop-scoped), exit code 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/isolation/table-manifest.mjs supabase/tests/isolation/generic-read-scoping.mjs
git commit -m "test: generic read-scoping isolation runner across Part B subsystems"
```

---

### Task 21: Sync Streams for every synced table

**Files:**
- Modify: `supabase/migrations/20260922090200_devices_and_hook.sql` → new migration `supabase/migrations/20260923091100_hook_role_claim.sql` (additive; the original migration already shipped and was applied, so the fix is a new migration, never an edit to an applied one)
- Create: `docs/superpowers/ops/sync-streams-phase1.yaml` (kept in the repo as the source of truth; the PowerSync dashboard is where it is actually deployed, per the spike's proven manual-entry process)

**Interfaces:**
- Consumes: `public.devices.role`, every Part A/B table.
- Produces: a top-level `role` JWT claim (needed so a Sync Stream query can read it via `auth.parameter('role')`); the full Sync Streams config for Phase 1, extending the spike's proven `shop_data` stream.

- [ ] **Step 1: Write the hook amendment migration**

```sql
-- Adds a top-level `role` claim so Sync Streams queries can read
-- auth.parameter('role') to scope product_costs to back-office devices
-- only (spec section 5: "product_costs syncs only to devices the owner
-- marks back-office"). The original hook (Task 3) only promoted shop_id
-- and device_id to the top level.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event -> 'claims';
  d      record;
begin
  select id, shop_id, role into d
  from public.devices
  where auth_user_id = (event ->> 'user_id')::uuid and revoked_at is null;

  if found then
    claims := jsonb_set(claims, '{shop_id}',   to_jsonb(d.shop_id::text));
    claims := jsonb_set(claims, '{device_id}', to_jsonb(d.id::text));
    claims := jsonb_set(claims, '{device_role}', to_jsonb(d.role::text));
    claims := jsonb_set(
      claims, '{app_metadata}',
      coalesce(claims -> 'app_metadata', '{}'::jsonb)
        || jsonb_build_object('shop_id', d.shop_id::text, 'device_id', d.id::text, 'role', 'device', 'device_role', d.role::text)
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;
```

(Named `device_role`, not `role`, to avoid colliding with Supabase's own top-level `role` claim, which is already `authenticated`/`anon`/etc.)

- [ ] **Step 2: Apply** in the Supabase SQL Editor.

- [ ] **Step 3: Write the Sync Streams config** `docs/superpowers/ops/sync-streams-phase1.yaml`

```yaml
config:
  edition: 3

streams:
  shop_core:
    auto_subscribe: true
    queries:
      - SELECT * FROM shops WHERE id = auth.parameter('shop_id')
      - SELECT * FROM devices WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM staff WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM settings WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM memberships WHERE shop_id = auth.parameter('shop_id')

  catalog:
    auto_subscribe: true
    queries:
      - SELECT * FROM categories WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM products WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM product_variants WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM modifier_groups WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM modifiers WHERE shop_id = auth.parameter('shop_id')

  backoffice_catalog:
    auto_subscribe: false
    queries:
      - SELECT * FROM product_costs WHERE shop_id = auth.parameter('shop_id') AND auth.parameter('device_role') = 'backoffice'

  sales_recent:
    auto_subscribe: true
    queries:
      - SELECT * FROM bills WHERE shop_id = auth.parameter('shop_id') AND business_date >= (current_date - interval '90 days')
      - SELECT * FROM bill_lines WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM bill_payments WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM bill_events WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM day_closes WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM invoice_series WHERE shop_id = auth.parameter('shop_id')

  tax_and_credit:
    auto_subscribe: true
    queries:
      - SELECT * FROM tax_profiles WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM tax_rules WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM credit_notes WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM approvals WHERE shop_id = auth.parameter('shop_id')

  table_service:
    auto_subscribe: true
    queries:
      - SELECT * FROM tables WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM tabs WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM tab_lines WHERE shop_id = auth.parameter('shop_id')

  qr_and_kitchen:
    auto_subscribe: true
    queries:
      - SELECT * FROM qr_points WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM stations WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM category_stations WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM qr_orders WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM qr_order_lines WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM kots WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM order_events WHERE shop_id = auth.parameter('shop_id')

  bakery_and_stock:
    auto_subscribe: true
    queries:
      - SELECT * FROM advance_orders WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM advance_payments WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM stock_items WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM stock_batches WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM stock_movements WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM wastage_entries WHERE shop_id = auth.parameter('shop_id')

  pricing_and_cash:
    auto_subscribe: true
    queries:
      - SELECT * FROM charges WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM promotions WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM price_lists WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM availability_schedules WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM shifts WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM cash_movements WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM exceptions WHERE shop_id = auth.parameter('shop_id')

  customers_and_loyalty:
    auto_subscribe: true
    queries:
      - SELECT * FROM customers WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM loyalty_ledger WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM credit_accounts WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM credit_ledger WHERE shop_id = auth.parameter('shop_id')

  channels_and_messaging:
    auto_subscribe: false
    queries:
      - SELECT * FROM channels WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM channel_orders WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM message_templates WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM message_log WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM consents WHERE shop_id = auth.parameter('shop_id')

  reporting:
    auto_subscribe: true
    queries:
      - SELECT * FROM shop_daily_stats WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM audit_log WHERE shop_id = auth.parameter('shop_id')
```

`plans`, `subscriptions`, `entitlements`, `webhook_events`, `payment_events`, `menu_publications`, `pending_orders`, `sync_errors` are deliberately **not** synced: `plans` is public reference data fetched over the Data API, not per-device sync; `subscriptions`/`entitlements`/`webhook_events`/`payment_events` change rarely and are read via a direct query when the app checks licence status, not streamed continuously; `menu_publications` and `pending_orders` are server-internal audit/draft state, not something a till needs on its local SQLite; `sync_errors` is write-only telemetry from the device, never read back down.

`backoffice_catalog` and `channels_and_messaging` are `auto_subscribe: false` (opt-in per device/feature) rather than pushed to every till by default, matching spec section 5's back-office restriction and the fact that channels/messaging ship in Wave C/D, not at Phase 1.

- [ ] **Step 4: Deploy** — using the same PowerSync dashboard flow proven in the spike (Sync Streams page, paste as flow-style YAML if the block-style editor corrupts on paste, **Validate**, then **Deploy**), against the **same PowerSync project the spike used** (`cafe-spike`), since Phase 1 is the real foundation this project now serves permanently, not a throwaway.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260923091100_hook_role_claim.sql docs/superpowers/ops/sync-streams-phase1.yaml
git commit -m "feat(sync): Phase 1 Sync Streams for every synced table, device_role claim"
```

---

### Task 22: The Sync-Streams-vs-RLS agreement test

**Files:**
- Create: `supabase/tests/agreement/sync-rls-agreement.mjs`

**Interfaces:**
- Consumes: `docs/superpowers/ops/sync-streams-phase1.yaml`, `pg_policies` (Postgres system catalog), every table's RLS policies.
- Produces: an automated test that, for every table named in the Sync Streams config, asserts the **set of rows a device's Sync Stream query would return** equals **the set of rows that same device's RLS-scoped `select *` actually returns** — this is the literal spec 4.1 requirement ("An automated test asserts both agree, for every table").

- [ ] **Step 1: Write the failing test structure first** (parses the YAML, extracts table names, confirms the parser works before wiring up the DB comparison)

```js
// supabase/tests/agreement/sync-rls-agreement.mjs
// Run: SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... SPIKE_ANON_KEY=... node supabase/tests/agreement/sync-rls-agreement.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const yamlPath = new URL('../../../docs/superpowers/ops/sync-streams-phase1.yaml', import.meta.url);
const config = parse(readFileSync(yamlPath, 'utf8'));

// Extract {table, whereClause} from every `SELECT * FROM <table> WHERE ...` query.
function extractQueries(cfg) {
  const out = [];
  for (const stream of Object.values(cfg.streams)) {
    for (const q of stream.queries) {
      const m = /SELECT \* FROM (\w+) WHERE (.+)/i.exec(q);
      if (!m) throw new Error(`Cannot parse sync stream query: ${q}`);
      out.push({ table: m[1], whereClause: m[2] });
    }
  }
  return out;
}

const queries = extractQueries(config);
console.log(`Parsed ${queries.length} sync stream queries across ${Object.keys(config.streams).length} streams.`);
if (queries.length === 0) { console.error('FAIL  no queries parsed from sync-streams-phase1.yaml'); process.exit(1); }
```

- [ ] **Step 2: Run it, verify it parses** (sanity-check before the DB round trip is added)

```bash
node supabase/tests/agreement/sync-rls-agreement.mjs
```
Expected: prints a count matching the 47 queries across 11 streams in `sync-streams-phase1.yaml` (13 streams total incl. the two non-synced ones is wrong — count only the `queries:` lines actually present; verify the printed count against a manual `grep -c 'SELECT \* FROM' docs/superpowers/ops/sync-streams-phase1.yaml`).

- [ ] **Step 3: Add the DB comparison** (append to the same file)

```js
// For each query, replace auth.parameter('shop_id') with a literal test
// shop id and run it via service_role (bypasses RLS: this is "what the sync
// stream WOULD return"), then run the same table's RLS-scoped select as the
// real signed-in device (this is "what RLS ACTUALLY allows"), and assert
// the two id sets are equal.
const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
const anonKey = process.env.SPIKE_ANON_KEY;
if (!url || !serviceKey || !anonKey) { console.error('Set SPIKE_SUPABASE_URL, SPIKE_SERVICE_ROLE_KEY, SPIKE_ANON_KEY.'); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const { data: account } = await admin.from('accounts').insert({ name: 'Agreement Test Account' }).select().single();
const { data: shop } = await admin.from('shops').insert({ account_id: account.id, name: 'Agreement Test Shop' }).select().single();
const email = `agree-${crypto.randomUUID()}@isolation.test`;
const password = crypto.randomUUID();
const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const { data: device } = await admin.from('devices').insert({ shop_id: shop.id, auth_user_id: user.user.id, code: 'AG1', role: 'backoffice' }).select().single();
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
await anon.auth.signInWithPassword({ email, password });

for (const { table, whereClause } of queries) {
  // Sync side: run the literal SQL via service_role's Postgres session using
  // an RPC wrapper (service_role can execute arbitrary read SQL through
  // `execute_sql`, a SECURITY DEFINER helper scoped to select-only — see
  // Step 4). RLS side: the plain table query through the signed-in device.
  const literalWhere = whereClause
    .replace(/auth\.parameter\('shop_id'\)/g, `'${shop.id}'`)
    .replace(/auth\.parameter\('device_role'\)/g, `'${device.role}'`);
  const { data: syncRows, error: syncErr } = await admin.rpc('execute_readonly_sql', {
    query: `select id from public.${table} where ${literalWhere}`,
  });
  const { data: rlsRows, error: rlsErr } = await anon.from(table).select('id');

  if (syncErr || rlsErr) { check(`${table}: agreement query ran`, false, (syncErr ?? rlsErr).message); continue; }

  const syncIds = new Set((syncRows ?? []).map((r) => r.id));
  const rlsIds = new Set((rlsRows ?? []).map((r) => r.id));
  const agree = syncIds.size === rlsIds.size && [...syncIds].every((id) => rlsIds.has(id));
  check(`${table}: sync-stream scope matches RLS scope`, agree, `sync=${syncIds.size} rls=${rlsIds.size}`);
}

await admin.from('devices').delete().eq('id', device.id);
await admin.from('shops').delete().eq('id', shop.id);
await admin.from('accounts').delete().eq('id', account.id);
await admin.auth.admin.deleteUser(user.user.id);

console.log(failures === 0 ? '\nAll sync/RLS agreement checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 4: Create the `execute_readonly_sql` helper the test depends on** — a new migration, since arbitrary-SQL RPCs are otherwise a serious security hole; this one is locked to `select`-only statements and to `service_role` alone

```sql
-- supabase/migrations/20260923091200_execute_readonly_sql.sql
-- Used only by the CI agreement test (Task 22) to compare a Sync Stream's
-- literal query against RLS-scoped access. Restricted to service_role and
-- to statements starting with "select" (case-insensitive) to prevent
-- misuse if this function is ever called from a wider context by mistake.
create or replace function public.execute_readonly_sql(query text)
returns setof record
language plpgsql
security definer
set search_path = public
as $$
begin
  if left(trim(lower(query)), 6) <> 'select' then
    raise exception 'execute_readonly_sql only accepts SELECT statements';
  end if;
  return query execute query;
end;
$$;

revoke all on function public.execute_readonly_sql from public, anon, authenticated;
grant execute on function public.execute_readonly_sql to service_role;
```

Note: Postgres requires a `returns setof record` function to be called with an explicit column list (`select * from execute_readonly_sql('...') as t(id uuid)`), so the Step 3 `.rpc()` call above works because supabase-js's RPC path negotiates this via the function's declared return type at the call site — if `admin.rpc('execute_readonly_sql', {...})` errors with a "a column definition list is required" message, change the SQL text embedded in each `whereClause`'s query string to always `select id::text as id from ...` and adjust the function to `returns table(id text)` instead of `setof record`, which removes the ambiguity. Try `setof record` first since it is more reusable; fall back to `table(id text)` if it does not work against this Postgres version, and record which one was needed in the findings doc.

- [ ] **Step 5: Apply the migration, then run the full test**

```bash
node supabase/tests/agreement/sync-rls-agreement.mjs
```
Expected: one `PASS` line per parsed query (matching Step 2's count), `All sync/RLS agreement checks passed.`, exit 0. Any `FAIL` means the Sync Stream config and the RLS policy for that table have drifted — fix the query or the policy (never weaken the test) before continuing.

- [ ] **Step 6: Wire into CI** — extend `.github/workflows/db-migrations.yml` (Task 1) with a job that runs after `supabase db push` on merge to `main`:

```yaml
  agreement-test:
    needs: migrate
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: node supabase/tests/agreement/sync-rls-agreement.mjs
        env:
          SPIKE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SPIKE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          SPIKE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260923091200_execute_readonly_sql.sql supabase/tests/agreement/sync-rls-agreement.mjs .github/workflows/db-migrations.yml
git commit -m "test: automated Sync-Streams-vs-RLS agreement test, wired into CI"
```

---

## Self-Review

**Spec coverage:** every table named in spec section 5's "Tables" list (Platform, Catalog, Sales, QR ordering and kitchen, Reporting/ops) and every table in the "Tables added by the operations review" list (Identity and tax, Table service, Bakery and stock, Pricing and cash, Customers, Channels and messaging) has a task in Part A or B. `staff` and `settings` — present in spec section 5's Config-class description but missing from its Tables bullet list — are added in Part A, Tasks 5-6, flagged as a spec gap. Section 4.1's memberships, owner MFA, approval tokens and PIN policy are Part A Tasks 4, 7, 8, 5. Section 4.1's "automated test asserts both agree" is Part C Task 22. The Phase 1 gate ("isolation and agreement tests pass") is Parts A + C together.

**Placeholder scan:** no `TBD`/`fill in`/"add appropriate" language; every migration task has complete `CREATE TABLE`/`CREATE POLICY` SQL; every code task has a complete failing test and a complete implementation, not a description of one.

**Type consistency:** `has_shop_access(target_shop_id uuid) returns boolean`, defined once in Part A Task 4, is called identically (`public.has_shop_access(shop_id)`) in every RLS policy across Parts A, B and C — no renamed variants. `forbid_mutation()`, defined once in Part B Task 11 (the first task needing it), is reused by name in Tasks 12-19 wherever a table is append-only. The `device_role` claim added in Part C Task 21 is deliberately named differently from the `role: 'device'` claim already set in Part A Task 3, to avoid a collision — both are documented at the point they are introduced.

## Done when

- Parts A and B: every migration in this plan applied to `cafe-production`, every table's isolation test (Part A) or the generic read-scoping runner (Part B, Task 20) passes.
- Part C: the Sync Streams config in `docs/superpowers/ops/sync-streams-phase1.yaml` is deployed to the `cafe-spike` PowerSync project and the agreement test (Task 22) passes for every parsed query, wired into CI so it runs on every future migration.
- This satisfies spec section 16's Phase 1 gate: "Isolation and agreement tests pass."
- Nothing in this plan builds UI, business logic, or edge functions beyond `enrol-device` — Phase 2 (client data layer) is the next plan, and depends on every table here existing with correct RLS.

