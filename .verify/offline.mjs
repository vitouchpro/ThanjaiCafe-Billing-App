import { launch } from './launch.mjs';
const b = await launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const errors=[]; p.on('pageerror',e=>errors.push(e.message));

await p.goto('http://localhost:4173/', { waitUntil:'networkidle' });
await p.waitForTimeout(3500);
console.log('SW registered:', await p.evaluate(async()=>{
  const r = await navigator.serviceWorker.getRegistrations();
  return r.length > 0;
}));

// Login and make a bill while online
await p.locator('button', { hasText: /Owner/i }).first().click(); await p.waitForTimeout(300);
for(const d of ['1','2','3','4']){await p.getByRole('button',{name:d,exact:true}).click();await p.waitForTimeout(70);}
await p.waitForTimeout(2000);

console.log('\n--- GOING OFFLINE ---');
await ctx.setOffline(true);
await p.waitForTimeout(500);

// Full reload with no network at all
await p.reload({ waitUntil:'domcontentloaded' });
await p.waitForTimeout(3500);
const body = await p.locator('body').innerText();
console.log('Loaded offline:', body.length > 100);
console.log(body.slice(0,180).replace(/\n+/g,' | '));

// Complete a sale while offline
await p.goto('http://localhost:4173/billing', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(2000);
await p.getByRole('button',{name:/Add Filter Coffee/i}).click(); await p.waitForTimeout(300);
await p.getByRole('button',{name:/Complete Bill/i}).click(); await p.waitForTimeout(700);
const chip = p.locator('[role=dialog] button').filter({hasText:/^Exact ₹/}).first();
if(await chip.count()) await chip.click();
await p.waitForTimeout(300);
await p.getByRole('button',{name:/Complete · Change/i}).click();
await p.waitForTimeout(1500);
const succ = await p.locator('[role=dialog]').innerText();
console.log('\nOFFLINE SALE:', succ.split('\n').filter(Boolean).slice(0,5).join(' | '));
await p.screenshot({path:'.verify/offline-sale.png'});
console.log('errors:', errors.length); errors.slice(0,5).forEach(e=>console.log(' !',e));
await b.close();
