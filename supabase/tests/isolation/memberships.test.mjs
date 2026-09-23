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
