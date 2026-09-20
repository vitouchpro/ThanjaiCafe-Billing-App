# Phase 0 Hardening and PowerSync Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the security and reliability gaps in the current single-cafe app (Phase 0), then run a time-boxed spike that decides whether PowerSync or custom sync on Dexie carries the multi-tenant, multi-device rebuild.

**Architecture:** Part A changes the existing React/Vite/Supabase app in small, separately testable steps on branch `phase0/hardening`. Part B runs in a separate git worktree on a throwaway branch `spike/powersync`, against a separate free Supabase project, so it can never touch production data. Only the findings document from Part B is kept.

**Tech Stack:** React 19, Vite ^8.2.2, TypeScript ~6.0.2, Vitest ^4.1.11 (node environment), Zustand, Dexie, `@supabase/supabase-js` ^2.116, Supabase CLI 2.117.0, Deno edge functions, `@powersync/web` ^2 and `@powersync/react` ^2 (spike only), Node 22.15, npm 11.

**Spec:** `docs/superpowers/specs/2026-09-20-cafe-billing-saas-design.md` (sections 2, 3, 7, 15, 16 drive this plan). Read it before starting.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec.

- The service-role key is never in a client. `VITE_PUBLISH_TOKEN` is removed (Phase 1 removes it; this plan blocks it from shipping by accident).
- Every `VITE_*` variable is public. Secrets belong in Supabase function secrets.
- Never open, print or commit `.env.local` or `DEPLOY-STEPS.md` (both are gitignored and hold secrets). Never paste a secret into a command that gets logged; the human types secrets.
- RLS on every table. Every migration includes explicit `GRANT`s, because Supabase stops auto-exposing new `public` tables to the Data API from 30 Oct 2026.
- `SECURITY DEFINER` functions only in a non-exposed schema, each with an explicit `auth.uid()`/claim check. Views use `security_invoker = true`.
- Transactions are append-only: no UPDATE/DELETE policies, and a trigger also blocks updates.
- Money is integer paise (`bigint`). Quantities are `numeric(12,3)` with a unit. IDs are UUIDv7 generated on the device (the spike may use `crypto.randomUUID()`).
- The server accepts and flags, and never rejects a completed sale.
- Free plan limits: 2 Supabase projects (production `hiwufsjnhfrzevjvfefp` plus one dev/staging), 500 MB database, 500k edge invocations/month, 200 Realtime connections, no automatic backups. The spike uses the dev/staging slot.
- Existing tests must stay green after every task (`npm test`). `npm run lint` and `npm run build` must pass at the end of every task.
- Test files live in `__tests__` folders and match `src/**/*.test.ts` or `supabase/functions/**/*.test.ts` (see `vitest.config.ts`). Pure functions are tested directly; tests run in a node environment, so no DOM.
- Supabase CLI: discover flags with `--help` before using a command. Create migrations with `npx supabase migration new <name>`; never invent a filename.
- Commits: one per task, conventional style (`feat:`, `fix:`, `chore:`, `docs:`, `test:`), `git add` explicit paths only. Add the commit trailer your session requires.
- Shell examples use Git Bash on Windows. Repo root below is `G:/DIGITAL_SERVICE/WEB/THECAFE/Repo-ThanjaiCafe-Billing-App/ThanjaiCafe-Billing-App`.

## Plan roadmap

This plan is 1 of several. Each later plan is written after the previous gate passes, because the spike result changes the data-layer work.

| Plan | Scope (spec section 16) | Written when |
|---|---|---|
| **1 (this)** | Phase 0 hardening + PowerSync spike + findings | Now |
| 2 | Phase 1 Foundation: tenant schema, RLS, hook, enrolment, memberships, MFA, approvals, schema for every module | After the spike gate |
| 3 | Phase 2 Client data layer: repository seam, sync engine chosen by the spike, tax engine, credit notes | After plan 2 |
| 4 | Phase 3 Multi-device and QR self-ordering, verified UPI | After plan 3 |
| 5 | Phase 4 SaaS layer + legal pack | After plan 4 |
| 6 | Phase 5 Go-live | After plan 5 |
| 7 | Wave A cafe operations (first post-beta wave) | After beta |

## Findings from reading the code that this plan acts on

1. `VITE_PUBLISH_TOKEN` is inlined into the public bundle; it authorises `publish-menu` and `backup-bills` (service-role writes).
2. `DEPLOY-STEPS.md` holds plaintext secret values (gitignored, never committed) and says a live Razorpay secret is still exposed.
3. `create-order` is anonymous, has `CORS: *`, and has no rate limit.
4. Migrations were applied by pasting SQL; no `supabase/config.toml`, no `0003`, no CI.
5. `KitchenPage` calls `useOrderIntake(true)`, which claims paid orders and writes bills into that device's own IndexedDB, so a kitchen tablet can swallow bills the till never sees.
6. KOT printing is manual only; `autoPrint` covers receipts.

**Not fixed here (by design):** several tills can still race to bill an order. Phase 3 moves online billing to the server.

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `src/utils/publicEnvGuard.ts` | Pure check that blocks secret-like `VITE_*` values in production builds | 3 |
| `vite.config.ts` | Calls the guard | 3 |
| `supabase/config.toml`, `supabase/migrations/*` | Migrations as code | 4 |
| `.github/workflows/ci.yml` | Lint, test, build on every push | 4 |
| `supabase/functions/_shared/cors.ts` | Origin allow-list for anonymous functions | 5 |
| `supabase/functions/_shared/rateLimit.ts` | IP and key helpers, limits | 5 |
| `supabase/migrations/<ts>_rate_limits.sql` | `rate_limits` table and `bump_rate_limit()` | 5 |
| `supabase/functions/create-order/index.ts` | Uses CORS and rate limit | 5 |
| `src/features/orders/useOrderIntake.ts` | `createBills` option, `loaded` flag, `ordersToClaim()` | 6 |
| `src/features/orders/useKotAutoPrint.ts` | Auto-print new KOTs on the kitchen screen | 7 |
| `src/spike/**` (spike worktree only) | Throwaway PowerSync spike code | 10-16 |
| `docs/superpowers/spikes/2026-09-powersync-spike-findings.md` | Kept result of the spike | 17 |

---

# Part A: Phase 0 hardening (branch `phase0/hardening`)

### Task 1: Branch and baseline

**Files:** none changed.

**Interfaces:** Produces: a clean branch `phase0/hardening` and the recorded baseline test count every later task must not reduce.

- [ ] **Step 1: Create the branch from the docs branch so the spec and plan travel with it**

```bash
cd "G:/DIGITAL_SERVICE/WEB/THECAFE/Repo-ThanjaiCafe-Billing-App/ThanjaiCafe-Billing-App"
git switch docs/cafe-billing-saas-design
git switch -c phase0/hardening
git status --short
```

Expected: `M .env.example` and `?? supabase/.temp/` may appear. They pre-date this plan. Inspect `git diff .env.example`; leave it uncommitted unless the owner says otherwise. Never `git add .` or `git add -A`.

- [ ] **Step 2: Install and record the baseline**

```bash
npm ci
npm test
npm run lint
npm run build
```

Expected: all pass. Write the passing test count (about 207 per the README, possibly more) into the PR description later; call it BASELINE.

- [ ] **Step 3: No commit** (nothing changed).

---

### Task 2: Rotate exposed secrets and scan history (MANUAL, owner)

**Files:** none in the repo. Do this by hand; an agent must not open `.env.local` or `DEPLOY-STEPS.md`.

**Interfaces:** Produces: rotated Razorpay and function secrets, and proof that no secret is in git history.

- [ ] **Step 1: Rotate in Razorpay.** Dashboard → Settings → API Keys → regenerate the live key secret. Then Settings → Webhooks → edit the webhook and set a new secret.

- [ ] **Step 2: Rotate the function secrets** (the human types the values):

```bash
npx supabase secrets set RAZORPAY_KEY_SECRET=<new secret>
npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=<new webhook secret>
npx supabase secrets set PUBLISH_TOKEN=<new random 32+ char token>
```

Also update `VITE_PUBLISH_TOKEN` in `.env.local` and in the Vercel project settings to the new token if the token-based functions are in use.

- [ ] **Step 3: Remove literal secrets from `DEPLOY-STEPS.md`** (gitignored local file): replace each real value with the text `set in Supabase secrets`.

- [ ] **Step 4: Prove git history is clean**

```bash
git log --all -p -S"rzp_live" --oneline | head -5
git log --all -p -S"whsec_" --oneline | head -5
git check-ignore -v DEPLOY-STEPS.md .env.local
```

Expected: the two `git log` commands print nothing; `check-ignore` lists both files as ignored.

- [ ] **Step 5: No commit** (no repo change). Tell the owner it is done.

---

### Task 3: Block secret-like `VITE_*` values in production builds

**Files:**
- Create: `src/utils/publicEnvGuard.ts`
- Create: `src/utils/__tests__/publicEnvGuard.test.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: `findForbiddenPublicEnv(env: Record<string, string | undefined>): string[]`; `assertPublicEnvSafe(env, opts: { command: 'build' | 'serve'; mode: string; acknowledged: boolean }): void` (throws `Error`); constants `PUBLISH_TOKEN_VAR = 'VITE_PUBLISH_TOKEN'` and `ACK_VAR = 'ALLOW_PUBLIC_PUBLISH_TOKEN'`.

- [ ] **Step 1: Write the failing test** `src/utils/__tests__/publicEnvGuard.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { assertPublicEnvSafe, findForbiddenPublicEnv } from '../publicEnvGuard';

const prod = { command: 'build', mode: 'production', acknowledged: false } as const;

