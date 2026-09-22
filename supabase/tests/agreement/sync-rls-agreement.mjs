// Run: SPIKE_SUPABASE_URL=... SPIKE_SERVICE_ROLE_KEY=... SPIKE_ANON_KEY=... node supabase/tests/agreement/sync-rls-agreement.mjs
//
// Asserts, for every table named in the Sync Streams config, that the set of
// rows a device's Sync Stream query would return equals the set of rows that
// same device's RLS-scoped `select *` actually returns. This is spec 4.1's
// literal Phase 1 gate requirement: "An automated test asserts both agree,
// for every table."
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { TABLE_MANIFEST } from '../isolation/table-manifest.mjs';

const manifestByTable = new Map(TABLE_MANIFEST.map((e) => [e.table, e]));

const yamlPath = new URL('../../../docs/superpowers/ops/sync-streams-phase1.yaml', import.meta.url);
const config = parse(readFileSync(yamlPath, 'utf8'));

// Extract {table, whereClause} from every `SELECT <cols> FROM <table> WHERE ...` query.
// NOTE: the column list is not always `*` — availability_schedules casts a
// few columns to text because PowerSync's Sync Streams validator rejects
// raw int[]/time columns (see Task 21). The regex accepts any column list
// before FROM; the agreement check below always re-selects just `id`, so the
// original query's column list doesn't affect the comparison.
function extractQueries(cfg) {
  const out = [];
  for (const stream of Object.values(cfg.streams)) {
    for (const q of stream.queries) {
      const m = /SELECT .+ FROM (\w+) WHERE (.+)/i.exec(q);
      if (!m) throw new Error(`Cannot parse sync stream query: ${q}`);
      out.push({ table: m[1], whereClause: m[2] });
    }
  }
  return out;
}

const queries = extractQueries(config);
console.log(`Parsed ${queries.length} sync stream queries across ${Object.keys(config.streams).length} streams.`);
if (queries.length === 0) { console.error('FAIL  no queries parsed from sync-streams-phase1.yaml'); process.exit(1); }

// For each query, replace auth.parameter('shop_id') with a literal test
// shop id and run it via service_role (bypasses RLS: this is "what the sync
// stream WOULD return"), then run the same table's RLS-scoped select as the
// real signed-in device (this is "what RLS ACTUALLY allows"), and assert
// the two id sets are equal.
const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
const anonKey = process.env.SPIKE_ANON_KEY;
if (!url || !serviceKey || !anonKey) { console.error('Set SPIKE_SUPABASE_URL, SPIKE_SERVICE_ROLE_KEY, SPIKE_ANON_KEY.'); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

const { data: account } = await admin.from('accounts').insert({ name: 'Agreement Test Account' }).select().single();
const { data: shop } = await admin.from('shops').insert({ account_id: account.id, name: 'Agreement Test Shop' }).select().single();
const email = `agree-${crypto.randomUUID()}@isolation.test`;
const password = crypto.randomUUID();
const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const { data: device } = await admin.from('devices').insert({ shop_id: shop.id, auth_user_id: user.user.id, code: 'AG1', role: 'backoffice' }).select().single();
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
await anon.auth.signInWithPassword({ email, password });

// Seed one representative row per table that has a manifest entry (Task 20's
// TABLE_MANIFEST), so the sync-vs-RLS comparison below has real, non-empty
// data to agree on for those tables instead of vacuously comparing two empty
// sets. Tables without a manifest entry remain leak-only checks (still
// meaningful, just weaker: they'd only catch RLS scoped to the wrong shop,
// not RLS that's missing/disabled entirely on an otherwise-empty table).
let seedSeq = 1;
for (const { table } of queries) {
  const entry = manifestByTable.get(table);
  if (!entry || entry.shopScoped === false) continue;
  const row = entry.buildRow({ shopId: shop.id, deviceId: device.id, seq: seedSeq++ });
  const { error: seedErr } = await admin.from(table).insert(row);
  if (seedErr) console.log(`(seed warning) ${table}: ${seedErr.message}`);
}

for (const { table, whereClause } of queries) {
  // Sync side: run the literal SQL via service_role's Postgres session using
  // an RPC wrapper (service_role can execute arbitrary read SQL through
  // `execute_sql`, a SECURITY DEFINER helper scoped to select-only — see
  // Step 4). RLS side: the plain table query through the signed-in device.
  const literalWhere = whereClause
    .replace(/auth\.parameter\('shop_id'\)/g, `'${shop.id}'`)
    .replace(/auth\.parameter\('device_role'\)/g, `'${device.role}'`);
  const { data: syncRows, error: syncErr } = await admin.rpc('execute_readonly_sql', {
    query: `select id from public.${table} where ${literalWhere}`,
  });
  const { data: rlsRows, error: rlsErr } = await anon.from(table).select('id');

  if (syncErr || rlsErr) { check(`${table}: agreement query ran`, false, (syncErr ?? rlsErr).message); continue; }

  const syncIds = new Set((syncRows ?? []).map((r) => r.id));
  const rlsIds = new Set((rlsRows ?? []).map((r) => r.id));
  const agree = syncIds.size === rlsIds.size && [...syncIds].every((id) => rlsIds.has(id));
  check(`${table}: sync-stream scope matches RLS scope${manifestByTable.has(table) ? ' (seeded)' : ''}`, agree, `sync=${syncIds.size} rls=${rlsIds.size}`);
}

await admin.from('devices').delete().eq('id', device.id);
await admin.from('shops').delete().eq('id', shop.id);
await admin.from('accounts').delete().eq('id', account.id);
await admin.auth.admin.deleteUser(user.user.id);

console.log(failures === 0 ? '\nAll sync/RLS agreement checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
