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
