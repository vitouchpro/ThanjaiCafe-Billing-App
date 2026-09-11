import { launch } from './launch.mjs';

const errors = [];
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const p = await ctx.newPage();
p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const step = (s) => console.log('\n=== ' + s + ' ===');

await p.goto('http://localhost:5173/');
await p.waitForSelector('text=Who is on the counter?', { timeout: 90_000 });

step('LOGIN');
await p.locator('button', { hasText: /Owner/i }).first().click();
await p.waitForTimeout(300);
for (const d of ['1','2','3','4']) { await p.getByRole('button',{name:d,exact:true}).click(); await p.waitForTimeout(70); }
await p.waitForTimeout(2000);
console.log('landed:', p.url());

step('POS — build a bill');
await p.goto('http://localhost:5173/billing');
await p.waitForTimeout(1200);
// add Filter Coffee x2 and Vadai x1
await p.getByRole('button', { name: /Add Filter Coffee/i }).click();
await p.waitForTimeout(200);
await p.getByRole('button', { name: /Add Filter Coffee/i }).click();
await p.waitForTimeout(200);
await p.getByRole('button', { name: /Add Vadai/i }).click();
await p.waitForTimeout(500);
const cartText = await p.locator('aside').last().innerText();
console.log(cartText.slice(0, 600));
await p.screenshot({ path: '.verify/e2e-cart.png' });

step('PAYMENT');
await p.getByRole('button', { name: /Complete Bill/i }).click();
await p.waitForTimeout(800);
await p.screenshot({ path: '.verify/e2e-payment.png' });
const payText = await p.locator('[role=dialog]').innerText();
console.log(payText.slice(0,400));

// cash: click a suggestion then complete
const sugg = p.locator('[role=dialog] button').filter({ hasText: /^₹\d+$/ }).first();
if (await sugg.count()) { await sugg.click(); await p.waitForTimeout(300); }
await p.getByRole('button', { name: /Complete · Change|Complete Payment/i }).click();
await p.waitForTimeout(1500);
await p.screenshot({ path: '.verify/e2e-success.png' });
const succ = await p.locator('[role=dialog]').innerText();
console.log('SUCCESS SCREEN:\n', succ.slice(0,300));

step('NEW BILL');
await p.getByRole('button', { name: 'New Bill' }).click();
await p.waitForTimeout(800);

step('HISTORY');
await p.goto('http://localhost:5173/billing/history');
await p.waitForTimeout(1200);
console.log((await p.locator('body').innerText()).slice(0,400));
await p.screenshot({ path: '.verify/e2e-history.png' });

step('PRODUCTS');
await p.goto('http://localhost:5173/products');
await p.waitForTimeout(1200);
await p.screenshot({ path: '.verify/e2e-products.png' });

step('REPORTS');
await p.goto('http://localhost:5173/reports');
await p.waitForTimeout(1500);
await p.screenshot({ path: '.verify/e2e-reports.png' });
console.log((await p.locator('body').innerText()).slice(0,350));

step('SETTINGS');
await p.goto('http://localhost:5173/settings');
await p.waitForTimeout(1200);
await p.screenshot({ path: '.verify/e2e-settings.png' });

step('DAY CLOSE');
await p.goto('http://localhost:5173/day-close');
await p.waitForTimeout(1200);
await p.screenshot({ path: '.verify/e2e-dayclose.png' });

console.log('\n=== CONSOLE ERRORS: ' + errors.length + ' ===');
errors.slice(0,12).forEach(e=>console.log(' !', e));
await b.close();
