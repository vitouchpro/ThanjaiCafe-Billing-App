// Run: SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... SPIKE_ANON_KEY=... node supabase/tests/isolation/approvals.test.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
const anonKey = process.env.SPIKE_ANON_KEY;
if (!url || !serviceKey || !anonKey) { console.error('Set SPIKE_SUPABASE_URL, SPIKE_SERVICE_ROLE_KEY, SPIKE_ANON_KEY.'); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const { data: account } = await admin.from('accounts').insert({ name: 'Approvals Isolation Account' }).select().single();
const { data: shopA } = await admin.from('shops').insert({ account_id: account.id, name: 'Approvals Shop A' }).select().single();
const { data: shopB } = await admin.from('shops').insert({ account_id: account.id, name: 'Approvals Shop B' }).select().single();

const { data: managerA } = await admin.from('staff').insert({ shop_id: shopA.id, name: 'Manager A', pin_hash: 'x', pin_salt: 'y', role: 'cashier' }).select().single();
const { data: managerB } = await admin.from('staff').insert({ shop_id: shopB.id, name: 'Manager B', pin_hash: 'x', pin_salt: 'y', role: 'cashier' }).select().single();

const approvalRow = (shopId, managerId) => ({
  shop_id: shopId, action: 'refund', target_id: crypto.randomUUID(), manager_staff_id: managerId,
  nonce: crypto.randomUUID(), signature: 'x', expires_at: new Date(Date.now() + 120_000).toISOString(),
});
await admin.from('approvals').insert([approvalRow(shopA.id, managerA.id), approvalRow(shopB.id, managerB.id)]);

const email = `dev-${crypto.randomUUID()}@isolation.test`;
const password = crypto.randomUUID();
const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
await admin.from('devices').insert({ shop_id: shopA.id, auth_user_id: user.user.id, code: 'AP1' });
const client = createClient(url, anonKey, { auth: { persistSession: false } });
await client.auth.signInWithPassword({ email, password });

const seen = await client.from('approvals').select('shop_id');
check('device sees only its own shop approvals', (seen.data ?? []).length === 1 && seen.data[0].shop_id === shopA.id);

const forged = await client.from('approvals').insert(approvalRow(shopB.id, managerB.id));
check('device cannot insert an approval for another shop', forged.error?.code === '42501', forged.error?.code ?? 'no error');

const seenOwn = await client.from('approvals').select('id').eq('shop_id', shopA.id).single();
const tamper = await client.from('approvals').update({ action: 'void_after_kot' }).eq('id', seenOwn.data.id);
check('cannot rewrite an approval field other than consuming it', tamper.error?.code === '42501', tamper.error?.code ?? 'no error');

await admin.from('approvals').delete().in('shop_id', [shopA.id, shopB.id]);
await admin.from('staff').delete().in('id', [managerA.id, managerB.id]);
await admin.from('devices').delete().eq('auth_user_id', user.user.id);
await admin.from('shops').delete().in('id', [shopA.id, shopB.id]);
await admin.from('accounts').delete().eq('id', account.id);
await admin.auth.admin.deleteUser(user.user.id);

console.log(failures === 0 ? '\nAll approvals isolation checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
