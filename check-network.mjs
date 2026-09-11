/* Is Supabase reachable from this connection?

   Written because an earlier diagnosis of this was wrong: a reverse-DNS record
   pointing at an ISP was mistaken for that ISP hijacking the domain. The fix is
   to measure rather than infer — resolve through several resolvers, then
   actually CONNECT to each answer, because a DNS reply that looks plausible can
   still fail TLS. Run it on whichever network you are about to rely on. */

import { readFileSync } from 'node:fs';
import { Resolver } from 'node:dns/promises';
import { request } from 'node:https';

const env = Object.fromEntries(
  readFileSync(new URL('.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const host = new URL(env.VITE_SUPABASE_URL).hostname;
const apikey = env.VITE_SUPABASE_ANON_KEY;

const RESOLVERS = [
  ['system default', null],
  ['Cloudflare 1.1.1.1', ['1.1.1.1']],
  ['Google 8.8.8.8', ['8.8.8.8']],
];

/** Any HTTP answer proves the host is up. Without an apikey it replies 401,
    and a server asking "who are you?" is plainly reachable. */
const connect = (ip) => new Promise((resolve) => {
  const started = Date.now();
  const req = request(
    { host: ip, servername: host, port: 443, path: '/auth/v1/health',
      method: 'GET', headers: { host, apikey }, timeout: 8000 },
    (res) => { res.resume(); resolve(`HTTP ${res.statusCode} in ${Date.now() - started}ms`); },
  );
  req.on('timeout', () => { req.destroy(); resolve('TIMED OUT'); });
  req.on('error', (e) => resolve(`FAILED — ${e.code ?? e.message}`));
  req.end();
});

console.log(`Checking ${host}\n`);
let anyWorks = false;

for (const [label, servers] of RESOLVERS) {
  const r = new Resolver();
  if (servers) r.setServers(servers);
  let addrs;
  try {
    addrs = await r.resolve4(host);
  } catch (e) {
    console.log(`  ${label.padEnd(20)} DNS failed — ${e.code ?? e.message}`);
    continue;
  }
  for (const ip of addrs.slice(0, 2)) {
    const outcome = await connect(ip);
    if (outcome.startsWith('HTTP')) anyWorks = true;
    console.log(`  ${label.padEnd(20)} ${ip.padEnd(16)} ${outcome}`);
  }
}

console.log(
  anyWorks
    ? '\nAt least one route works — this connection can reach Supabase.'
    : '\nNo route worked. Try a different network before deploying.',
);
process.exit(anyWorks ? 0 : 1);
