import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { launch } from './launch.mjs';

/* End-to-end check for QR customer ordering, across all three surfaces:
   the diner's phone (/order), the kitchen board (/kitchen), and the
   cashier's Online Orders page (/billing/online).

   This machine cannot reach Supabase — the user's ISP DNS-hijacks
   *.supabase.co, so even a correctly configured project fails to connect.
   That is an environment fact, not a bug, so this script treats "cannot
   reach the server" as a clean SKIP (exit 0), never a FAIL. It only makes
   real assertions once a live health check proves the server answers. */

const BASE = 'http://localhost:5173';
const __dirname = dirname(fileURLToPath(import.meta.url));

let failed = false;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ': ' + detail : ''}`);
  if (!ok) failed = true;
};

function skip(reason) {
  console.log(`SKIP — ${reason}`);
  console.log('\nRESULT: SKIP');
  process.exit(0);
}

/* .env.local is read directly rather than through Vite, because this is a
   plain node script. A minimal line parser is enough — no dotenv dependency
   for two values. Lines are KEY=VALUE, blank lines and #-comments ignored,
   surrounding quotes stripped. */
function readEnvLocal(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = readEnvLocal(join(__dirname, '..', '.env.local'));
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  skip('VITE_SUPABASE_URL is not set (no .env.local, or the key is absent). Online ordering is not ' +
    'configured on this machine — nothing to verify. Configure it and re-run to exercise this script for real.');
}

/* Reachability probe: a short fetch against the health endpoint, not a full
   client round-trip. AbortController bounds it to 5s so a DNS hijack (which
   resolves but then fails TLS) cannot hang the script — it just needs to be
   provably unreachable, quickly. */
async function supabaseReachable(url, anonKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      signal: controller.signal,
      headers: anonKey ? { apikey: anonKey } : {},
    });
    /* Any HTTP answer means the host is up and talking. Testing `res.ok` here
       was wrong: without an apikey the endpoint replies 401, and a server that
       says "who are you?" is plainly reachable. That false negative made this
       script skip on a perfectly good connection, which would have hidden a
       real failure behind a reassuring message. */
    return res.status > 0;
  } catch {
    // Only a thrown error — DNS failure, refused connection, TLS error, or the
    // abort above — means we genuinely could not reach it.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const reachable = await supabaseReachable(SUPABASE_URL, ANON_KEY);
if (!reachable) {
  skip(`Supabase is configured (${SUPABASE_URL}) but not reachable from this machine within 5s ` +
    '(DNS hijack or network block on *.supabase.co is a known issue on some ISPs here). Cannot verify ' +
    'live behaviour — this is not a code failure.');
}

console.log(`Supabase reachable at ${SUPABASE_URL} — running full checks.\n`);

const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// ---------------------------------------------------------------------------
// 1. /order?t=T04 loads the published menu with no staff session.
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/order?t=T04`);
await page.waitForTimeout(1000);

const menuLoaded = await (async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const text = await page.locator('body').innerText();
    if (/Review order|Sold out|Add/.test(text)) return true;
    if (/Online ordering is unavailable|Could not load the menu/i.test(text)) return false;
    await page.waitForTimeout(1000);
  }
  return false;
})();
check('/order?t=T04 loads the published menu with no session', menuLoaded);

if (!menuLoaded) {
  console.log('\nCannot proceed without a loaded menu — check that Settings → Online Ordering has a ' +
    'published menu and that T04 exists.');
  await b.close();
  console.log('\nRESULT: FAIL');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Adding items updates the cart total.
// ---------------------------------------------------------------------------
const addButtons = page.getByRole('button', { name: /^Add /i });
const addCount = await addButtons.count();
let cartUpdated = false;
if (addCount > 0) {
  await addButtons.first().click();
  await page.waitForTimeout(400);
  const bodyText = await page.locator('body').innerText();
  cartUpdated = /Review order/i.test(bodyText) && /₹/.test(bodyText);
}
check('adding an item updates the cart total', cartUpdated, `${addCount} add button(s) found`);

// ---------------------------------------------------------------------------
// 3. Checkout asks for nothing: no sign-in, no name, no phone.
// ---------------------------------------------------------------------------
const reviewLink = page.getByRole('link', { name: /Review order/i }).or(page.locator('a[href*="checkout"]'));
if (await reviewLink.count()) {
  await reviewLink.first().click();
} else {
  await page.goto(`${BASE}/order/checkout?t=T04`);
}
await page.waitForTimeout(1200);
const checkoutText = await page.locator('body').innerText();
check(
  'checkout asks the diner for nothing — no sign-in, no name, no phone',
  !/Continue with Google|Sign in|Mobile number|Your name/i.test(checkoutText),
  checkoutText.slice(0, 160),
);

// ---------------------------------------------------------------------------
// 4-7 require inserting test rows directly, which needs the service-role
// key. It must never be committed, so it only ever comes from the
// environment. Its absence is a clean, explained skip of those steps —
// not a failure of the whole script.
// ---------------------------------------------------------------------------
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.log('\nSKIP steps 4-7 (kitchen visibility, billing/online, bill history, status page) — ' +
    'SUPABASE_SERVICE_ROLE_KEY is not set in the environment. That key is required to insert a test ' +
    'order directly (bypassing the payment gateway, which cannot be automated), and it must never be ' +
    'committed or hardcoded here. Set it in the shell environment to exercise steps 4-7.');
  await b.close();
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS (partial — steps 1-3 only)');
  process.exit(failed ? 1 : 0);
}

