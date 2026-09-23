// One representative, concretely-seedable table per subsystem. Read-scoping
// for every table not listed here still runs on the exact same
// has_shop_access() predicate, already proven in Part A (7 tables) and the
// spike (bills, bill_lines, products — 30/30 checks). This manifest is the
// regression net for Part B's 11 migrations, not a claim of exhaustive
// per-table coverage; Task 22's agreement test is what is actually
// exhaustive, because it reads the live table list instead of this fixed one.
//
// bills and audit_log are deliberately NOT listed here. Both carry a
// forbid_mutation() append-only trigger that blocks UPDATE/DELETE for every
// role, including service_role — there is no cleanup path for a row seeded
// into either table. The generic insert-then-delete round trip every other
// manifest entry uses would (and did) leak a full test account/shop/device
// into whichever database the tests ran against on every single run, since
// the leftover row's FK also blocks the shop/device/account teardown, and
// none of these delete calls check their error before moving on.
// Cross-tenant leak coverage for both tables still runs, for free, inside
// supabase/tests/agreement/sync-rls-agreement.mjs: it compares each synced
// table's sync-stream-scoped rows against the signed-in device's RLS-scoped
// rows, and cafe-production already has real bills/audit_log rows under
// shops other than the test's fresh one — an over-permissive policy would
// leak those into the RLS-side result and fail the comparison exactly like
// a seeded negative fixture would, with zero synthetic rows written.
export const TABLE_MANIFEST = [
  { table: 'plans', shopScoped: false, buildRow: () => ({ code: `plan-${crypto.randomUUID()}`, name: 'Test Plan', device_limit: 2, staff_limit: 5, price_paise: 199900 }) },
  { table: 'products', buildRow: (ctx) => ({ id: crypto.randomUUID(), shop_id: ctx.shopId, name: 'Manifest Product', price_paise: 10000 }) },
  { table: 'qr_points', buildRow: (ctx) => ({ shop_id: ctx.shopId, type: 'table', label: 'T1', token: crypto.randomUUID() }) },
  { table: 'shop_daily_stats', buildRow: (ctx) => ({ shop_id: ctx.shopId, business_date: '2026-09-23', bill_count: 1 }) },
  { table: 'tax_rules', buildRow: (ctx) => ({ shop_id: ctx.shopId, hsn_sac: '9963', order_type: 'any', rate_bps: 500, valid_from: '2026-01-01' }) },
  { table: 'tables', buildRow: (ctx) => ({ shop_id: ctx.shopId, label: 'T1' }) },
  { table: 'stock_items', buildRow: (ctx) => ({ shop_id: ctx.shopId, name: 'Manifest Stock Item' }) },
  { table: 'charges', buildRow: (ctx) => ({ shop_id: ctx.shopId, type: 'service_charge', percent_bps: 500 }) },
  { table: 'shifts', buildRow: (ctx) => ({ shop_id: ctx.shopId, device_id: ctx.deviceId }) },
  { table: 'customers', buildRow: (ctx) => ({ shop_id: ctx.shopId, phone: `9${Math.floor(Math.random() * 1_000_000_000)}` }) },
  { table: 'channels', buildRow: (ctx) => ({ shop_id: ctx.shopId, type: 'till' }) },
];
