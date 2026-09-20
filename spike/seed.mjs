// Seeds two shops and three devices into the SPIKE project. Reads the service-role key
// from your shell only; it is never written to a file.
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const url = process.env.SPIKE_SUPABASE_URL;
const serviceKey = process.env.SPIKE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Set SPIKE_SUPABASE_URL and SPIKE_SERVICE_ROLE_KEY in your shell first.');
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const plan = [
  { name: 'Spike Cafe A', slug: 'a', devices: ['T1', 'T2'] },
  { name: 'Spike Cafe B', slug: 'b', devices: ['T1'] },
];
const productNames = ['Filter Coffee', 'Masala Tea', 'Vadai', 'Rava Kesari', 'Plum Cake (per kg)'];
const credentials = [];

for (const shop of plan) {
  const { data: shopRow, error: shopErr } = await admin.from('shops').insert({ name: shop.name }).select().single();
  if (shopErr) throw shopErr;

  await admin.from('products').insert(productNames.map((name, i) => ({
    id: randomUUID(), shop_id: shopRow.id, name,
    unit: name.includes('per kg') ? 'kg' : 'pcs', price_paise: 1500 + i * 2500,
  }))).throwOnError();

  for (const code of shop.devices) {
    const email = `${shop.slug}-${code.toLowerCase()}@spike.example.com`;
    const password = randomBytes(18).toString('base64url');
    const { data: user, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (userErr) throw userErr;
    const { data: dev, error: devErr } = await admin.from('devices')
      .insert({ shop_id: shopRow.id, auth_user_id: user.user.id, code }).select().single();
    if (devErr) throw devErr;
    credentials.push({ shop: shop.name, shopId: shopRow.id, code, deviceId: dev.id, email, password });
  }
}

writeFileSync('spike-credentials.local', JSON.stringify(credentials, null, 2));
console.log(`Seeded ${credentials.length} devices. Logins written to spike-credentials.local (gitignored).`);
