import { launch } from './launch.mjs';
const b = await launch();
const p = await b.newPage({viewport:{width:1440,height:950}});
const errors=[]; p.on('pageerror',e=>errors.push(e.message));
p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});

await p.goto('http://localhost:5173/'); await p.waitForTimeout(3000);
await p.locator('button', { hasText: /Owner/i }).first().click(); await p.waitForTimeout(400);
for(const d of ['1','2','3','4']){await p.getByRole('button',{name:d,exact:true}).click();await p.waitForTimeout(80);}
await p.waitForTimeout(2500);

await p.goto('http://localhost:5173/billing'); await p.waitForTimeout(2000);

// How many product cards actually render an <img>?
const stats = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('button[aria-label^="Add "]')];
  let withImg = 0, withTile = 0, broken = 0;
  for (const c of cards) {
    const img = c.querySelector('img');
    if (img) {
      withImg++;
      if (!img.complete || img.naturalWidth === 0) broken++;
    } else if (c.querySelector('.product-thumb')) withTile++;
  }
  const srcs = [...document.querySelectorAll('button[aria-label^="Add "] img')].map(i=>i.currentSrc||i.src);
  const photos = srcs.filter(s => s.includes('/products/')).length;
  const svgs = srcs.filter(s => s.startsWith('data:image/svg')).length;
  return { total: cards.length, withImg, withTile, broken, photos, svgs };
});
console.log('PRODUCT CARDS:', JSON.stringify(stats));
await p.screenshot({path:'.verify/img-pos.png'});

await p.goto('http://localhost:5173/products'); await p.waitForTimeout(1800);
await p.screenshot({path:'.verify/img-products.png'});
console.log('errors:', errors.length); errors.slice(0,5).forEach(e=>console.log(' !',e));
await b.close();