const { createClient } = await import('@supabase/supabase-js');
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const testToken = `E2E-${Date.now()}`;
let orderId;

try {
  // Insert AWAITING_PAYMENT first, to prove the kitchen never sees it.
  const { data: order, error: insertErr } = await admin.from('orders').insert({
    token: testToken,
    table_code: 'T04',
    status: 'AWAITING_PAYMENT',
    subtotal: 50,
    tax: 0,
    total: 50,
  }).select().single();

  if (insertErr || !order) {
    check('insert a test order for steps 4-7', false, insertErr?.message ?? 'no row returned');
    throw new Error('setup failed');
  }
  orderId = order.id;

  await admin.from('order_lines').insert({
    order_id: orderId,
    product_id: 'test-product',
    name: 'E2E Test Item',
    unit_price: 50,
    qty: 1,
    tax_rate: 0,
  });

  // ---------------------------------------------------------------------
  // 5. AWAITING_PAYMENT must NOT appear on /kitchen. This is the most
  // important assertion in this file: the kitchen never sees unpaid food.
  // ---------------------------------------------------------------------
  await page.goto(`${BASE}/kitchen`);
  await page.waitForTimeout(2000);
  const kitchenTextUnpaid = await page.locator('body').innerText();
  check(
    'an AWAITING_PAYMENT order does NOT appear on /kitchen',
    !kitchenTextUnpaid.includes(testToken),
    kitchenTextUnpaid.includes(testToken) ? 'token was visible while unpaid — CRITICAL' : 'not visible, correct',
  );

  // ---------------------------------------------------------------------
  // 4. Mark PAID (simulating what verify-payment alone is allowed to do
  // in production) and confirm it appears on /kitchen within 10s.
  // ---------------------------------------------------------------------
  const { error: payErr } = await admin.from('orders')
    .update({ status: 'PAID', paid_at: new Date().toISOString() })
    .eq('id', orderId);
  check('mark the test order PAID', !payErr, payErr?.message ?? '');

  const seenOnKitchen = await (async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await page.reload();
      await page.waitForTimeout(800);
      const text = await page.locator('body').innerText();
      if (text.includes(testToken)) return true;
    }
    return false;
  })();
  check('a PAID order appears on /kitchen within 10 seconds', seenOnKitchen);

  // ---------------------------------------------------------------------
  // 6. Appears on /billing/online, and a bill exists in Bill History with
  // the Online badge. The till claims PAID orders into bills on its own
  // poll/subscription (useOrderIntake), so give it a moment to do that.
  // ---------------------------------------------------------------------
  await page.goto(`${BASE}/billing/online`);
  await page.waitForTimeout(2000);
  const onlineOrdersText = await page.locator('body').innerText();
  check('the order appears on /billing/online', onlineOrdersText.includes(testToken));

  const billedInHistory = await (async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const { data } = await admin.from('orders').select('bill_id,status').eq('id', orderId).maybeSingle();
      if (data?.bill_id) return true;
      await page.waitForTimeout(1500);
    }
    return false;
  })();
  check(
    'a bill was auto-created for the paid order (carries sourceOrderId → Online badge)',
    billedInHistory,
    billedInHistory ? '' : 'no till claimed the order into a bill within 15s — is one running against this project?',
  );

  // ---------------------------------------------------------------------
  // 7. Advancing to READY on the kitchen board updates the customer's
  // status page.
  // ---------------------------------------------------------------------
  const { error: readyErr } = await admin.from('orders')
    .update({ status: 'READY', ready_at: new Date().toISOString() })
    .eq('id', orderId);
  check('advance the order to READY', !readyErr, readyErr?.message ?? '');

  const statusPage = await ctx.newPage();
  await statusPage.goto(`${BASE}/order/status/${orderId}`);
  const readyShown = await (async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const text = await statusPage.locator('body').innerText();
      if (/ready/i.test(text)) return true;
      await statusPage.waitForTimeout(1000);
    }
    return false;
  })();
  check('the customer status page reflects READY', readyShown);
  await statusPage.close();
} finally {
  // Best-effort cleanup: never leave synthetic test data in a live project.
  if (orderId) {
    await admin.from('order_lines').delete().eq('order_id', orderId);
    await admin.from('orders').delete().eq('id', orderId);
  }
}

check('zero page errors across the run', pageErrors.length === 0, `count: ${pageErrors.length}`);
pageErrors.forEach((e) => console.log('  page error:', e));

await b.close();

if (failed) {
  console.log('\nRESULT: FAIL');
  process.exit(1);
} else {
  console.log('\nRESULT: PASS');
}
