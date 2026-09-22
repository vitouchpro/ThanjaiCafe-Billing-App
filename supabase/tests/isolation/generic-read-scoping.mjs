// Run: SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... SPIKE_ANON_KEY=... node supabase/tests/isolation/generic-read-scoping.mjs
import { createClient } from '@supabase/supabase-js';
import { TABLE_MANIFEST } from './table-manifest.mjs';

const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
const anonKey = process.env.SPIKE_ANON_KEY;
if (!url || !serviceKey || !anonKey) { console.error('Set SPIKE_SUPABASE_URL, SPIKE_SERVICE_ROLE_KEY, SPIKE_ANON_KEY.'); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const { data: account } = await admin.from('accounts').insert({ name: 'Generic Scoping Account' }).select().single();
const { data: shopA } = await admin.from('shops').insert({ account_id: account.id, name: 'Generic Scoping Shop A' }).select().single();
const { data: shopB } = await admin.from('shops').insert({ account_id: account.id, name: 'Generic Scoping Shop B' }).select().single();

const email = `generic-${crypto.randomUUID()}@isolation.test`;
const password = crypto.randomUUID();
const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const { data: deviceA } = await admin.from('devices').insert({ shop_id: shopA.id, auth_user_id: user.user.id, code: 'GS1' }).select().single();
const client = createClient(url, anonKey, { auth: { persistSession: false } });
await client.auth.signInWithPassword({ email, password });

let seq = 1;
for (const entry of TABLE_MANIFEST) {
  if (entry.shopScoped === false) continue; // not tenant-scoped (e.g. plans); skip read-scoping, covered by its own migration's manual check
  const ctxA = { shopId: shopA.id, deviceId: deviceA.id, seq: seq++ };
  const ctxB = { shopId: shopB.id, deviceId: deviceA.id, seq: seq++ }; // deviceId unused by shop-B row's own shop_id column
  const rowA = entry.buildRow(ctxA);
  const rowB = entry.buildRow(ctxB);
  const { error: insErrA } = await admin.from(entry.table).insert(rowA);
  const { error: insErrB } = await admin.from(entry.table).insert(rowB);
  if (insErrA || insErrB) { check(`${entry.table}: seed rows inserted`, false, (insErrA ?? insErrB).message); continue; }

  const seen = await client.from(entry.table).select('shop_id');
  const leaked = (seen.data ?? []).some((r) => r.shop_id === shopB.id);
  check(`${entry.table}: device sees no shop-B rows`, !leaked && !seen.error, seen.error?.message ?? '');
}

console.log(failures === 0 ? '\nAll generic read-scoping checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
