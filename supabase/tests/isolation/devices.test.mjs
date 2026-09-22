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
