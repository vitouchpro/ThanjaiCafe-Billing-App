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
