import { launch } from './launch.mjs';

/* Proves /order is reachable by a diner with NO session: no redirect to
   /login, no staff navigation, and no flash of the till's boot screen
   (App.tsx skips useAppStore's init() for /order routes — see App.tsx).
   What /order?t=T04 renders depends on whether online ordering is configured
   AND reachable, so this script accepts any of the three honest outcomes: the
   "unavailable" notice (no credentials), a readable load failure (credentials
   present but the server unreachable), or the menu itself. What it does NOT
   accept is a blank page, a raw developer error, or a diner reaching the till. */

const BASE = 'http://localhost:5173';
let failed = false;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ': ' + detail : ''}`);
  if (!ok) failed = true;
};

const consoleErrors = [];
const pageErrors = [];

const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
p.on('pageerror', (e) => pageErrors.push(e.message));

// 1. /order?t=T04 loads with no session and does not redirect to /login.
await p.goto(`${BASE}/order?t=T04`);
await p.waitForTimeout(1500);
const urlWithTable = p.url();
check(
  '/order?t=T04 does not redirect to /login',
  !urlWithTable.includes('/login'),
  `final URL: ${urlWithTable}`,
);

// It should render the "unavailable" state since there is no .env.local.
/* The page settles into one of three states, and a load failure can take up
   to the client's 10s timeout to appear, so wait for a settled state rather
   than sampling once. */
const settled = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const t = await p.locator('body').innerText();
    if (t.includes('Online ordering is unavailable')) return ['cloud unconfigured', t];
    if (/Could not load the menu|isn't ready yet/i.test(t)) return ['reachable failure, readable message', t];
    if (/Review order|Sold out|Add/.test(t)) return ['menu rendered', t];
    await p.waitForTimeout(1000);
  }
  return [null, await p.locator('body').innerText()];
};

const [state, bodyWithTable] = await settled();
check('/order?t=T04 renders a real state, not a blank page', state !== null, state ?? 'still blank after 15s');

// A raw developer error must never reach a diner.
check(
  'no developer error text is shown to the customer',
  !/TypeError|undefined is not|Failed to fetch|stack/i.test(bodyWithTable),
);

// 2. No staff navigation anywhere on the page.
const hasNoDashboard = !bodyWithTable.includes('Dashboard');
const hasNoDayClose = !bodyWithTable.includes('Daily Closing');
const hasNoReports = !bodyWithTable.includes('Reports');
check('page contains no "Dashboard" link', hasNoDashboard);
check('page contains no "Daily Closing" link', hasNoDayClose);
check('page contains no "Reports" link', hasNoReports);

/* The three checks above match visible text, so an icon-only link — or one
   labelled anything else — would slip past them. This asks the DOM instead:
   no anchor on a customer page may point into the till, whatever it says. */
const staffHrefs = await p.$$eval('a[href]', (as) =>
  as.map((a) => a.getAttribute('href') ?? '')
    .filter((h) => /^\/(billing|products|reports|settings|day-close|kitchen|login)(\/|$)/.test(h) || h === '/'));
check(
  'no anchor points at a staff route',
  staffHrefs.length === 0,
  staffHrefs.length ? `found: ${staffHrefs.join(', ')}` : 'none',
);

// 3. /order with no `t` shows the scan-the-QR-code prompt.
await p.goto(`${BASE}/order`);
await p.waitForTimeout(1200);
const bodyNoTable = await p.locator('body').innerText();
check(
  '/order (no t) shows the scan-the-QR-code prompt',
  bodyNoTable.includes('Scan the QR code on your table to order'),
);
check(
  '/order (no t) does not redirect to /login',
  !p.url().includes('/login'),
  `final URL: ${p.url()}`,
);

// 4. No flash of the till's boot screen — customer routes skip staff init().
check(
  'no till boot screen ("Preparing your counter…")',
  !bodyWithTable.includes('Preparing your counter') && !bodyNoTable.includes('Preparing your counter'),
);

// 5. Zero console errors and zero page errors across the whole check.
const appErrors = consoleErrors.filter((e) => !/ERR_|Failed to load resource|WebSocket|net::/i.test(e));
check(
  'no console errors from the app itself',
  appErrors.length === 0,
  `app: ${appErrors.length}, network/environment: ${consoleErrors.length - appErrors.length}`,
);
consoleErrors.forEach((e) => console.log('  console error:', e));
check('zero page errors', pageErrors.length === 0, `count: ${pageErrors.length}`);
pageErrors.forEach((e) => console.log('  page error:', e));

await b.close();

if (failed) {
  console.log('\nRESULT: FAIL');
  process.exit(1);
} else {
  console.log('\nRESULT: PASS');
}
