import { launch } from './launch.mjs';
const b = await launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const errors=[]; p.on('pageerror',e=>errors.push(e.message));

await p.goto('http://localhost:4173/', {waitUntil:'networkidle'});
await p.waitForTimeout(4000);
await p.locator('button', { hasText: /Owner/i }).first().click(); await p.waitForTimeout(400);
for(const d of ['1','2','3','4']){await p.getByRole('button',{name:d,exact:true}).click();await p.waitForTimeout(80);}
await p.waitForTimeout(2000);
await p.goto('http://localhost:4173/billing', {waitUntil:'networkidle'});
await p.waitForTimeout(2500);

console.log('--- GOING OFFLINE ---');
await ctx.setOffline(true);
await p.waitForTimeout(400);
await p.reload({waitUntil:'domcontentloaded'});
await p.waitForTimeout(4000);
await p.goto('http://localhost:4173/billing', {waitUntil:'domcontentloaded'});
await p.waitForTimeout(3000);

const stats = await p.evaluate(() => {
  const imgs = [...document.querySelectorAll('button[aria-label^="Add "] img')];
  return {
    imgs: imgs.length,
    broken: imgs.filter(i => !i.complete || i.naturalWidth === 0).length,
  };
});
console.log('OFFLINE IMAGES:', JSON.stringify(stats));
await p.screenshot({path:'.verify/offline-photos.png'});
console.log('errors:', errors.length);
await b.close();