describe('findForbiddenPublicEnv', () => {
  it('accepts the public variables the app is meant to have', () => {
    expect(findForbiddenPublicEnv({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_RAZORPAY_KEY_ID: 'rzp_test_x',
      VITE_CAFE_NAME: 'THANJAI CAFE',
      VITE_PUBLIC_ORDER_URL: 'https://x.app',
    })).toEqual([]);
  });

  it('flags the publish token when it has a value', () => {
    expect(findForbiddenPublicEnv({ VITE_PUBLISH_TOKEN: 'abc' })).toEqual(['VITE_PUBLISH_TOKEN']);
  });

  it('ignores an empty or whitespace publish token', () => {
    expect(findForbiddenPublicEnv({ VITE_PUBLISH_TOKEN: '' })).toEqual([]);
    expect(findForbiddenPublicEnv({ VITE_PUBLISH_TOKEN: '   ' })).toEqual([]);
  });

  it('flags secret-looking names, sorted', () => {
    expect(findForbiddenPublicEnv({
      VITE_RAZORPAY_KEY_SECRET: 'x',
      VITE_SUPABASE_SERVICE_ROLE_KEY: 'y',
    })).toEqual(['VITE_RAZORPAY_KEY_SECRET', 'VITE_SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('ignores variables without the VITE_ prefix', () => {
    expect(findForbiddenPublicEnv({ RAZORPAY_KEY_SECRET: 'x', SECRET: 'y' })).toEqual([]);
  });
});

describe('assertPublicEnvSafe', () => {
  it('blocks a production build that carries the publish token', () => {
    expect(() => assertPublicEnvSafe({ VITE_PUBLISH_TOKEN: 't' }, prod))
      .toThrow(/VITE_PUBLISH_TOKEN/);
  });

  it('allows the publish token when knowingly acknowledged', () => {
    expect(() => assertPublicEnvSafe({ VITE_PUBLISH_TOKEN: 't' }, { ...prod, acknowledged: true }))
      .not.toThrow();
  });

  it('never allows a secret-looking variable, even when acknowledged', () => {
    expect(() => assertPublicEnvSafe({ VITE_RAZORPAY_KEY_SECRET: 'x' }, { ...prod, acknowledged: true }))
      .toThrow(/VITE_RAZORPAY_KEY_SECRET/);
  });

  it('does not interfere with dev serving or non-production modes', () => {
    const env = { VITE_PUBLISH_TOKEN: 't' };
    expect(() => assertPublicEnvSafe(env, { command: 'serve', mode: 'development', acknowledged: false })).not.toThrow();
    expect(() => assertPublicEnvSafe(env, { command: 'build', mode: 'staging', acknowledged: false })).not.toThrow();
  });

  it('passes a clean production build', () => {
    expect(() => assertPublicEnvSafe({ VITE_SUPABASE_URL: 'https://x' }, prod)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/utils/__tests__/publicEnvGuard.test.ts`
Expected: FAIL, cannot resolve `../publicEnvGuard`.

- [ ] **Step 3: Implement** `src/utils/publicEnvGuard.ts`

```ts
/* Vite inlines every VITE_* variable into the JavaScript bundle served to
   anyone who opens the site. A value that authorises a privileged write is
   therefore not a secret. This guard stops a production build from shipping
   one by accident. */

export const PUBLISH_TOKEN_VAR = 'VITE_PUBLISH_TOKEN';

/** Set to "1" to knowingly ship the publish token until Phase 1 replaces it. */
export const ACK_VAR = 'ALLOW_PUBLIC_PUBLISH_TOKEN';

const SECRET_LIKE = /^VITE_.*(SECRET|SERVICE_ROLE|PRIVATE_KEY|WEBHOOK)/i;

type Env = Record<string, string | undefined>;

export function findForbiddenPublicEnv(env: Env): string[] {
  return Object.keys(env)
    .filter((key) => key === PUBLISH_TOKEN_VAR || SECRET_LIKE.test(key))
    .filter((key) => (env[key] ?? '').trim() !== '')
    .sort();
}

export interface GuardOptions {
  command: 'build' | 'serve';
  mode: string;
  acknowledged: boolean;
}

export function assertPublicEnvSafe(env: Env, opts: GuardOptions): void {
  if (opts.command !== 'build' || opts.mode !== 'production') return;

  const found = findForbiddenPublicEnv(env);
  if (found.length === 0) return;

  const hardBlocked = found.filter((key) => key !== PUBLISH_TOKEN_VAR);
  if (hardBlocked.length > 0) {
    throw new Error(
      `Refusing to build: ${hardBlocked.join(', ')} would be embedded in the public bundle. ` +
      'Secrets belong in Supabase function secrets, never in VITE_ variables.',
    );
  }

  if (opts.acknowledged) return;

  throw new Error(
    `Refusing to build: ${PUBLISH_TOKEN_VAR} would be embedded in the public bundle, where anyone ` +
    'can read it and use it to publish a menu or write bills. Remove it, or set ' +
    `${ACK_VAR}=1 to ship it knowingly until the token-based functions are replaced.`,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/__tests__/publicEnvGuard.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Wire it into `vite.config.ts`.** Replace the file with:

```ts
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'
import { ACK_VAR, assertPublicEnvSafe } from './src/utils/publicEnvGuard.ts'

export default defineConfig(({ command, mode }) => {
  // Fails the build, before anything is emitted, if a secret-like VITE_ value
  // would be inlined into the public bundle.
  assertPublicEnvSafe(
    { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env },
    { command, mode, acknowledged: process.env[ACK_VAR] === '1' },
  )

  return {
    plugins: [
      react(),
      tailwindcss(),
      // The till must open and take payments with no network at all, so the
      // whole app shell is precached. (Plan §32)
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        workbox: {
          // Product photos must precache too — without webp here the POS shows
          // broken images the moment it goes offline.
          globPatterns: ['**/*.{js,css,html,svg,woff2,webp,png,ico}'],
          // The photo set pushes the bundle past the default 2 MiB cap.
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          navigateFallback: 'index.html',
          // The till's offline shell must never be served to a customer's phone.
          // Customer routes always go to the network for a fresh document.
          navigateFallbackDenylist: [/^\/order/, /^\/kitchen/],
        },
        manifest: {
          name: 'THANJAI CAFE — Billing',
          short_name: 'THANJAI CAFE',
          description: 'Point of sale and billing for a coffee shop.',
          theme_color: '#6b3f22',
          background_color: '#f7f2ea',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
  }
})
```

- [ ] **Step 6: Verify the guard end to end**

```bash
VITE_PUBLISH_TOKEN=x npm run build
```
Expected: FAIL with `Refusing to build: VITE_PUBLISH_TOKEN would be embedded...`.

```bash
ALLOW_PUBLIC_PUBLISH_TOKEN=1 VITE_PUBLISH_TOKEN=x npm run build
```
Expected: succeeds.

```bash
VITE_RAZORPAY_KEY_SECRET=x ALLOW_PUBLIC_PUBLISH_TOKEN=1 npm run build
```
Expected: FAILS naming `VITE_RAZORPAY_KEY_SECRET`.

Note: if your own `.env.local` contains `VITE_PUBLISH_TOKEN` (it probably does), a plain `npm run build` also fails now. That is the guard working. Use `ALLOW_PUBLIC_PUBLISH_TOKEN=1` locally until Phase 1, or remove the line for local builds. Vercel builds need the same variable set, or the token removed from the Vercel project.

- [ ] **Step 7: Full check**

```bash
npm test && npm run lint
```
Expected: pass, count = BASELINE + 10.

- [ ] **Step 8: Commit**

```bash
git add src/utils/publicEnvGuard.ts src/utils/__tests__/publicEnvGuard.test.ts vite.config.ts
git commit -m "feat: block secret-like VITE_ values from production builds"
```

---

### Task 4: Migrations as code and CI

**Files:**
- Create: `supabase/config.toml` (generated)
- Create: `supabase/migrations/0003_reserved.sql`
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`, `supabase/README.md`

**Interfaces:** Consumes: existing `supabase/migrations/0001,0002,0004,0005`. Produces: a linked project whose remote history matches local files, so `npx supabase db push` works and Task 5 can add a migration.

- [ ] **Step 1: Initialise the CLI config**

```bash
npx supabase init --help
npx supabase init
```
Decline any editor-settings prompts. Expected: `supabase/config.toml` exists.

- [ ] **Step 2: Ignore CLI scratch folders**

```bash
printf '\n# Supabase CLI scratch\nsupabase/.temp/\nsupabase/.branches/\n' >> .gitignore
git status --short
```
Expected: `supabase/.temp/` no longer listed.

- [ ] **Step 3: Reserve migration number 0003**

Create `supabase/migrations/0003_reserved.sql`:

```sql
-- 0003 was never applied to any database: the migration it once named was
-- dropped before release. The number is reserved so history reads 0001..0005
-- without a gap and `supabase db push` has nothing to reconcile.
select 1;
```

- [ ] **Step 4: Find out what the live database already has** (read-only)

```bash
npx supabase login
npx supabase link --project-ref hiwufsjnhfrzevjvfefp
npx supabase db query --help
npx supabase migration list --linked
```
If asked for the database password, type it interactively (dashboard → Project Settings → Database); never write it to a file. Then:

```bash
npx supabase db query --linked "select to_regclass('public.menu_items') as menu, to_regclass('public.orders') as orders, to_regclass('public.pending_orders') as drafts, to_regclass('public.bills') as bills, to_regclass('public.day_closes') as closes"
```
Mapping: `menu`/`orders` present means 0001 and 0002 were applied; `drafts` present means 0004; `bills`/`closes` present means 0005.

- [ ] **Step 5: Mark what is already applied so history matches** (touches only the migration-history table on the live project; get the owner's go-ahead first)

```bash
npx supabase migration repair --status applied 0001 0002 0003
# only for the ones Step 4 showed as present:
npx supabase migration repair --status applied 0004
npx supabase migration repair --status applied 0005
npx supabase migration list --linked
```
Expected: Local and Remote columns agree for every migration that exists remotely. If the CLI rejects the `000N_` names (error about an invalid version or file-name pattern), rename with `git mv` to `20260908000001_qr_ordering.sql`, `20260908000002_rls.sql`, `20260908000003_reserved.sql`, `20260908000004_no_signin_pending_orders.sql`, `20260908000005_bill_backup.sql`, and repeat this step with those versions.

- [ ] **Step 6: Dry-run a push**

```bash
npx supabase db push --dry-run
```
Expected: reports nothing to apply if 0004 and 0005 were already applied; otherwise lists exactly those two. If they are listed, run `npx supabase db push` once, then re-run the dry run for "up to date".

- [ ] **Step 7: Retire the paste-in bundles.** `apply-migrations.sql`, `-2.sql` and `-3.sql` are gitignored and now redundant. Delete them locally once Step 6 is clean:

```bash
rm apply-migrations.sql apply-migrations-2.sql apply-migrations-3.sql
```

- [ ] **Step 8: Add CI.** Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```
If `npm ci` fails on Linux with a missing native binding for Rolldown or Oxlint, change `runs-on` to `windows-latest` (the lockfile was produced on Windows).

- [ ] **Step 9: Update `supabase/README.md`.** Replace the "Applying migrations" section with:

```markdown
## Applying migrations

Migrations are code. Never paste SQL into the dashboard to change the schema.

```bash
npx supabase migration new <name>   # creates supabase/migrations/<timestamp>_<name>.sql
npx supabase db push --dry-run      # preview
npx supabase db push                # apply
```

Every migration enables RLS on its tables and includes explicit GRANTs.

## Public environment variables

Every `VITE_*` value is public. `npm run build` refuses to ship `VITE_PUBLISH_TOKEN` or any
secret-looking `VITE_` value unless `ALLOW_PUBLIC_PUBLISH_TOKEN=1` is set (token only).
```

- [ ] **Step 10: Verify and commit**

```bash
npm test && npm run lint && npm run build
git add supabase/config.toml supabase/migrations/0003_reserved.sql .github/workflows/ci.yml .gitignore supabase/README.md
git commit -m "chore: migrations as code, reserve 0003, add CI"
```
Then (with the owner's approval) push the branch and confirm the workflow passes: `git push -u origin phase0/hardening` and `gh run watch`.

---

### Task 5: Harden `create-order` (CORS allow-list and rate limit)

**Files:**
- Create: `supabase/functions/_shared/cors.ts`, `supabase/functions/_shared/__tests__/cors.test.ts`
- Create: `supabase/functions/_shared/rateLimit.ts`, `supabase/functions/_shared/__tests__/rateLimit.test.ts`
- Create: `supabase/migrations/<timestamp>_rate_limits.sql` (via the CLI)
- Modify: `supabase/functions/create-order/index.ts` (full replacement below)

**Interfaces:**
- Produces: `buildCorsHeaders(origin: string | null, allowedCsv: string | undefined): { headers: Record<string,string>; allowed: boolean }`; `clientIp(req: Request): string`; `rateLimitKey(scope: string, ...parts: string[]): string`; `isOverLimit(count: number, max: number): boolean`; `CREATE_ORDER_LIMITS`; SQL `public.bump_rate_limit(p_key text, p_window_seconds int) returns int` (service_role only).

- [ ] **Step 1: Write the failing CORS test** `supabase/functions/_shared/__tests__/cors.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildCorsHeaders, parseAllowedOrigins } from '../cors.ts';

describe('parseAllowedOrigins', () => {
  it('trims entries and drops empties', () => {
    expect(parseAllowedOrigins(' https://a.app , ,http://localhost:5173 ')).toEqual(['https://a.app', 'http://localhost:5173']);
  });
  it('treats undefined as no list', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe('buildCorsHeaders', () => {
  it('stays open when no allow-list is configured, so a missing secret never stops ordering', () => {
    for (const csv of [undefined, '', '  ']) {
      const r = buildCorsHeaders('https://anything.example', csv);
      expect(r.allowed).toBe(true);
      expect(r.headers['Access-Control-Allow-Origin']).toBe('*');
    }
  });

  it('echoes an allowed origin exactly', () => {
    const r = buildCorsHeaders('https://cafe.app', 'https://cafe.app,http://localhost:5173');
    expect(r.allowed).toBe(true);
    expect(r.headers['Access-Control-Allow-Origin']).toBe('https://cafe.app');
  });

  it('rejects an origin that is not on the list', () => {
    const r = buildCorsHeaders('https://evil.example', 'https://cafe.app');
    expect(r.allowed).toBe(false);
    expect(r.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('rejects a missing Origin when a list is configured', () => {
    expect(buildCorsHeaders(null, 'https://cafe.app').allowed).toBe(false);
  });

  it('always sends Vary and the headers supabase-js needs', () => {
    const r = buildCorsHeaders('https://cafe.app', 'https://cafe.app');
    expect(r.headers['Vary']).toBe('Origin');
    expect(r.headers['Access-Control-Allow-Headers']).toContain('apikey');
    expect(r.headers['Access-Control-Allow-Headers']).toContain('x-client-info');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run supabase/functions/_shared/__tests__/cors.test.ts`
Expected: FAIL, cannot resolve `../cors.ts`.

- [ ] **Step 3: Implement** `supabase/functions/_shared/cors.ts`

```ts
/* CORS for the anonymous, browser-called edge functions.

   An allow-list stops other websites from driving a diner's browser at these
   endpoints. It is NOT authentication: any non-browser client can send any
   Origin header it likes, so rate limiting is the real defence. */

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';

export interface CorsDecision {
  headers: Record<string, string>;
  allowed: boolean;
}

export function parseAllowedOrigins(csv: string | undefined): string[] {
  return (csv ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function buildCorsHeaders(origin: string | null, allowedCsv: string | undefined): CorsDecision {
  const base = {
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const allowList = parseAllowedOrigins(allowedCsv);

  // Not configured: keep the historical open behaviour.
  if (allowList.length === 0) {
    return { headers: { ...base, 'Access-Control-Allow-Origin': '*' }, allowed: true };
  }
  if (origin && allowList.includes(origin)) {
    return { headers: { ...base, 'Access-Control-Allow-Origin': origin }, allowed: true };
  }
  return { headers: base, allowed: false };
}
```

- [ ] **Step 4: Run** `npx vitest run supabase/functions/_shared/__tests__/cors.test.ts` → PASS.

- [ ] **Step 5: Write the failing rate-limit test** `supabase/functions/_shared/__tests__/rateLimit.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { CREATE_ORDER_LIMITS, clientIp, isOverLimit, rateLimitKey } from '../rateLimit.ts';

const req = (headers: Record<string, string>) => new Request('https://x.test/', { headers });

describe('clientIp', () => {
  it('uses the first x-forwarded-for entry', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });
  it('falls back to cf-connecting-ip', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '198.51.100.4' }))).toBe('198.51.100.4');
  });
  it('returns unknown when nothing identifies the caller', () => {
    expect(clientIp(req({}))).toBe('unknown');
  });
});

describe('rateLimitKey', () => {
  it('joins scope and parts', () => {
    expect(rateLimitKey('create-order', '203.0.113.7', 'T04')).toBe('create-order:203.0.113.7:T04');
  });
  it('replaces unsafe characters and truncates long parts', () => {
    expect(rateLimitKey('s', 'a b/c')).toBe('s:a_b_c');
    expect(rateLimitKey('s', 'x'.repeat(200))).toBe(`s:${'x'.repeat(64)}`);
  });
});

describe('isOverLimit', () => {
  it('allows exactly the maximum and blocks the next call', () => {
    expect(isOverLimit(10, 10)).toBe(false);
    expect(isOverLimit(11, 10)).toBe(true);
  });
  it('treats a non-numeric count as not over, so a broken counter cannot block orders', () => {
    expect(isOverLimit(Number.NaN, 10)).toBe(false);
  });
});

describe('CREATE_ORDER_LIMITS', () => {
  it('lets a whole table burst higher than a single caller', () => {
    expect(CREATE_ORDER_LIMITS.perTable.max).toBeGreaterThan(CREATE_ORDER_LIMITS.perIpPerTable.max);
  });
});
```

- [ ] **Step 6: Run it to verify it fails** (`npx vitest run supabase/functions/_shared/__tests__/rateLimit.test.ts` → cannot resolve).

- [ ] **Step 7: Implement** `supabase/functions/_shared/rateLimit.ts`

```ts
/* Helpers for the fixed-window limiter in Postgres (public.bump_rate_limit).
   The counter lives in the database so it holds across edge-function instances. */

export const CREATE_ORDER_LIMITS = {
  perIpPerTable: { max: 10, windowSeconds: 60 },
  perTable: { max: 60, windowSeconds: 60 },
} as const;

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

export function rateLimitKey(scope: string, ...parts: string[]): string {
  const clean = parts.map((p) => p.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 64));
  return [scope, ...clean].join(':');
}

export function isOverLimit(count: number, max: number): boolean {
  return Number.isFinite(count) && count > max;
}
```

- [ ] **Step 8: Run** `npx vitest run supabase/functions/_shared/__tests__/rateLimit.test.ts` → PASS.

- [ ] **Step 9: Create the migration**

```bash
npx supabase migration new rate_limits
```
Write the SQL into the file it prints:

```sql
-- Fixed-window rate limiter for anonymous edge functions.
create table if not exists public.rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;
-- No policies: deny-all for anon and authenticated. service_role bypasses RLS.
revoke all on table public.rate_limits from anon, authenticated;

create or replace function public.bump_rate_limit(p_key text, p_window_seconds int)
returns int
language plpgsql
as $$
declare
  v_window timestamptz;
  v_count  int;
begin
  if p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'window out of range';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  -- Cheap housekeeping on about 1% of calls; nothing reads old windows.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count;
end;
$$;

revoke all on function public.bump_rate_limit(text, int) from public, anon, authenticated;
grant execute on function public.bump_rate_limit(text, int) to service_role;
```

- [ ] **Step 10: Replace `supabase/functions/create-order/index.ts`** with:

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { priceOrder, type RequestedLine } from './pricing.ts';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { CREATE_ORDER_LIMITS, clientIp, isOverLimit, rateLimitKey } from '../_shared/rateLimit.ts';

/* Prices a cart and opens a Razorpay payment for it.

   It writes a DRAFT to `pending_orders`, never to `orders`. Staff surfaces read
   `orders` only, so nothing reaches the kitchen or the billing portal until the
   signed webhook confirms the money arrived — that is the shop's rule, and this
   is the half of it that lives here.

   There is no sign-in. A diner gives nothing: the order is identified by the
   table they scanned and the token called out to them. So every value in the
   request is untrusted, and the prices come from the published menu — never
   from the phone. The endpoint is anonymous and money follows it, so callers
   are also rate limited per table. */

Deno.serve(async (req) => {
  const { headers: cors, allowed } = buildCorsHeaders(
    req.headers.get('origin'),
    Deno.env.get('ALLOWED_ORIGINS'),
  );

  if (req.method === 'OPTIONS') {
    return new Response(allowed ? 'ok' : 'forbidden', { status: allowed ? 200 : 403, headers: cors });
  }
  if (!allowed) return json({ error: 'This origin is not allowed.' }, 403, cors);

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json() as { tableCode?: string; lines?: RequestedLine[] };

    /* A table code is required and shape-checked. It is printed on the QR cards
       the shop puts out, so anything else is a hand-edited URL. It reaches the
       kitchen ticket, so it must not carry markup or run long. */
    const tableCode = (body.tableCode ?? '').trim();
    if (!/^[A-Za-z0-9 _-]{1,12}$/.test(tableCode)) {
      return json({ error: 'This link is missing a valid table. Please rescan the code on your table.' }, 400, cors);
    }

    /* Bound how fast one caller, and one table, can open orders. If the limiter
       itself fails we log and carry on: a broken counter must never stop a
       diner from paying. */
    const ip = clientIp(req);
    const [perIp, perTable] = await Promise.all([
      admin.rpc('bump_rate_limit', {
        p_key: rateLimitKey('create-order', ip, tableCode),
        p_window_seconds: CREATE_ORDER_LIMITS.perIpPerTable.windowSeconds,
      }),
      admin.rpc('bump_rate_limit', {
        p_key: rateLimitKey('create-order', 'table', tableCode),
        p_window_seconds: CREATE_ORDER_LIMITS.perTable.windowSeconds,
      }),
    ]);
    if (perIp.error || perTable.error) {
      console.error('create-order: rate limiter unavailable', perIp.error ?? perTable.error);
    } else if (
      isOverLimit(Number(perIp.data), CREATE_ORDER_LIMITS.perIpPerTable.max) ||
      isOverLimit(Number(perTable.data), CREATE_ORDER_LIMITS.perTable.max)
    ) {
      return json(
        { error: 'Too many orders from this table right now. Please wait a minute and try again.' },
        429, cors, { 'Retry-After': '60' },
      );
    }

    const { data: menu, error: menuErr } = await admin
      .from('menu_items').select('id, name, price, tax_rate, available');
    if (menuErr) {
      console.error('create-order: menu read failed', menuErr);
      return json({ error: 'Could not load the menu. Please try again.' }, 500, cors);
    }

    // Repriced from the published menu. The phone's prices are display only.
    const { lines, totals } = priceOrder(body.lines ?? [], menu ?? []);

    // Razorpay's minimum is 100 paise; a smaller total would fail there with a
    // message a diner cannot act on.
    if (Math.round(totals.total * 100) < 100) {
      return json({ error: 'This order is below the minimum online payment of ₹1. Please order at the counter.' }, 400, cors);
    }

    const { data: tokenRow, error: tokenErr } = await admin.rpc('next_order_token');
    if (tokenErr) {
      console.error('create-order: token allocation failed', tokenErr);
      return json({ error: 'Could not start the order. Please try again.' }, 500, cors);
    }
    const token = String(tokenRow ?? 'A-00');

    /* The draft carries everything needed to build the real order later, so a
       customer who has paid can never be left without one. */
    const { data: draft, error: draftErr } = await admin.from('pending_orders').insert({
      token,
      table_code: tableCode,
      lines,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    }).select().single();

    if (draftErr) {
      console.error('create-order: draft insert failed', draftErr);
      return json({ error: 'Could not start the order. Please try again.' }, 500, cors);
    }

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
        receipt: draft.id,
        notes: { draft_id: draft.id, table: tableCode, token },
      }),
    });

    if (!rzpRes.ok) {
      // No payment can happen, so the draft is litter. Remove it now rather
      // than leaving it for the purge.
      await admin.from('pending_orders').delete().eq('id', draft.id);
      console.error('create-order: razorpay rejected the order', await rzpRes.text());
      return json({ error: 'Could not start the payment. Please try again.' }, 502, cors);
    }

    const rzp = await rzpRes.json();

    /* Linking the draft to the Razorpay order is what lets the webhook find it.
       If this fails the customer could pay with nothing to promote, so the
       payment is abandoned before it can be taken. */
    const { error: linkErr } = await admin.from('pending_orders')
      .update({ razorpay_order_id: rzp.id }).eq('id', draft.id);
    if (linkErr) {
      await admin.from('pending_orders').delete().eq('id', draft.id);
      console.error('create-order: could not link draft to razorpay order', linkErr);
      return json({ error: 'Could not start the payment. Please try again.' }, 500, cors);
    }

    return json({
      draftId: draft.id,
      token,
      tableCode,
      razorpayOrderId: rzp.id,
      amount: rzp.amount,
      currency: rzp.currency,
      keyId,
    }, 200, cors);
  } catch (err) {
    // priceOrder's messages are deliberately specific — they name a sold-out
    // item or a bad quantity, which is something the diner can fix.
    return json({ error: err instanceof Error ? err.message : 'Could not create the order' }, 400, cors);
  }
});

const json = (
  body: unknown,
  status: number,
  cors: Record<string, string>,
  extra: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extra, 'Content-Type': 'application/json' },
  });
```

- [ ] **Step 11: Full check**

```bash
npm test && npm run lint
```
Expected: pass (BASELINE + 10 + the new CORS and rate-limit tests).

- [ ] **Step 12: Apply and deploy** (production; owner's go-ahead first)

```bash
npx supabase db push
npx supabase secrets set ALLOWED_ORIGINS="<your deployed site origin, scheme + host, no trailing slash>,http://localhost:5173"
npx supabase functions deploy create-order
npx supabase db query --linked "select public.bump_rate_limit('verify:x', 60) as a, public.bump_rate_limit('verify:x', 60) as b"
npx supabase db query --linked "delete from public.rate_limits where key = 'verify:x'"
```
Expected: the query returns `a = 1`, `b = 2`.

- [ ] **Step 13: Verify from outside.** Set `FN=https://hiwufsjnhfrzevjvfefp.supabase.co/functions/v1/create-order`, `ANON` to the publishable key from the dashboard, and `ORIGIN` to your allowed origin.

```bash
# disallowed origin -> 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$FN" -H "Origin: https://evil.example" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"tableCode":"RL-TEST","lines":[]}'
# 12 calls from an allowed origin: first 10 return 400 (empty cart), then 429
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST "$FN" -H "Origin: $ORIGIN" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"tableCode":"RL-TEST","lines":[]}'; done; echo
# anon cannot call the limiter directly (expect 401/403/404, not 200)
curl -s -o /dev/null -w "%{http_code}\n" -X POST "${FN%/functions/v1/create-order}/rest/v1/rpc/bump_rate_limit" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"p_key":"x","p_window_seconds":60}'
```
Then clear the test rows: `npx supabase db query --linked "delete from public.rate_limits where key like 'create-order:%RL-TEST%'"`.

- [ ] **Step 14: Commit**

```bash
git add supabase/functions/_shared supabase/functions/create-order/index.ts supabase/migrations/*_rate_limits.sql
git commit -m "feat: rate limit and origin allow-list for create-order"
```

---

### Task 6: A kitchen screen must not bill orders

**Files:**
- Modify: `src/features/orders/useOrderIntake.ts`, `src/pages/Kitchen/KitchenPage.tsx`
- Test: `src/features/orders/__tests__/ordersToClaim.test.ts`

**Interfaces:**
- Produces: `ordersToClaim(list: CloudOrder[], createBills: boolean): CloudOrder[]`; `useOrderIntake(enabled: boolean, options?: { createBills?: boolean })` now also returns `loaded: boolean`.
- Consumes: `CloudOrder` from `@/types/order`.

- [ ] **Step 1: Write the failing test** `src/features/orders/__tests__/ordersToClaim.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ordersToClaim } from '../useOrderIntake';
import type { CloudOrder } from '@/types/order';

const order = (id: string, status: CloudOrder['status']): CloudOrder => ({
  id, token: `A-${id}`, tableCode: 'T04', customerId: null,
  customerName: '', customerPhone: '', status,
  subtotal: 95, tax: 4.75, total: 99.75,
  createdAt: '2026-09-10T10:00:00Z', lines: [],
});

describe('ordersToClaim', () => {
  const list = [order('1', 'PAID'), order('2', 'ACCEPTED'), order('3', 'PREPARING'), order('4', 'AWAITING_PAYMENT')];

  it('claims only PAID orders when this device is a till', () => {
    expect(ordersToClaim(list, true).map((o) => o.id)).toEqual(['1']);
  });

  it('claims nothing when this device does not bill, so a kitchen tablet never writes a bill', () => {
    expect(ordersToClaim(list, false)).toEqual([]);
  });

  it('never claims an unpaid order', () => {
    expect(ordersToClaim([order('9', 'AWAITING_PAYMENT'), order('8', 'PAYMENT_FAILED')], true)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/orders/__tests__/ordersToClaim.test.ts`
Expected: FAIL, `ordersToClaim` is not exported.

- [ ] **Step 3: Edit `src/features/orders/useOrderIntake.ts`** with five edits.

(a) Insert before the comment `/** An order that was paid for but could not be turned into a bill. */`:

```ts
/** The orders this device should claim and bill. A kitchen screen passes
    createBills=false: it displays orders, and must not write a bill into its own
    local database where the till would never see it. */
export function ordersToClaim(list: CloudOrder[], createBills: boolean): CloudOrder[] {
  return createBills ? list.filter((o) => o.status === 'PAID') : [];
}

```

(b) Replace `export function useOrderIntake(enabled: boolean) {` with:

```ts
export function useOrderIntake(enabled: boolean, options: { createBills?: boolean } = {}) {
  const createBills = options.createBills ?? true;
```

(c) Replace `  const [error, setError] = useState<string | null>(null);` with:

```ts
  const [error, setError] = useState<string | null>(null);
  /* True once the first fetch has succeeded. Consumers that must not react to
     what was already on the board at load (auto-print) wait for this. */
  const [loaded, setLoaded] = useState(false);
```

(d) Replace `        setOrders(list);\n        setError(null);` with:

```ts
        setOrders(list);
        setError(null);
        setLoaded(true);
```

(e) Replace `        for (const order of list.filter((o) => o.status === 'PAID')) {` with `        for (const order of ordersToClaim(list, createBills)) {`, replace `  }, [enabled]);` with `  }, [enabled, createBills]);`, and replace `  return { orders, error, problems };` with `  return { orders, error, problems, loaded };`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/orders`
Expected: PASS, including the existing `claim.test.ts` and `alerts.test.ts`.

- [ ] **Step 5: Stop the kitchen screen from billing.** In `src/pages/Kitchen/KitchenPage.tsx` replace `  const { orders, error } = useOrderIntake(true);` with:

```tsx
  // The kitchen displays orders; only a till bills them (see ordersToClaim).
  const { orders, error } = useOrderIntake(true, { createBills: false });
```

- [ ] **Step 6: Full check and commit**

```bash
npm test && npm run lint && npm run build
git add src/features/orders/useOrderIntake.ts src/features/orders/__tests__/ordersToClaim.test.ts src/pages/Kitchen/KitchenPage.tsx
git commit -m "fix: kitchen screen no longer bills orders into its own local database"
```

---

### Task 7: Auto-print the KOT on the kitchen screen

**Files:**
- Create: `src/features/orders/useKotAutoPrint.ts`
- Test: `src/features/orders/__tests__/kotAutoPrint.test.ts`
- Modify: `src/types/index.ts`, `src/data/defaults.ts`, `src/pages/Settings/SettingsPage.tsx`, `src/pages/Kitchen/KitchenPage.tsx`

**Interfaces:**
- Consumes: `printKot(order: CloudOrder, businessName: string): void` from `@/services/billing/kot`; `loaded` from Task 6.
- Produces: `selectOrdersToAutoPrint(current, alreadyPrinted, firstLoad)`, `rememberPrinted(existing, newIds, keep?)`, `useKotAutoPrint(orders, enabled, businessName)`; setting `receipt.autoPrintKot?: boolean` (default false).

- [ ] **Step 1: Write the failing test** `src/features/orders/__tests__/kotAutoPrint.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { rememberPrinted, selectOrdersToAutoPrint } from '../useKotAutoPrint';
import type { CloudOrder } from '@/types/order';

const order = (id: string, status: CloudOrder['status'] = 'PAID'): CloudOrder => ({
  id, token: `A-${id}`, tableCode: 'T04', customerId: null,
  customerName: '', customerPhone: '', status,
  subtotal: 95, tax: 4.75, total: 99.75,
  createdAt: '2026-09-10T10:00:00Z', lines: [],
});

describe('selectOrdersToAutoPrint', () => {
  it('prints nothing on the first load: what is already on the board is handled', () => {
    expect(selectOrdersToAutoPrint([order('1'), order('2')], new Set(), true)).toEqual([]);
  });

  it('prints a new paid order once', () => {
    const printed = new Set<string>();
    expect(selectOrdersToAutoPrint([order('1')], printed, false).map((o) => o.id)).toEqual(['1']);
    printed.add('1');
    expect(selectOrdersToAutoPrint([order('1')], printed, false)).toEqual([]);
  });

  it('also prints an order another till already moved to ACCEPTED', () => {
    expect(selectOrdersToAutoPrint([order('1', 'ACCEPTED')], new Set(), false).map((o) => o.id)).toEqual(['1']);
  });

  it('never prints an order that is already being prepared, ready or unpaid', () => {
    const list = [order('1', 'PREPARING'), order('2', 'READY'), order('3', 'AWAITING_PAYMENT'), order('4', 'CANCELLED')];
    expect(selectOrdersToAutoPrint(list, new Set(), false)).toEqual([]);
  });
});

describe('rememberPrinted', () => {
  it('appends new ids without duplicates', () => {
    expect(rememberPrinted(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('keeps only the most recent entries', () => {
    expect(rememberPrinted(['a', 'b', 'c'], ['d'], 3)).toEqual(['b', 'c', 'd']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/orders/__tests__/kotAutoPrint.test.ts`
Expected: FAIL, cannot resolve `../useKotAutoPrint`.

- [ ] **Step 3: Implement** `src/features/orders/useKotAutoPrint.ts`

```ts
import { useEffect, useRef } from 'react';
import { printKot } from '@/services/billing/kot';
import type { CloudOrder } from '@/types/order';

/* Fires the kitchen ticket the moment a paid order reaches the kitchen screen.

   Deciding WHAT to print is pure and tested. The rules:
   - Whatever is on the board when the screen opens counts as already handled,
     so reopening the page never reprints the queue.
   - A ticket prints once per order, remembered across reloads.
   - Only orders that are paid and not yet being cooked print. */

const PRINTED_KEY = 'kot-printed-ids';
const KEEP = 300;
const STAGGER_MS = 1500;

/** PAID, or ACCEPTED when a till claimed it first. Never anything unpaid. */
export const AUTO_PRINT_STATUSES: readonly CloudOrder['status'][] = ['PAID', 'ACCEPTED'];

export function selectOrdersToAutoPrint(
  current: CloudOrder[],
  alreadyPrinted: ReadonlySet<string>,
  firstLoad: boolean,
): CloudOrder[] {
  if (firstLoad) return [];
  return current.filter((o) => AUTO_PRINT_STATUSES.includes(o.status) && !alreadyPrinted.has(o.id));
}

export function rememberPrinted(existing: readonly string[], newIds: readonly string[], keep = KEEP): string[] {
  return [...existing, ...newIds.filter((id) => !existing.includes(id))].slice(-keep);
}

function loadPrinted(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PRINTED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function savePrinted(ids: string[]): void {
  try {
    localStorage.setItem(PRINTED_KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked: the worst case is a repeat print after a reload.
  }
}

/** `enabled` should be `loaded && setting`, so the first real load is the
    baseline rather than an empty initial state. */
export function useKotAutoPrint(orders: CloudOrder[], enabled: boolean, businessName: string): void {
  const baselineTaken = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const printed = loadPrinted();
    const firstLoad = !baselineTaken.current;
    baselineTaken.current = true;

    if (firstLoad) {
      savePrinted(rememberPrinted(printed, orders.map((o) => o.id)));
      return;
    }

    const toPrint = selectOrdersToAutoPrint(orders, new Set(printed), false);
    if (!toPrint.length) return;

    savePrinted(rememberPrinted(printed, toPrint.map((o) => o.id)));
    toPrint.forEach((order, i) => {
      setTimeout(() => {
        try {
          printKot(order, businessName);
        } catch (err) {
          console.error(`Could not auto-print the KOT for ${order.token}:`, err);
        }
      }, i * STAGGER_MS);
    });
  }, [orders, enabled, businessName]);
}
```

- [ ] **Step 4: Run** `npx vitest run src/features/orders/__tests__/kotAutoPrint.test.ts` → PASS (6 tests).

- [ ] **Step 5: Add the setting.**

In `src/types/index.ts`, replace `  autoPrint: boolean;` with:

```ts
  autoPrint: boolean;
  /** Print a KOT automatically when a paid order reaches the kitchen screen. */
  autoPrintKot?: boolean;
```

In `src/data/defaults.ts`, replace `  receipt: { size: '80mm', printerName: '', autoPrint: false, printDuplicate: false },` with:

```ts
  receipt: { size: '80mm', printerName: '', autoPrint: false, autoPrintKot: false, printDuplicate: false },
```

In `src/pages/Settings/SettingsPage.tsx`, insert before the `<ToggleRow` whose label is `"Print duplicate copy"`:

```tsx
        <ToggleRow
          label="Auto print kitchen tickets"
          description="Prints a KOT as soon as a paid QR order reaches the kitchen screen. For a print with no dialog, open the kitchen browser with the --kiosk-printing flag."
          checked={form.autoPrintKot ?? false}
          onChange={(v) => set('autoPrintKot', v)}
        />
```

- [ ] **Step 6: Use it on the kitchen screen.** In `src/pages/Kitchen/KitchenPage.tsx` add the import `import { useKotAutoPrint } from '@/features/orders/useKotAutoPrint';` and replace the two lines from Task 6 (`useOrderIntake` call and comment) with:

```tsx
  const autoPrintKot = useAppStore((s) => s.settings.receipt.autoPrintKot ?? false);
  // The kitchen displays orders; only a till bills them (see ordersToClaim).
  const { orders, error, loaded } = useOrderIntake(true, { createBills: false });
  useKotAutoPrint(orders, loaded && autoPrintKot, businessName);
```
Keep it above the `useState`/`useEffect` calls and before the `if (!isCloudConfigured())` early return, so hook order never changes.

- [ ] **Step 7: Full check**

```bash
npm test && npm run lint && npm run build
```
Expected: pass.

- [ ] **Step 8: Manual check** (production data; use the clearly labelled test token and clean up). Start the app with `npm run dev`, sign in as owner, Settings → Receipt & Printer → switch on "Auto print kitchen tickets" → Save. Open `/kitchen` and wait for the first load. In the Supabase SQL editor run:

```sql
with o as (
  insert into orders (token, table_code, status, subtotal, tax, total, paid_at)
  values ('Z-99', 'T99', 'PAID', 95, 4.75, 99.75, now()) returning id)
insert into order_lines (order_id, product_id, name, unit_price, qty, tax_rate)
select id, 'test-product', 'Test Filter Coffee', 47.5, 2, 5 from o;
```
Expected: within a few seconds the print dialog opens for ticket `Z-99`, and no bill is created on the kitchen device (Bill History unchanged). Reload `/kitchen`: no reprint. Then clean up: `delete from orders where token = 'Z-99';`

- [ ] **Step 9: Commit**

```bash
git add src/features/orders/useKotAutoPrint.ts src/features/orders/__tests__/kotAutoPrint.test.ts src/types/index.ts src/data/defaults.ts src/pages/Settings/SettingsPage.tsx src/pages/Kitchen/KitchenPage.tsx
git commit -m "feat: optionally auto-print the KOT when a paid order reaches the kitchen"
```

---

### Task 8: Phase 0 exit

**Files:** none changed.

- [ ] **Step 1: Full verification**

```bash
npm ci && npm test && npm run lint && ALLOW_PUBLIC_PUBLISH_TOKEN=1 npm run build
```
Expected: pass; test count is at least BASELINE + 10 (guard) + 15 (CORS 7, rate limit 8) + 3 (claim) + 6 (auto-print).

- [ ] **Step 2: Happy-path payment on the deployed preview.** Follow the "Then tell me" section of `DEPLOY-STEPS.md` (Razorpay test card `4111 1111 1111 1111`). Expected: the order reaches `/kitchen`, the KOT auto-prints if enabled, a bill appears only on the till, and after rotation the payment still confirms (proves the new secrets work).

- [ ] **Step 3: Protect the public site.** While `VITE_PUBLISH_TOKEN` still ships (acknowledged build), enable Vercel deployment protection for preview deployments, and do not deploy `publish-menu` or `backup-bills` to any public URL until Phase 1 replaces them.

- [ ] **Step 4: Open the PR** (with the owner's approval): `git push -u origin phase0/hardening` then `gh pr create --title "Phase 0 hardening" --body "<BASELINE count, what changed per task, manual checks done>"`.

- [ ] **Step 5: Phase 0 done.** Tell the owner; the spike (Part B) can start in parallel.

---

# Part B: PowerSync spike (worktree `spike/powersync`, throwaway)

**Rule for the whole part:** the spike passes only if tests 1-5 all hold (spec section 16). A failure of any of 1-4 means fall back to custom sync on Dexie. Nothing here is merged; only the findings document (Task 17) is kept. Never point the spike at the production project.

### Task 9: Provision the spike environment (MANUAL, owner)

**Files:** none committed. Creates `.env.local` in the spike worktree only (gitignored by `*.local`).

**Interfaces:** Produces: a dev Supabase project, a PowerSync instance, and env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_POWERSYNC_URL`.

- [ ] **Step 1: Create the worktree** (a separate folder, so its `.env.local` can never override production settings):

```bash
cd "G:/DIGITAL_SERVICE/WEB/THECAFE/Repo-ThanjaiCafe-Billing-App/ThanjaiCafe-Billing-App"
git worktree add ../ThanjaiCafe-Billing-App-spike -b spike/powersync docs/cafe-billing-saas-design
cd ../ThanjaiCafe-Billing-App-spike
npm ci
```

- [ ] **Step 2: Create the dev Supabase project** in the dashboard (name `cafe-dev`, region closest to Chennai, for example Mumbai). This uses the second free project slot and stays as the permanent dev/staging project. Copy the project URL and the publishable (anon) key into `.env.local` in the spike worktree:

```
VITE_SUPABASE_URL=https://<spike-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
VITE_POWERSYNC_URL=<filled in Step 5>
```

- [ ] **Step 3: Enable the Custom Access Token hook later** (Task 10 Step 3). Nothing to do yet.

- [ ] **Step 4: Create the PowerSync replication role and publication.** In the spike project's SQL editor run, after Task 10 Step 2 has created the tables, with a generated 32-character random password that you keep in your password manager (never commit it):

```sql
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD '<generated password>';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
CREATE PUBLICATION powersync FOR ALL TABLES;
```

- [ ] **Step 5: Create a PowerSync Cloud free instance** and connect it to the spike database by following <https://docs.powersync.com/integrations/supabase/guide>. Record in the findings doc (Task 17) whether the direct connection or the session pooler was needed (Supabase direct connections moved to IPv6). Copy the instance URL into `VITE_POWERSYNC_URL`. In the instance's client-auth settings, enable Supabase Auth (JWKS or the project JWT secret, per the guide).

- [ ] **Step 6: No commit.**

---

### Task 10: Spike backend: schema, RLS, access-token hook, sync streams, seed

**Files (all in the spike worktree):**
- Create: `spike/sql/001_spike_schema.sql`, `spike/powersync/sync-streams.yaml`, `spike/seed.mjs`

**Interfaces:** Produces: tables `shops`, `devices`, `products`, `bills`, `bill_lines`; a JWT carrying `shop_id` and `device_id`; three seeded devices (`A`/`T1`, `A`/`T2`, `B`/`T1`) whose logins are written to `spike-credentials.local`.

- [ ] **Step 1: Write** `spike/sql/001_spike_schema.sql`

```sql
-- Spike schema: production-shaped, minimal. Throwaway project only.
create extension if not exists pgcrypto;

create table public.shops (
  id   uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  auth_user_id uuid not null unique,
  code         text not null check (code ~ '^[A-Z0-9]{1,4}$'),
  revoked_at   timestamptz,
  unique (shop_id, code)
);

create table public.products (
  id          uuid primary key,
  shop_id     uuid not null references public.shops(id),
  name        text not null,
  unit        text not null default 'pcs',
  price_paise bigint not null check (price_paise >= 0),
  rev         int not null default 1,
  updated_at  timestamptz not null default now()
);

create table public.bills (
  id             uuid primary key,
  shop_id        uuid not null references public.shops(id),
  device_id      uuid not null references public.devices(id),
  invoice_no     text not null,
  fy             text not null,
  seq            int  not null,
  business_date  date not null,
  payment_method text not null,
  total_paise    bigint not null check (total_paise >= 0),
  created_at     timestamptz not null,
  received_at    timestamptz not null default now(),
  unique (shop_id, device_id, fy, seq)
);
create index bills_shop_created_idx on public.bills (shop_id, created_at desc);
create index bills_shop_date_idx on public.bills (shop_id, business_date);

create table public.bill_lines (
  id               uuid primary key,
  bill_id          uuid not null references public.bills(id),
  shop_id          uuid not null references public.shops(id),
  product_id       uuid not null,
  name             text not null,
  qty              numeric(12,3) not null check (qty > 0),
  unit             text not null,
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  line_total_paise bigint not null check (line_total_paise >= 0)
);
create index bill_lines_bill_idx on public.bill_lines (bill_id);
create index bill_lines_shop_idx on public.bill_lines (shop_id);

-- Transactions are append-only: a trigger blocks edits and deletes even for owners of the table.
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'append-only table: % cannot be edited', tg_table_name using errcode = '42501';
end $$;
create trigger bills_append_only before update or delete on public.bills
  for each row execute function public.forbid_mutation();
create trigger bill_lines_append_only before update or delete on public.bill_lines
  for each row execute function public.forbid_mutation();

-- RLS: a device sees and writes only its own shop, read from the JWT.
alter table public.shops      enable row level security;
alter table public.devices    enable row level security;
alter table public.products   enable row level security;
alter table public.bills      enable row level security;
alter table public.bill_lines enable row level security;

create policy shops_read on public.shops for select to authenticated
  using (id = ((select auth.jwt()) ->> 'shop_id')::uuid);
create policy devices_read on public.devices for select to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);

create policy products_read on public.products for select to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);
create policy products_insert on public.products for insert to authenticated
  with check (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);
create policy products_update on public.products for update to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid)
  with check (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);

create policy bills_read on public.bills for select to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);
create policy bills_insert on public.bills for insert to authenticated
  with check (
    shop_id   = ((select auth.jwt()) ->> 'shop_id')::uuid
    and device_id = ((select auth.jwt()) ->> 'device_id')::uuid
  );

create policy bill_lines_read on public.bill_lines for select to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);
create policy bill_lines_insert on public.bill_lines for insert to authenticated
  with check (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);

-- Explicit grants (Data API exposure is opt-in from 30 Oct 2026).
grant select on public.shops, public.devices to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert on public.bills, public.bill_lines to authenticated;

-- Custom access token hook: adds shop_id and device_id from the devices table,
-- never from anything the user can edit.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event -> 'claims';
  d      record;
begin
  select id, shop_id into d
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
grant select on table public.devices to supabase_auth_admin;
create policy devices_auth_admin_read on public.devices for select to supabase_auth_admin using (true);
```

- [ ] **Step 2: Run it** in the spike project's SQL editor. Expected: success, no errors. Then run the PowerSync role SQL from Task 9 Step 4.

- [ ] **Step 3: Enable the hook.** Dashboard → Authentication → Hooks → Custom Access Token → select `public.custom_access_token_hook` → save.

- [ ] **Step 4: Write** `spike/powersync/sync-streams.yaml` and paste it into the PowerSync instance (Sync Streams → edit → Deploy):

```yaml
config:
  edition: 3

streams:
  shop_data:
    auto_subscribe: true
    queries:
      - SELECT * FROM shops WHERE id = auth.parameter('shop_id')
      - SELECT * FROM devices WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM products WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM bills WHERE shop_id = auth.parameter('shop_id')
      - SELECT * FROM bill_lines WHERE shop_id = auth.parameter('shop_id')
```
If the dashboard rejects `auth.parameter('shop_id')`, use `auth.jwt() ->> 'shop_id'` instead. Record which form worked in the findings doc.

- [ ] **Step 5: Write** `spike/seed.mjs`

```js
// Seeds two shops and three devices into the SPIKE project. Reads the service-role key
// from your shell only; it is never written to a file.
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Set SPIKE_SUPABASE_URL and SPIKE_SERVICE_ROLE_KEY in your shell first.');
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const plan = [
  { name: 'Spike Cafe A', slug: 'a', devices: ['T1', 'T2'] },
  { name: 'Spike Cafe B', slug: 'b', devices: ['T1'] },
];
const productNames = ['Filter Coffee', 'Masala Tea', 'Vadai', 'Rava Kesari', 'Plum Cake (per kg)'];
const credentials = [];

for (const shop of plan) {
  const { data: shopRow, error: shopErr } = await admin.from('shops').insert({ name: shop.name }).select().single();
  if (shopErr) throw shopErr;

  await admin.from('products').insert(productNames.map((name, i) => ({
    id: randomUUID(), shop_id: shopRow.id, name,
    unit: name.includes('per kg') ? 'kg' : 'pcs', price_paise: 1500 + i * 2500,
  }))).throwOnError();

  for (const code of shop.devices) {
    const email = `${shop.slug}-${code.toLowerCase()}@spike.example.com`;
    const password = randomBytes(18).toString('base64url');
    const { data: user, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (userErr) throw userErr;
    const { data: dev, error: devErr } = await admin.from('devices')
      .insert({ shop_id: shopRow.id, auth_user_id: user.user.id, code }).select().single();
    if (devErr) throw devErr;
    credentials.push({ shop: shop.name, shopId: shopRow.id, code, deviceId: dev.id, email, password });
  }
}

writeFileSync('spike-credentials.local', JSON.stringify(credentials, null, 2));
console.log(`Seeded ${credentials.length} devices. Logins written to spike-credentials.local (gitignored).`);
```

- [ ] **Step 6: Run it**

```bash
export SPIKE_SUPABASE_URL="https://<spike-ref>.supabase.co"
export SPIKE_SERVICE_ROLE_KEY="<paste from dashboard, this shell only>"
node spike/seed.mjs
git check-ignore -v spike-credentials.local
```
Expected: `Seeded 3 devices...`, and `check-ignore` confirms the credentials file is ignored.

- [ ] **Step 7: Verify the seed.** In the SQL editor run `select code, shop_id from public.devices order by shop_id, code;`. Expected: 3 rows, two sharing one `shop_id`. The token claims themselves are asserted by Task 11's `deviceClaims` and by Task 13's script.

- [ ] **Step 8: Commit** (spike branch): `git add spike/sql spike/powersync spike/seed.mjs && git commit -m "spike: schema, RLS, access-token hook, sync streams, seed"`

---

### Task 11: Spike client helpers (pure, tested): invoice numbers, JWT claims, ESC/POS bytes

**Files (spike worktree):**
- Create: `src/spike/invoice.ts`, `src/spike/jwt.ts`, `src/spike/escpos.ts`
- Test: `src/spike/__tests__/invoice.test.ts`, `jwt.test.ts`, `escpos.test.ts`

**Interfaces:**
- Produces: `financialYear(date: Date): string`; `formatInvoiceNo(deviceCode: string, fy: string, seq: number): string`; `businessDate(date: Date, cutoverHour?: number): string`; `deviceClaims(token: string): { shopId: string; deviceId: string }`; `escposTestTicket(lines: string[], opts?: { kickDrawer?: boolean }): Uint8Array`; constants `INIT`, `CUT_PARTIAL`, `DRAWER_KICK`.

- [ ] **Step 1: Write the failing tests.**

`src/spike/__tests__/invoice.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { businessDate, financialYear, formatInvoiceNo } from '../invoice';

describe('financialYear (India, April to March, IST)', () => {
  it('names a September date in the year that started the previous April', () => {
    expect(financialYear(new Date('2026-09-20T10:00:00Z'))).toBe('2627');
  });
  it('is still the old year at 23:59:59 IST on 31 March', () => {
    expect(financialYear(new Date('2026-03-31T18:29:59Z'))).toBe('2526');
  });
  it('rolls over at midnight IST on 1 April', () => {
    expect(financialYear(new Date('2026-03-31T18:30:00Z'))).toBe('2627');
  });
});

describe('formatInvoiceNo', () => {
  it('formats device/fy/sequence and stays within 16 characters', () => {
    const no = formatInvoiceNo('T1', '2627', 123);
    expect(no).toBe('T1/2627/000123');
    expect(no.length).toBeLessThanOrEqual(16);
  });
  it('accepts the longest legal shape', () => {
    expect(formatInvoiceNo('ABCD', '2627', 999999)).toBe('ABCD/2627/999999');
  });
  it('rejects a bad device code, sequence or year', () => {
    expect(() => formatInvoiceNo('t1', '2627', 1)).toThrow();
    expect(() => formatInvoiceNo('ABCDE', '2627', 1)).toThrow();
    expect(() => formatInvoiceNo('T1', '2627', 0)).toThrow();
    expect(() => formatInvoiceNo('T1', '2627', 1_000_000)).toThrow();
    expect(() => formatInvoiceNo('T1', '26', 1)).toThrow();
  });
});

describe('businessDate', () => {
  it('uses the IST calendar date', () => {
    expect(businessDate(new Date('2026-09-20T10:00:00Z'))).toBe('2026-09-20');
  });
  it('puts a 02:30 IST bill on the next calendar day with no cut-over', () => {
    expect(businessDate(new Date('2026-09-20T21:00:00Z'))).toBe('2026-09-21');
  });
  it('keeps a 02:30 IST bill on the previous trading day with a 4-hour cut-over', () => {
    expect(businessDate(new Date('2026-09-20T21:00:00Z'), 4)).toBe('2026-09-20');
  });
});
```

`src/spike/__tests__/jwt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deviceClaims } from '../jwt';

const token = (payload: object) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('deviceClaims', () => {
  it('reads shop_id and device_id', () => {
    expect(deviceClaims(token({ shop_id: 's1', device_id: 'd1' }))).toEqual({ shopId: 's1', deviceId: 'd1' });
  });
  it('explains a missing claim, which means the hook is not enabled', () => {
    expect(() => deviceClaims(token({ sub: 'u' }))).toThrow(/access-token hook/);
  });
  it('rejects something that is not a JWT', () => {
    expect(() => deviceClaims('nope')).toThrow(/Not a JWT/);
  });
});
```

`src/spike/__tests__/escpos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CUT_PARTIAL, DRAWER_KICK, INIT, escposTestTicket } from '../escpos';

const has = (bytes: Uint8Array, seq: number[]) =>
  bytes.some((_, i) => seq.every((b, j) => bytes[i + j] === b));

describe('escposTestTicket', () => {
  it('starts with printer init and encodes ASCII text', () => {
    const b = escposTestTicket(['HI']);
    expect([...b.slice(0, 2)]).toEqual(INIT);
    expect(has(b, [0x48, 0x49, 0x0a])).toBe(true);
  });
  it('replaces non-ASCII characters with a question mark', () => {
    expect(has(escposTestTicket(['₹5']), [0x3f, 0x35])).toBe(true);
  });
  it('ends the ticket with a cut', () => {
    const b = escposTestTicket(['x']);
    expect([...b.slice(-CUT_PARTIAL.length)]).toEqual(CUT_PARTIAL);
  });
  it('kicks the drawer only when asked, after the cut', () => {
    expect(has(escposTestTicket(['x']), DRAWER_KICK)).toBe(false);
    const b = escposTestTicket(['x'], { kickDrawer: true });
    expect([...b.slice(-DRAWER_KICK.length)]).toEqual(DRAWER_KICK);
  });
});
```

- [ ] **Step 2: Run them to verify they fail** (`npx vitest run src/spike` → cannot resolve modules).

- [ ] **Step 3: Implement.**

`src/spike/invoice.ts`:

```ts
/* Invoice numbering: one series per device per financial year.
   Format {device}/{fy}/{seq}, e.g. T1/2627/000123. GST expects at most 16
   characters (CA to confirm), so the formatter refuses anything longer. */

const IST = 'Asia/Kolkata';
export const MAX_INVOICE_LENGTH = 16;

interface Parts { year: number; month: number; day: number; hour: number }

function istParts(date: Date): Parts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

export function financialYear(date: Date): string {
  const { year, month } = istParts(date);
  const start = month >= 4 ? year : year - 1;
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}

export function formatInvoiceNo(deviceCode: string, fy: string, seq: number): string {
  if (!/^[A-Z0-9]{1,4}$/.test(deviceCode)) throw new Error(`Invalid device code: ${deviceCode}`);
  if (!/^\d{4}$/.test(fy)) throw new Error(`Invalid financial year: ${fy}`);
  if (!Number.isInteger(seq) || seq < 1 || seq > 999_999) throw new Error(`Invoice sequence out of range: ${seq}`);
  const no = `${deviceCode}/${fy}/${String(seq).padStart(6, '0')}`;
  if (no.length > MAX_INVOICE_LENGTH) throw new Error(`Invoice number too long: ${no}`);
  return no;
}

/** Trading date in IST. Hours before `cutoverHour` belong to the previous day. */
export function businessDate(date: Date, cutoverHour = 0): string {
  const { year, month, day } = istParts(new Date(date.getTime() - cutoverHour * 3_600_000));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
```

`src/spike/jwt.ts`:

```ts
export interface DeviceClaims { shopId: string; deviceId: string }

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) throw new Error('Not a JWT');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
}

export function deviceClaims(token: string): DeviceClaims {
  const p = decodeJwtPayload(token);
  if (typeof p.shop_id !== 'string' || typeof p.device_id !== 'string') {
    throw new Error('Token has no shop_id/device_id claims. Is the access-token hook enabled?');
  }
  return { shopId: p.shop_id, deviceId: p.device_id };
}
```

`src/spike/escpos.ts`:

```ts
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const INIT = [ESC, 0x40];
export const CUT_PARTIAL = [GS, 0x56, 0x42, 0x00];
/** ESC p m t1 t2: pulse pin 2 to open the cash drawer. */
export const DRAWER_KICK = [ESC, 0x70, 0x00, 0x19, 0xfa];

export function escposTestTicket(lines: string[], opts: { kickDrawer?: boolean } = {}): Uint8Array {
  const bytes: number[] = [...INIT];
  for (const line of lines) {
    for (const ch of line) bytes.push(ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : 0x3f);
    bytes.push(LF);
  }
  bytes.push(LF, LF, LF, ...CUT_PARTIAL);
  if (opts.kickDrawer) bytes.push(...DRAWER_KICK);
  return Uint8Array.from(bytes);
}
```

- [ ] **Step 4: Run** `npx vitest run src/spike` → PASS (all tests in the three files).

- [ ] **Step 5: Commit** (spike branch): `git add src/spike && git commit -m "spike: invoice, jwt and escpos helpers"`

---

### Task 12: Spike client: PowerSync wiring and the SpikePage

**Files (spike worktree):**
- Modify: `package.json` (install), `vite.config.ts`, `tsconfig.app.json`, `src/routes/index.tsx`
- Create: `src/spike/powersync/schema.ts`, `src/spike/powersync/SpikeConnector.ts`, `src/spike/powersync/db.ts`, `src/spike/createBill.ts`, `src/spike/SpikePage.tsx`

**Interfaces:**
- Consumes: Task 11 helpers.
- Produces: `db` (PowerSyncDatabase), `connector` (SpikeConnector with `client`, `login`, `logout`), `createBill(db, ctx, now?)`, route `/spike`.

- [ ] **Step 1: Install**

```bash
npm install @powersync/web @powersync/react
npm install -D @types/w3c-web-usb @types/w3c-web-serial
```
If npm reports an unmet peer dependency (for example `@journeyapps/wa-sqlite`), install exactly the package it names and record that in the findings doc.

- [ ] **Step 2: Vite config.** In the spike's `vite.config.ts`, inside the returned object add `optimizeDeps: { exclude: ['@powersync/web'] }` and `worker: { format: 'es' }`, and in the PWA `workbox` block change `globPatterns` to include `wasm` and raise the cap:

```ts
globPatterns: ['**/*.{js,css,html,svg,woff2,webp,png,ico,wasm}'],
maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
```

- [ ] **Step 3: Types.** In `tsconfig.app.json` change `"types": ["vite/client"]` to `"types": ["vite/client", "w3c-web-usb", "w3c-web-serial"]`.

- [ ] **Step 4: Schema** `src/spike/powersync/schema.ts`

```ts
import { column, Schema, Table } from '@powersync/web';

const shops = new Table({ name: column.text });

const devices = new Table({
  shop_id: column.text, auth_user_id: column.text, code: column.text, revoked_at: column.text,
});

const products = new Table({
  shop_id: column.text, name: column.text, unit: column.text,
  price_paise: column.integer, rev: column.integer, updated_at: column.text,
});

const billColumns = {
  shop_id: column.text, device_id: column.text, invoice_no: column.text, fy: column.text,
  seq: column.integer, business_date: column.text, payment_method: column.text,
  total_paise: column.integer, created_at: column.text,
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
  qty: column.real, unit: column.text, unit_price_paise: column.integer, line_total_paise: column.integer,
}, { indexes: { by_bill: ['bill_id'] } });

// Local-only: never synced or uploaded. Used to measure query speed at scale (Task 14).
const bills_perf = new Table(billColumns, {
  localOnly: true,
  indexes: { by_created: ['created_at'], by_date: ['business_date'], by_invoice: ['invoice_no'] },
});

export const SpikeSchema = new Schema({ shops, devices, products, bills, bill_lines, bills_perf });
```
`received_at` is deliberately absent so the upload never sends a NULL for a column the server defaults.

- [ ] **Step 5: Connector** `src/spike/powersync/SpikeConnector.ts`

```ts
import {
  UpdateType,
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
} from '@powersync/web';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* Append-only tables are uploaded with ON CONFLICT DO NOTHING, so a repeated
   upload (a retry after a dropped connection) can never edit or duplicate a bill. */
const APPEND_ONLY = new Set(['bills', 'bill_lines']);

/* Errors retrying cannot fix: bad data, constraint violations and RLS denials.
   Discard the transaction instead of blocking the queue. */
const FATAL = [/^22...$/, /^23...$/, /^42501$/];

export class SpikeConnector implements PowerSyncBackendConnector {
  readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      { auth: { persistSession: true, storageKey: 'spike-auth' } },
    );
  }

  async login(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async logout(): Promise<void> {
    await this.client.auth.signOut();
  }

  async fetchCredentials(): Promise<PowerSyncCredentials> {
    const { data: { session }, error } = await this.client.auth.getSession();
    if (error || !session) throw new Error('Not signed in');
    return { endpoint: import.meta.env.VITE_POWERSYNC_URL, token: session.access_token };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    try {
      for (const op of transaction.crud) {
        const table = this.client.from(op.table);
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
    } catch (ex) {
      const code = (ex as { code?: unknown }).code;
      if (typeof code === 'string' && FATAL.some((re) => re.test(code))) {
        console.error('Upload rejected, discarding transaction:', ex);
        await transaction.complete();
      } else {
        throw ex; // retryable (network, temporary server error)
      }
    }
  }
}
```

- [ ] **Step 6: Database** `src/spike/powersync/db.ts`

```ts
import { PowerSyncDatabase } from '@powersync/web';
import { SpikeSchema } from './schema';
import { SpikeConnector } from './SpikeConnector';

export const connector = new SpikeConnector();
export const db = new PowerSyncDatabase({
  schema: SpikeSchema,
  database: { dbFilename: 'cafe-spike.db' },
});
```

- [ ] **Step 7: createBill** `src/spike/createBill.ts`

```ts
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { businessDate, financialYear, formatInvoiceNo } from './invoice';

export interface DeviceContext { shopId: string; deviceId: string; deviceCode: string }

const PAYMENTS = ['cash', 'upi', 'card'] as const;

/** Creates one bill with three lines in a single local transaction. The next
    invoice number is read inside the same transaction, so two tabs on one device
    cannot take the same number. */
export async function createBill(
  db: AbstractPowerSyncDatabase,
  ctx: DeviceContext,
  now = new Date(),
): Promise<string> {
  const billId = crypto.randomUUID();

  await db.writeTransaction(async (tx) => {
    const fy = financialYear(now);
    const next = await tx.get<{ next: number }>(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM bills WHERE device_id = ? AND fy = ?',
      [ctx.deviceId, fy],
    );
    const products = await tx.getAll<{ id: string; name: string; unit: string; price_paise: number }>(
      'SELECT id, name, unit, price_paise FROM products WHERE shop_id = ? ORDER BY name LIMIT 3',
      [ctx.shopId],
    );
    if (products.length === 0) throw new Error('No products synced yet. Wait for the first sync.');

    // One weight-priced line (1.5 kg style) exercises decimal quantities.
    const lines = products.map((p, i) => {
      const qty = i === 0 ? 1.5 : i + 1;
      return { id: crypto.randomUUID(), p, qty, total: Math.round(qty * p.price_paise) };
    });
    const total = lines.reduce((sum, l) => sum + l.total, 0);

    await tx.execute(
      `INSERT INTO bills (id, shop_id, device_id, invoice_no, fy, seq, business_date, payment_method, total_paise, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        billId, ctx.shopId, ctx.deviceId, formatInvoiceNo(ctx.deviceCode, fy, next.next), fy, next.next,
        businessDate(now), PAYMENTS[next.next % PAYMENTS.length], total, now.toISOString(),
      ],
    );
    for (const l of lines) {
      await tx.execute(
        `INSERT INTO bill_lines (id, bill_id, shop_id, product_id, name, qty, unit, unit_price_paise, line_total_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [l.id, billId, ctx.shopId, l.p.id, l.p.name, l.qty, l.p.unit, l.p.price_paise, l.total],
      );
    }
  });

  return billId;
}
```

- [ ] **Step 8: The page** `src/spike/SpikePage.tsx`

```tsx
import { useEffect, useRef, useState } from 'react';
import { PowerSyncContext, useQuery } from '@powersync/react';
import type { SyncStatus } from '@powersync/web';
import { connector, db } from './powersync/db';
import { createBill } from './createBill';
import { deviceClaims, type DeviceClaims } from './jwt';

function StoragePanel() {
  const [info, setInfo] = useState('');
  async function check() {
    const persisted = await navigator.storage.persisted();
    const granted = persisted ? true : await navigator.storage.persist();
    const est = await navigator.storage.estimate();
    setInfo(`persisted=${persisted} persistAfterRequest=${granted} usage=${est.usage} quota=${est.quota}`);
  }
  return (
    <section>
      <h3>Storage (test 2)</h3>
      <button onClick={() => void check()}>Check / request persistent storage</button>
      <pre>{info}</pre>
      <pre>{navigator.userAgent}</pre>
    </section>
  );
}

function Panel() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [claims, setClaims] = useState<DeviceClaims | null>(null);
  const [status, setStatus] = useState<SyncStatus>(db.currentStatus);
  const [queue, setQueue] = useState<{ count: number; size: number | null }>({ count: 0, size: null });
  const [message, setMessage] = useState('');
  const [syncMs, setSyncMs] = useState<number | null>(null);
  const connectedAt = useRef<number | null>(null);

  const bills = useQuery<{ id: string; invoice_no: string; total_paise: number; created_at: string }>(
    'SELECT id, invoice_no, total_paise, created_at FROM bills ORDER BY created_at DESC LIMIT 20',
  );
  const counts = useQuery<{ bills: number; lines: number; products: number }>(
    'SELECT (SELECT COUNT(*) FROM bills) AS bills, (SELECT COUNT(*) FROM bill_lines) AS lines, (SELECT COUNT(*) FROM products) AS products',
  );
  const codeRow = useQuery<{ code: string }>('SELECT code FROM devices WHERE id = ?', [claims?.deviceId ?? '']);

  useEffect(() => {
    const dispose = db.registerListener({
      statusChanged: (s) => {
        setStatus(s);
        if (s.hasSynced && connectedAt.current !== null) {
          setSyncMs(Math.round(performance.now() - connectedAt.current));
          connectedAt.current = null;
        }
      },
    });
    const timer = setInterval(() => { void db.getUploadQueueStats().then(setQueue); }, 1000);
    return () => { dispose(); clearInterval(timer); };
  }, []);

  useEffect(() => {
    void (async () => {
      const { data } = await connector.client.auth.getSession();
      if (data.session) {
        setClaims(deviceClaims(data.session.access_token));
        connectedAt.current = performance.now();
        await db.connect(connector);
      }
    })().catch((e) => setMessage(String(e)));
  }, []);

  async function signIn() {
    try {
      await connector.login(email, password);
      const { data } = await connector.client.auth.getSession();
      setClaims(deviceClaims(data.session!.access_token));
      connectedAt.current = performance.now();
      await db.connect(connector);
      setMessage('Connected');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function signOut() {
    await db.disconnectAndClear();
    await connector.logout();
    setClaims(null);
    setMessage('Signed out; local data wiped');
  }

  async function addBills(n: number) {
    const code = codeRow.data[0]?.code;
    if (!claims || !code) { setMessage('Device code not synced yet'); return; }
    try {
      for (let i = 0; i < n; i++) {
        await createBill(db, { shopId: claims.shopId, deviceId: claims.deviceId, deviceCode: code });
      }
      setMessage(`Created ${n} bill(s)`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui', maxWidth: 720 }}>
      <h2>PowerSync spike</h2>
      <section>
        <h3>Device login</h3>
        <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />{' '}
        <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />{' '}
        <button onClick={() => void signIn()}>Sign in and connect</button>{' '}
        <button onClick={() => void signOut()}>Sign out and wipe local data</button>
        <pre>{claims ? JSON.stringify({ ...claims, code: codeRow.data[0]?.code }) : 'not signed in'}</pre>
      </section>
      <section>
        <h3>Sync</h3>
        <pre>
          connected={String(status.connected)} hasSynced={String(status.hasSynced)}{'\n'}
          uploading={String(status.dataFlowStatus?.uploading)} downloading={String(status.dataFlowStatus?.downloading)}{'\n'}
          upload queue={queue.count} first sync took={syncMs === null ? 'n/a' : `${syncMs} ms`}{'\n'}
          local rows={JSON.stringify(counts.data[0] ?? {})}
        </pre>
        <p>{message}</p>
      </section>
      <section>
        <h3>Bills</h3>
        <button onClick={() => void addBills(1)}>New bill</button>{' '}
        <button onClick={() => void addBills(5)}>New 5 bills</button>{' '}
        <button onClick={() => void addBills(2000)}>Create 2000 real bills</button>
        <ul>{bills.data.map((b) => <li key={b.id}>{b.invoice_no} - {b.total_paise / 100} - {b.created_at}</li>)}</ul>
      </section>
      <StoragePanel />
    </div>
  );
}

export function SpikePage() {
  return (
    <PowerSyncContext.Provider value={db}>
      <Panel />
    </PowerSyncContext.Provider>
  );
}
```

- [ ] **Step 9: Route.** In `src/routes/index.tsx` add near the other lazy imports:

```tsx
const SpikePage = lazy(() => import('@/spike/SpikePage').then((m) => ({ default: m.SpikePage })));
```
and insert before the comment `{/* Customer ordering.` :

```tsx
      <Route path="/spike" element={<Suspense fallback={<RouteFallback />}><SpikePage /></Suspense>} />

```

- [ ] **Step 10: Test 1, does it build and run under Vite 8?**

```bash
npx tsc -b
ALLOW_PUBLIC_PUBLISH_TOKEN=1 npm run build
npm run dev
```
Open `http://localhost:5173/spike`, sign in with device A/T1 from `spike-credentials.local`, and confirm: no console errors, the claims panel shows a `shop_id`, `hasSynced=true` appears, `local rows` shows 5 products, and "New bill" adds a row. Expected: builds and syncs. If `tsc` reports API differences in `@powersync/web` (for example `getUploadQueueStats` or `registerListener` signatures), fix against the installed version's types and record the difference.

- [ ] **Step 11: Commit** (spike branch): `git add -A src package.json package-lock.json vite.config.ts tsconfig.app.json && git commit -m "spike: PowerSync wiring and SpikePage"`

---

### Task 13: Tests 2, 3 and 4: persistence, tenant isolation, two-device offline

**Files (spike worktree):** Create `spike/tests/cross-tenant.mjs`. Results go into the findings doc (Task 17).

**Interfaces:** Consumes: `spike-credentials.local`, the RLS policies and triggers from Task 10, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the environment.

- [ ] **Step 1: Write the cross-tenant script** `spike/tests/cross-tenant.mjs`

```js
// Test 3 (server side): RLS must isolate shops and keep bills append-only.
// Run: SPIKE_SUPABASE_URL=... SPIKE_ANON_KEY=... node spike/tests/cross-tenant.mjs
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const url = process.env.SPIKE_SUPABASE_URL;
const anon = process.env.SPIKE_ANON_KEY;
if (!url || !anon) { console.error('Set SPIKE_SUPABASE_URL and SPIKE_ANON_KEY.'); process.exit(1); }

const creds = JSON.parse(readFileSync('spike-credentials.local', 'utf8'));
const find = (shop, code) => creds.find((c) => c.shop === shop && c.code === code);
const a1 = find('Spike Cafe A', 'T1');
const a2 = find('Spike Cafe A', 'T2');
const b1 = find('Spike Cafe B', 'T1');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

async function signIn(cred) {
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: cred.email, password: cred.password });
  if (error) throw error;
  return client;
}

const bill = (cred, over = {}) => ({
  id: randomUUID(), shop_id: cred.shopId, device_id: cred.deviceId,
  invoice_no: `${cred.code}/2627/${String(Math.floor(Math.random() * 999999) + 1).padStart(6, '0')}`,
  fy: '2627', seq: Math.floor(Math.random() * 2_000_000_000), business_date: '2026-09-20',
  payment_method: 'cash', total_paise: 5000, created_at: new Date().toISOString(), ...over,
});

const clientA1 = await signIn(a1);
const clientB1 = await signIn(b1);

// 1. Own insert works, and is idempotent under ignoreDuplicates.
const own = bill(a1);
let r = await clientA1.from('bills').upsert(own, { ignoreDuplicates: true });
check('device inserts its own bill', !r.error, r.error?.message);
r = await clientA1.from('bills').upsert(own, { ignoreDuplicates: true });
check('re-uploading the same bill is harmless', !r.error, r.error?.message);
let rows = await clientA1.from('bills').select('id').eq('id', own.id);
check('exactly one copy exists', rows.data?.length === 1);

// 2. Cross-tenant insert is refused.
r = await clientA1.from('bills').insert(bill(b1));
check('cannot insert a bill for another shop', r.error?.code === '42501', r.error?.code);

// 3. Cannot write as another device of the same shop.
r = await clientA1.from('bills').insert(bill(a1, { device_id: a2.deviceId }));
check('cannot write as a different device', r.error?.code === '42501', r.error?.code);

// 4. Append-only: update and delete are refused.
r = await clientA1.from('bills').update({ total_paise: 1 }).eq('id', own.id);
rows = await clientA1.from('bills').select('total_paise').eq('id', own.id);
check('a bill cannot be edited', rows.data?.[0]?.total_paise === 5000, r.error?.code ?? 'no error but unchanged');
r = await clientA1.from('bills').delete().eq('id', own.id);
rows = await clientA1.from('bills').select('id').eq('id', own.id);
check('a bill cannot be deleted', rows.data?.length === 1, r.error?.code ?? 'no error but still present');

// 5. Reads are scoped to the shop.
const seenByB = await clientB1.from('bills').select('id').eq('id', own.id);
check('another shop cannot read the bill', (seenByB.data ?? []).length === 0);
const shopsSeen = await clientB1.from('shops').select('id');
check('a device sees only its own shop', shopsSeen.data?.length === 1 && shopsSeen.data[0].id === b1.shopId);

// 6. The JWT carries the claims the policies rely on.
const { data: { session } } = await clientA1.auth.getSession();
const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString());
check('token carries shop_id and device_id', claims.shop_id === a1.shopId && claims.device_id === a1.deviceId);
check('app_metadata carries the same shop_id', claims.app_metadata?.shop_id === a1.shopId);

console.log(failures === 0 ? '\nAll cross-tenant checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it**

```bash
export SPIKE_ANON_KEY="<the spike project's publishable key>"
node spike/tests/cross-tenant.mjs
```
Expected: every line `PASS` and exit code 0. Any `FAIL` is a failure of test 3 (server side): fix the policy or hook, do not weaken the script.

- [ ] **Step 3: Test 3, client side.** Sign in as A/T1 on `/spike` and note `local rows`; wipe and sign in as B/T1 in a private window. Pass condition: B's local database contains only shop B's rows (`shops` count 1, and none of A's invoice numbers appear). Record both counts.

- [ ] **Step 4: Test 4, two devices offline.** Use two browser profiles (for example Chrome and Edge). Sign profile 1 in as A/T1 and profile 2 as A/T2; wait for `hasSynced=true` on both. In each, DevTools → Network → set Offline. Create 5 bills on each. Confirm the local lists show `T1/2627/000001..000005` on one and `T2/2627/000001..000005` on the other. Go online in both.

Pass conditions, checked in the SQL editor:

```sql
select device_id, invoice_no, count(*) from public.bills group by 1, 2 having count(*) > 1;  -- expect 0 rows
select count(*) from public.bills;                                                             -- expect 10 more than before
```
and both profiles show all 10 bills with the upload queue at 0. Then repeat once, closing one tab mid-upload; after reopening and reconnecting, the row count must still be exactly 10 with no duplicates.

- [ ] **Step 5: Test 2, persistence matrix.** For each of Android Chrome (installed as a PWA), Windows Edge (installed as an app) and iOS Safari (Add to Home Screen): sign in, wait for sync, create 3 bills offline, fully close the app, reopen while still offline, and confirm the 3 bills and the products are there. Press "Check / request persistent storage" and record `persisted`, `persistAfterRequest`, `usage` and `quota`. Then leave each device untouched for 7 days and repeat the check; note the day you re-checked. If a browser evicts the data, that platform fails test 2.

- [ ] **Step 6: Test 2b, multi-tab.** On one device open `/spike` in two tabs, click "New 5 bills" in both at nearly the same time, and confirm no duplicate invoice numbers (`select invoice_no, count(*) ... having count(*) > 1` returns 0 rows).

- [ ] **Step 7: Commit** (spike branch): `git add spike/tests && git commit -m "spike: cross-tenant test script"`

---

### Task 14: Test 5: performance and real bytes per bill

**Files (spike worktree):**
- Create: `src/spike/perf.ts`, `src/spike/PerfPanel.tsx`
- Test: `src/spike/__tests__/perf.test.ts`
- Modify: `src/spike/SpikePage.tsx`

**Interfaces:**
- Consumes: `db`, `SpikeSchema.bills_perf`, `businessDate`, `financialYear`, `formatInvoiceNo`.
- Produces: `mulberry32(seed): () => number`; `median(values: number[]): number`; `PERF_TARGETS`; `seedPerfBills(db, ctx, total, onProgress?)`; `measure(label, fn, runs?)`.

- [ ] **Step 1: Write the failing test** `src/spike/__tests__/perf.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { PERF_TARGETS, mulberry32, median } from '../perf';

describe('mulberry32', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it('rejects an empty list', () => {
    expect(() => median([])).toThrow();
  });
});

describe('PERF_TARGETS', () => {
  it('encodes the spec thresholds', () => {
    expect(PERF_TARGETS.firstPageMs).toBe(200);
    expect(PERF_TARGETS.todayDashboardMs).toBe(300);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** (`npx vitest run src/spike/__tests__/perf.test.ts` → cannot resolve `../perf`).

- [ ] **Step 3: Implement** `src/spike/perf.ts`

```ts
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { businessDate, financialYear, formatInvoiceNo } from './invoice';
import type { DeviceContext } from './createBill';

/** Pass thresholds from the spec, section 16 (spike test 5). */
export const PERF_TARGETS = { firstPageMs: 200, todayDashboardMs: 300 } as const;

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median of nothing');
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const PAYMENTS = ['cash', 'upi', 'card'];
const DAYS = 730;
const CHUNK = 2000;

/** Inserts `total` bills spread over two years into the local-only bills_perf table. */
export async function seedPerfBills(
  db: AbstractPowerSyncDatabase,
  ctx: DeviceContext,
  total: number,
  onProgress?: (done: number) => void,
): Promise<void> {
  const rand = mulberry32(20260920);
  const nowMs = Date.now();
  let seq = 0;

  for (let start = 0; start < total; start += CHUNK) {
    const end = Math.min(start + CHUNK, total);
    await db.writeTransaction(async (tx) => {
      for (let i = start; i < end; i++) {
        seq++;
        const created = new Date(nowMs - Math.floor(rand() * DAYS * 86_400_000));
        const fy = financialYear(created);
        await tx.execute(
          `INSERT INTO bills_perf (id, shop_id, device_id, invoice_no, fy, seq, business_date, payment_method, total_paise, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(), ctx.shopId, ctx.deviceId,
            formatInvoiceNo(ctx.deviceCode, fy, (seq % 999_999) + 1), fy, seq,
            businessDate(created), PAYMENTS[Math.floor(rand() * 3)],
            5000 + Math.floor(rand() * 85_000), created.toISOString(),
          ],
        );
      }
    });
    onProgress?.(end);
  }
}

export interface Measurement { label: string; medianMs: number; minMs: number; maxMs: number; rows: number }

/** One warm-up run, then `runs` timed runs. */
export async function measure(
  label: string,
  fn: () => Promise<unknown[]>,
  runs = 7,
): Promise<Measurement> {
  await fn();
  const times: number[] = [];
  let rows = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    rows = (await fn()).length;
    times.push(performance.now() - t0);
  }
  return { label, medianMs: median(times), minMs: Math.min(...times), maxMs: Math.max(...times), rows };
}
```

- [ ] **Step 4: Run** `npx vitest run src/spike/__tests__/perf.test.ts` → PASS (4 tests).

- [ ] **Step 5: The panel** `src/spike/PerfPanel.tsx`

```tsx
import { useState } from 'react';
import { db } from './powersync/db';
import { businessDate } from './invoice';
import { PERF_TARGETS, measure, seedPerfBills, type Measurement } from './perf';
import type { DeviceContext } from './createBill';

export function PerfPanel({ ctx }: { ctx: DeviceContext | null }) {
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<Measurement[]>([]);

  async function seed() {
    if (!ctx) { setProgress('Sign in first'); return; }
    await db.execute('DELETE FROM bills_perf');
    const t0 = performance.now();
    await seedPerfBills(db, ctx, 100_000, (n) => setProgress(`${n} / 100000`));
    setProgress(`Seeded 100000 rows in ${Math.round(performance.now() - t0)} ms`);
  }

  async function run() {
    const today = businessDate(new Date());
    const weekAgo = businessDate(new Date(Date.now() - 7 * 86_400_000));
    setResults([
      await measure('first page of history (limit 50)', () =>
        db.getAll('SELECT id, invoice_no, total_paise, created_at FROM bills_perf ORDER BY created_at DESC LIMIT 50')),
      await measure('today dashboard (group by payment)', () =>
        db.getAll('SELECT payment_method, COUNT(*) AS bills, SUM(total_paise) AS total FROM bills_perf WHERE business_date = ? GROUP BY payment_method', [today])),
      await measure('last 7 days by day', () =>
        db.getAll('SELECT business_date, COUNT(*) AS bills, SUM(total_paise) AS total FROM bills_perf WHERE business_date >= ? GROUP BY business_date ORDER BY business_date', [weekAgo])),
      await measure('find by invoice number', () =>
        db.getAll('SELECT id FROM bills_perf WHERE invoice_no = ?', ['T1/2627/000001'])),
    ]);
  }

  const limit = (label: string) =>
    label.startsWith('first page') ? PERF_TARGETS.firstPageMs
      : label.startsWith('today') ? PERF_TARGETS.todayDashboardMs : null;

  return (
    <section>
      <h3>Performance (test 5)</h3>
      <p>Run on the slowest device you have. Cores: {navigator.hardwareConcurrency}, memory hint: {String((navigator as { deviceMemory?: number }).deviceMemory ?? 'n/a')} GB</p>
      <button onClick={() => void seed()}>Seed 100k local rows</button>{' '}
      <button onClick={() => void run()}>Run queries</button>
      <pre>{progress}</pre>
      <table>
        <thead><tr><th>query</th><th>median ms</th><th>min</th><th>max</th><th>rows</th><th>target</th></tr></thead>
        <tbody>
          {results.map((r) => {
            const t = limit(r.label);
            return (
              <tr key={r.label}>
                <td>{r.label}</td><td>{r.medianMs.toFixed(1)}</td><td>{r.minMs.toFixed(1)}</td>
                <td>{r.maxMs.toFixed(1)}</td><td>{r.rows}</td>
                <td>{t === null ? '-' : r.medianMs < t ? `PASS (<${t})` : `FAIL (>=${t})`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 6: Mount it.** In `src/spike/SpikePage.tsx` add `import { PerfPanel } from './PerfPanel';` and, just above `<StoragePanel />`, add:

```tsx
      <PerfPanel ctx={claims && codeRow.data[0]?.code ? { shopId: claims.shopId, deviceId: claims.deviceId, deviceCode: codeRow.data[0].code } : null} />
```

- [ ] **Step 7: Measure query speed.** On the slowest available Android tablet and a Windows PC: sign in, click "Seed 100k local rows", then "Run queries" and record the table. Pass: first page < 200 ms and today's dashboard < 300 ms. If a query fails, add or adjust an index in `bills_perf`, re-seed and re-measure once before recording a fail; record the index that fixed it.

- [ ] **Step 8: Measure real bytes per bill and sync cost.** Sign in as A/T1 with an empty shop, note the row count, click "Create 2000 real bills", and wait until the upload queue is 0. Then in the SQL editor:

```sql
select
  (select count(*) from public.bills) as bills,
  pg_total_relation_size('public.bills')      as bills_bytes,
  pg_total_relation_size('public.bill_lines') as lines_bytes,
  round((pg_total_relation_size('public.bills') + pg_total_relation_size('public.bill_lines'))::numeric
        / nullif((select count(*) from public.bills), 0)) as bytes_per_bill;
```
Compare `bytes_per_bill` to the spec's estimate of about 1500. Record it. Then sign out (wipes local data), sign in again, and read "first sync took" as the fresh-device sync time. Note PowerSync's dashboard usage for the upload volume.

- [ ] **Step 9: Test 5b, the 90-day window.** Read the current PowerSync Sync Streams documentation on subscription parameters, and try to bound `bills` by a client-supplied date (for example only bills with `business_date` at or after a date passed by the client). Record: supported or not, the exact syntax that worked, and if unsupported, the fallback (a server-maintained `hot` flag on recent bills). The spec's rolling window depends on this.

- [ ] **Step 10: Commit** (spike branch): `git add src/spike && git commit -m "spike: performance harness"`

---

### Task 15: Tests 6 and 7: dialog-less printing (kiosk flag, WebUSB, Web Serial) and cash drawer

**Files (spike worktree):** Create `src/spike/print.ts`, `src/spike/PrintPanel.tsx`; modify `src/spike/SpikePage.tsx`.

**Interfaces:** Consumes: `escposTestTicket` from Task 11. Produces: `printViaWebUsb(kickDrawer: boolean): Promise<string>`, `printViaWebSerial(kickDrawer: boolean): Promise<string>`, `printBrowserTest(): void`.

- [ ] **Step 1: Implement** `src/spike/print.ts`

```ts
import { escposTestTicket } from './escpos';

const LINES = ['SPIKE PRINT TEST', new Date().toISOString(), 'If you can read this, direct ESC/POS works.'];

/** WebUSB: pick the first interface with a bulk OUT endpoint and write to it. */
export async function printViaWebUsb(kickDrawer: boolean): Promise<string> {
  const device = await navigator.usb.requestDevice({ filters: [] });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);

  let target: { iface: number; endpoint: number } | null = null;
  for (const iface of device.configuration!.interfaces) {
    const ep = iface.alternates[0].endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
    if (ep) { target = { iface: iface.interfaceNumber, endpoint: ep.endpointNumber }; break; }
  }
  if (!target) throw new Error('No bulk OUT endpoint found on this device');

  await device.claimInterface(target.iface);
  await device.transferOut(target.endpoint, escposTestTicket(LINES, { kickDrawer }));
  await device.close();
  return `WebUSB ok: ${device.productName ?? 'device'} interface ${target.iface} endpoint ${target.endpoint}`;
}

/** Web Serial: for printers that appear as a COM port. */
export async function printViaWebSerial(kickDrawer: boolean): Promise<string> {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });
  const writer = port.writable!.getWriter();
  await writer.write(escposTestTicket(LINES, { kickDrawer }));
  writer.releaseLock();
  await port.close();
  return 'Web Serial ok';
}

/** The browser print path with a hidden iframe: the same technique printKot uses.
    With Chrome started with --kiosk-printing it should print with no dialog. */
export function printBrowserTest(): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write('<!doctype html><html><body style="font-family:sans-serif;width:74mm"><h2>SPIKE KOT TEST</h2><p>Browser print path</p></body></html>');
  doc.close();
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
}
```

- [ ] **Step 2: Panel** `src/spike/PrintPanel.tsx`

```tsx
import { useState } from 'react';
import { printBrowserTest, printViaWebSerial, printViaWebUsb } from './print';

export function PrintPanel() {
  const [result, setResult] = useState('');
  const run = (fn: () => Promise<string> | void) => async () => {
    try { setResult((await fn()) ?? 'started'); } catch (e) { setResult(`FAILED: ${e instanceof Error ? e.message : String(e)}`); }
  };
  return (
    <section>
      <h3>Printing (tests 6 and 7)</h3>
      <button onClick={run(() => printBrowserTest())}>Browser print (for --kiosk-printing test)</button>{' '}
      <button onClick={run(() => printViaWebUsb(false))}>WebUSB print</button>{' '}
      <button onClick={run(() => printViaWebUsb(true))}>WebUSB print + kick drawer</button>{' '}
      <button onClick={run(() => printViaWebSerial(true))}>Web Serial print + kick drawer</button>
      <pre>{result}</pre>
    </section>
  );
}
```

- [ ] **Step 3: Mount it** in `SpikePage.tsx`: `import { PrintPanel } from './PrintPanel';` and add `<PrintPanel />` above `<StoragePanel />`.

- [ ] **Step 4: Type-check and run**

```bash
npx tsc -b && npx vitest run src/spike
```
Expected: no errors, tests pass.

- [ ] **Step 5: Hardware matrix.** Use each printer model the pilot cafes actually own (ask the owner, or the device survey). For each: on Windows Chrome and Edge, and on Android Chrome (HTTPS or localhost only), click each button and record: prints yes/no, drawer opens yes/no, and any error text. On Windows, if the vendor driver claims the printer so WebUSB cannot open it, record that and whether Web Serial works via the printer's virtual COM port. Test 6 (kiosk flag): start Chrome as `chrome.exe --kiosk-printing --user-data-dir=%TEMP%\kiosk-test http://localhost:5173/spike`, click "Browser print" and record whether it printed with no dialog.

- [ ] **Step 6: Commit** (spike branch): `git add src/spike && git commit -m "spike: direct printing and cash drawer tests"`

---

### Task 16: Test 8: verified UPI at the till (Razorpay QR and webhook)

**Files (spike worktree):**
- Create: `supabase/functions/spike-till-qr/index.ts`, `supabase/functions/spike-qr-webhook/index.ts`, `spike/sql/002_webhook_log.sql`

**Interfaces:** Produces: a per-bill UPI QR (`qrId`, `imageUrl`) and a logged, signature-checked webhook capture. Spike only: no caller authentication, so deploy only to the spike project.

- [ ] **Step 1: Webhook log table** `spike/sql/002_webhook_log.sql` (run it in the spike project):

```sql
create table public.spike_webhook_log (
  id              bigint generated always as identity primary key,
  received_at     timestamptz not null default now(),
  event_id        text,
  signature_valid boolean not null,
  body            jsonb not null
);
alter table public.spike_webhook_log enable row level security;
-- No policies: only the service role (edge functions) can read or write it.
```

- [ ] **Step 2: QR function** `supabase/functions/spike-till-qr/index.ts`

```ts
/* Creates a single-use, fixed-amount UPI QR for one bill, using Razorpay's
   QR Codes API (POST /v1/payments/qr_codes). SPIKE ONLY: no caller auth. */

const headers = { 'Content-Type': 'application/json' };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const { billId, amountPaise } = await req.json() as { billId?: string; amountPaise?: number };
  if (!billId || !Number.isInteger(amountPaise) || (amountPaise as number) < 100) {
    return new Response(JSON.stringify({ error: 'billId and amountPaise (>= 100) are required' }), { status: 400, headers });
  }

  const keyId = Deno.env.get('RAZORPAY_KEY_ID')!;
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')!;

  const res = await fetch('https://api.razorpay.com/v1/payments/qr_codes', {
    method: 'POST',
    headers: { ...headers, Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` },
    body: JSON.stringify({
      type: 'upi_qr',
      name: `bill-${billId}`.slice(0, 40),
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: amountPaise,
      description: `Bill ${billId}`,
      close_by: Math.floor(Date.now() / 1000) + 15 * 60, // Razorpay allows 2 minutes to 2 hours
      notes: { bill_id: billId },
    }),
  });

  const body = await res.json();
  if (!res.ok) return new Response(JSON.stringify({ error: body }), { status: 502, headers });
  return new Response(JSON.stringify({ qrId: body.id, imageUrl: body.image_url, status: body.status }), { headers });
});
```

- [ ] **Step 3: Webhook logger** `supabase/functions/spike-qr-webhook/index.ts`

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyWebhookSignature } from '../verify-payment/signature.ts';

/* Logs every webhook Razorpay sends, with the signature check result, so the
   spike can record the real event names and payload shape for QR payments.
   SPIKE ONLY. */

Deno.serve(async (req) => {
  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const valid = await verifyWebhookSignature(raw, signature, Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { body = { unparsable: raw.slice(0, 500) }; }

  await admin.from('spike_webhook_log').insert({
    event_id: req.headers.get('x-razorpay-event-id'),
    signature_valid: valid,
    body,
  });

  return new Response(valid ? 'ok' : 'invalid signature', { status: valid ? 200 : 401 });
});
```
The relative import reaches `supabase/functions/verify-payment/signature.ts` in the same worktree. If the deploy bundler rejects a cross-function import, copy that file into `supabase/functions/_shared/signature.ts` in the spike branch and import it from there.

- [ ] **Step 4: Deploy to the SPIKE project only**

```bash
npx supabase functions deploy spike-till-qr --project-ref <spike-ref>
npx supabase functions deploy spike-qr-webhook --project-ref <spike-ref> --no-verify-jwt
npx supabase secrets set --project-ref <spike-ref> RAZORPAY_KEY_ID=<test key id> RAZORPAY_KEY_SECRET=<test key secret> RAZORPAY_WEBHOOK_SECRET=<spike webhook secret>
```
The human types the secret values; use Razorpay test-mode keys. Then in Razorpay (test mode) add a webhook pointing at `https://<spike-ref>.supabase.co/functions/v1/spike-qr-webhook` with the same secret, and enable all payment and QR-code events offered.

- [ ] **Step 5: Create a QR and pay it**

```bash
curl -s -X POST "https://<spike-ref>.supabase.co/functions/v1/spike-till-qr" -H "Content-Type: application/json" -H "Authorization: Bearer <spike publishable key>" -H "apikey: <spike publishable key>" -d '{"billId":"spike-bill-1","amountPaise":1000}'
```
`spike-till-qr` keeps Supabase's default JWT check (no `--no-verify-jwt`), so the call needs the spike project's publishable key; only the webhook logger is open, because Razorpay sends no JWT and the function verifies the HMAC itself. Expected: JSON with `qrId`, `imageUrl` and `status: "active"`. Open `imageUrl`. In the Razorpay test dashboard, use whatever test-mode payment simulation it offers for a QR; if none exists, record that verified UPI can be exercised end to end only in live mode with a real ₹1 payment, and do that once only if the owner agrees.

- [ ] **Step 6: Record what arrived**

```sql
select received_at, event_id, signature_valid, body ->> 'event' as event, body -> 'payload' as payload
from public.spike_webhook_log order by id desc limit 10;
```
Pass: the QR is created, and after a payment a row arrives with `signature_valid = true`. Record the exact event names, how the payload references the QR id and the `notes.bill_id`, and the delay from payment to webhook. If no simulated payment was possible, mark test 8 as "creation verified, payment path untested" rather than passing it.

- [ ] **Step 7: Commit** (spike branch): `git add supabase/functions/spike-till-qr supabase/functions/spike-qr-webhook spike/sql/002_webhook_log.sql && git commit -m "spike: verified UPI QR creation and webhook capture"`

---

### Task 17: Findings, record-only checks and the decision gate

**Files:**
- Create: `docs/superpowers/spikes/2026-09-powersync-spike-findings.md`, first in the spike worktree, then copied to the main worktree on branch `docs/cafe-billing-saas-design` (the spike branch is never merged).

**Interfaces:** Produces: the pass/fail table that decides whether Plan 2 is written for PowerSync or for custom sync on Dexie.

- [ ] **Step 1: Record-only checks**

```bash
npx supabase db query --linked --project-ref <spike-ref> "select name, default_version from pg_available_extensions where name in ('pg_cron','pgcrypto')"
```
Also read, and write into the findings doc: (a) the current PowerSync/Supabase note about WAL growth on an idle instance, and the spike database's size a day after the last write; (b) Razorpay's stated per-transaction limit for UPI AutoPay recurring payments, from the Razorpay Subscriptions documentation.

- [ ] **Step 2: Write the findings document** with this structure, filling every cell from your recorded evidence:

```markdown
# PowerSync spike findings (2026-09)

Decision rule (from the spec): PowerSync proceeds only if tests 1-5 ALL pass. If any of 1-4 fails, fall back to custom sync on Dexie. If only test 5 fails, fix indexes or queries once, then re-measure; if it still fails, fall back.

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | PowerSync web SDK builds and syncs in the Vite 8 / React 19 app | PASS / FAIL | versions installed, peers needed, console output |
| 2 | Persistence on Android Chrome, Windows Edge PWA, iOS Safari (offline, restart, 7 days idle, persisted flag) | PASS / FAIL per platform | per-platform table |
| 3 | Tenant scoping: each device syncs only its own shop; cross-tenant upload rejected by RLS | PASS / FAIL | cross-tenant script output, local row counts |
| 4 | Two devices offline then reconnect: no duplicates or losses, unique per-device series | PASS / FAIL | duplicate query output, row counts, mid-upload close result |
| 5 | 100k bills on a low-end Android: first page < 200 ms, today's dashboard < 300 ms | PASS / FAIL | measurement table, device model, bytes per bill vs 1500, first-sync time |
| 5b | Sync window by client-supplied date | SUPPORTED / NOT | syntax or fallback |
| 6 | Kiosk-printing on Windows Chrome and Android | PASS / FAIL | dialog-less or not |
| 7 | Direct ESC/POS (WebUSB, Web Serial) and drawer kick per printer model | table | per model and OS |
| 8 | Verified UPI: QR created, webhook received, signature valid | PASS / PARTIAL | event names, payload shape, latency |
| 9 | Record only: WAL growth, pg_cron on free, UPI AutoPay limit, PowerSync connection type (direct or pooler), Sync Streams claim syntax that worked | recorded | values |

## Decision
PowerSync / Custom sync on Dexie: <one line, with the deciding tests>

## Consequences for the spec
<list any spec statement the evidence contradicts, for example the 90-day window mechanism, the bytes-per-bill estimate, printer support>
```

- [ ] **Step 3: Keep the findings, keep the code.** Copy the file into the main worktree and commit it there; keep the spike branch pushed for reference but never merged:

```bash
cp docs/superpowers/spikes/2026-09-powersync-spike-findings.md "../ThanjaiCafe-Billing-App/docs/superpowers/spikes/"
cd "../ThanjaiCafe-Billing-App"
git switch docs/cafe-billing-saas-design
mkdir -p docs/superpowers/spikes
git add docs/superpowers/spikes/2026-09-powersync-spike-findings.md
git commit -m "docs: PowerSync spike findings and decision"
git push origin spike/powersync
```
(Create the findings file in the spike worktree first, so the `cp` has a source.)

- [ ] **Step 4: Apply the gate.**
  - Tests 1-5 all PASS: write **Plan 2 (Phase 1 Foundation)** for PowerSync.
  - Any of 1-4 FAIL, or 5 still failing after one index fix: write **Plan 2 for custom sync on Dexie** (Option B behind the repository seam).
  - Update the spec with every entry under "Consequences for the spec" before writing Plan 2.

- [ ] **Step 5: Clean up.** `git worktree remove ../ThanjaiCafe-Billing-App-spike` after the branch is pushed. Keep the `cafe-dev` Supabase project as the permanent dev/staging project; drop the spike tables (`spike_webhook_log`) there before Phase 1.

---

## Done when

- Phase 0: rotated secrets; production build refuses a secret-looking `VITE_` value; migrations are code with CI green; `create-order` is origin-checked and rate limited; the kitchen screen no longer bills; auto KOT works behind a setting.
- Spike: the findings document is committed with a PASS or FAIL for tests 1-9 and a written decision.
