import { devices } from 'playwright';
import { launch } from './launch.mjs';
const b = await launch();
const ctx = await b.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
const errors=[]; p.on('pageerror',e=>errors.push(e.message));
p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});

await p.goto('http://localhost:5173/'); await p.waitForTimeout(2500);
await p.locator('button', { hasText: /Owner/i }).first().click(); await p.waitForTimeout(400);
for(const d of ['1','2','3','4']){await p.getByRole('button',{name:d,exact:true}).click();await p.waitForTimeout(90);}
await p.waitForTimeout(2200);
await p.screenshot({path:'.verify/m-dash.png'});

await p.goto('http://localhost:5173/billing'); await p.waitForTimeout(1500);
await p.getByRole('button',{name:/Add Filter Coffee/i}).click(); await p.waitForTimeout(300);
await p.getByRole('button',{name:/Add Vadai/i}).click(); await p.waitForTimeout(500);
await p.screenshot({path:'.verify/m-pos.png'});

// open the cart sheet
await p.getByRole('button',{name:/View bill/i}).click(); await p.waitForTimeout(700);
await p.screenshot({path:'.verify/m-cart.png'});
console.log('errors:',errors.length); errors.slice(0,6).forEach(e=>console.log(' !',e));
await b.close();
