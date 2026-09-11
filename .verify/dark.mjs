import { launch } from './launch.mjs';
const b = await launch();
const p = await b.newPage({viewport:{width:1440,height:950}, colorScheme:'dark'});
const errors=[]; p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://localhost:5173/'); await p.waitForTimeout(2500);
await p.locator('button', { hasText: /Owner/i }).first().click(); await p.waitForTimeout(300);
for(const d of ['1','2','3','4']){await p.getByRole('button',{name:d,exact:true}).click();await p.waitForTimeout(70);}
await p.waitForTimeout(2500);
await p.screenshot({path:'.verify/dark-dash.png'});
await p.goto('http://localhost:5173/billing'); await p.waitForTimeout(1500);
await p.screenshot({path:'.verify/dark-pos.png'});
console.log('dark class:', await p.evaluate(()=>document.documentElement.className));
console.log('errors:',errors.length);
await b.close();
