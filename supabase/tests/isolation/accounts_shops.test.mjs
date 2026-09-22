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
