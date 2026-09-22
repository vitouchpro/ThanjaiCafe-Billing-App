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
