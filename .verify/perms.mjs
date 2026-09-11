import { launch } from './launch.mjs';
const b = await launch();
const p = await b.newPage({viewport:{width:1440,height:950}});
const errors=[]; p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://localhost:5173/'); await p.waitForTimeout(2500);

// Sign in as the CASHIER — must not see cost, reports, or settings.
await p.getByText('Priya').click(); await p.waitForTimeout(400);
for(const d of ['3','4','5','6']){await p.getByRole('button',{name:d,exact:true}).click();await p.waitForTimeout(80);}
await p.waitForTimeout(2200);
console.log('cashier landed on:', p.url());
const nav = await p.locator('aside').first().innerText();
console.log('\nSIDEBAR:\n' + nav.split('\n').filter(Boolean).join(' | '));
await p.screenshot({path:'.verify/perm-cashier.png'});

// Deep-link to a forbidden route
await p.goto('http://localhost:5173/reports'); await p.waitForTimeout(1500);
const body = await p.locator('body').innerText();
console.log('\n/reports as cashier:', body.includes('do not have access') ? 'BLOCKED ✓' : 'LEAKED ✗');
await p.goto('http://localhost:5173/products'); await p.waitForTimeout(1200);
const pb = await p.locator('body').innerText();
console.log('/products as cashier:', pb.includes('do not have access') ? 'BLOCKED ✓' : 'LEAKED ✗');
console.log('errors:', errors.length);
await b.close();
