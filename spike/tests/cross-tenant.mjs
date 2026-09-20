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
check('another shop cannot read the bill', (seenByB.data ?? []).length === 0 && !seenByB.error);
const shopsSeen = await clientB1.from('shops').select('id');
check('a device sees only its own shop', shopsSeen.data?.length === 1 && shopsSeen.data[0].id === b1.shopId);

// 6. bill_lines: test the new policy requiring bill to belong to caller's shop.
// First, shop B inserts its own bill and one line for it.
const billB = bill(b1);
r = await clientB1.from('bills').insert(billB);
check('shop B inserts its own bill', !r.error, r.error?.message);
const lineB = {
  id: randomUUID(), bill_id: billB.id, shop_id: b1.shopId, product_id: randomUUID(),
  name: 'Test Product', qty: 1, unit: 'pcs', unit_price_paise: 1000, line_total_paise: 1000,
};
r = await clientB1.from('bill_lines').insert(lineB);
check('shop B inserts a line for its own bill', !r.error, r.error?.message);

// Now shop A tries to violate the policy.
const lineABadBillB = { ...lineB, id: randomUUID(), shop_id: a1.shopId };
r = await clientA1.from('bill_lines').insert(lineABadBillB);
check('cannot insert a line for another shop\'s bill', r.error?.code === '42501', r.error?.code);

const lineABadShopB = { ...lineB, id: randomUUID(), shop_id: b1.shopId, bill_id: own.id };
r = await clientA1.from('bill_lines').insert(lineABadShopB);
check('cannot insert a line with wrong shop_id even if bill is owned', r.error?.code === '42501', r.error?.code);

// Shop A inserts a valid line for its own bill.
const lineAOwn = {
  id: randomUUID(), bill_id: own.id, shop_id: a1.shopId, product_id: randomUUID(),
  name: 'Test Product', qty: 1, unit: 'pcs', unit_price_paise: 1000, line_total_paise: 1000,
};
r = await clientA1.from('bill_lines').insert(lineAOwn);
check('shop A inserts a valid line for its own bill', !r.error, r.error?.message);

// Shop A cannot see shop B's line.
const seenLineByA = await clientA1.from('bill_lines').select('id').eq('id', lineB.id);
check('shop A cannot read shop B\'s line', (seenLineByA.data ?? []).length === 0 && !seenLineByA.error);

// 7. products: test read scope, insert, and update restrictions.
const productsA = await clientA1.from('products').select('shop_id');
check('shop A selects >0 products and all have shop_id = A',
  (productsA.data ?? []).length > 0 && (productsA.data ?? []).every(p => p.shop_id === a1.shopId));

r = await clientA1.from('products').insert({
  id: randomUUID(), shop_id: b1.shopId, name: 'Test', unit: 'pcs', price_paise: 1000,
});
check('cannot insert a product for another shop', r.error?.code === '42501', r.error?.code);

// Get a product from shop B via clientB1, then try to update it via clientA1.
const productsB = await clientB1.from('products').select('id, name');
check('shop B can read its own products', !productsB.error && (productsB.data ?? []).length > 0);
const productBId = productsB.data?.[0]?.id;
const originalName = productsB.data?.[0]?.name;
r = await clientA1.from('products').update({ name: 'Hacked' }).eq('id', productBId);
const productBAfter = await clientB1.from('products').select('name').eq('id', productBId);
check('cannot update another shop\'s product', productBAfter.data?.[0]?.name === originalName);

// 8. devices: test read scope.
const devicesA = await clientA1.from('devices').select('code');
check('shop A sees exactly its two devices (T1, T2)',
  (devicesA.data ?? []).length === 2 && (devicesA.data ?? []).map(d => d.code).sort().join(',') === 'T1,T2');

// 9. The JWT carries the claims the policies rely on.
const { data: { session } } = await clientA1.auth.getSession();
const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString());
check('token carries shop_id and device_id', claims.shop_id === a1.shopId && claims.device_id === a1.deviceId);
check('app_metadata carries the same shop_id', claims.app_metadata?.shop_id === a1.shopId);

console.log(failures === 0 ? '\nAll cross-tenant checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
