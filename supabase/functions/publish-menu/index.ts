import { createClient } from 'jsr:@supabase/supabase-js@2';

/* Publishes the shop's menu so diners can order from it.

   `menu_items` is world-readable and writable by nobody: a customer holding the
   anon key must not be able to edit prices. But the Publish button lives in the
   owner's browser, which holds exactly that anon key — so publishing from the
   client failed, correctly, with "new row violates row-level security policy".

   The fix is not to hand a browser a key that bypasses RLS. It is to do the
   write here, where the service-role key never leaves the server, behind a
   shared secret only the shop's own till is given.

   Note what this function does NOT do: it does not price anything. It copies a
   menu the till has already priced. The order path never trusts these prices
   either — create-order reprices from this table, which is the point of
   publishing it. */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-publish-token',
};

interface MenuRow {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  price: number;
  tax_rate: number;
  image_url: string | null;
  available: boolean;
  sort_order: number;
}

/* An id is interpolated into a PostgREST `not.in` filter below, which the
   client does not sanitise, so it must be provably inert first. An allowlist,
   not a blocklist: a blocklist has to anticipate every metacharacter, including
   a backslash escaping a closing quote. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  /* A shared secret, set with `supabase secrets set PUBLISH_TOKEN=...` and
     entered once in the till's Settings. Compared in constant time: a
     short-circuiting compare leaks the expected value one byte at a time. */
  const expected = Deno.env.get('PUBLISH_TOKEN') ?? '';
  const given = req.headers.get('x-publish-token') ?? '';
  if (!expected || !timingSafeEqual(given, expected)) {
    return json({ error: 'Not allowed to publish the menu.' }, 401);
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json() as { rows?: MenuRow[] };
    const rows = body.rows ?? [];

    if (!Array.isArray(rows)) return json({ error: 'Expected a list of menu rows.' }, 400);
    if (rows.length > 500) return json({ error: 'That is too many menu items to publish at once.' }, 400);

    // Validate BEFORE writing anything, so a bad id cannot leave the menu
    // half-published.
    const badId = rows.find((r) => !SAFE_ID.test(String(r?.id ?? '')));
    if (badId) {
      return json({ error: `Cannot publish: product id contains invalid characters: ${badId.id}` }, 400);
    }

    // Cost price must never reach this table. The till should not be sending
    // one, but this is the boundary, so it is enforced here too.
    const withCost = rows.find((r) => Object.keys(r).some((k) => /cost/i.test(k)));
    if (withCost) {
      console.error('publish-menu: refused a payload carrying a cost field', Object.keys(withCost));
      return json({ error: 'Cannot publish: the menu payload carried a cost price.' }, 400);
    }

    if (rows.length) {
      const { error } = await admin.from('menu_items').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.error('publish-menu: upsert failed', error);
        return json({ error: 'Could not publish the menu. Please try again.' }, 500);
      }

      // Withdraw anything upstream that is no longer on the shop's menu, so a
      // deleted product stops being orderable.
      const ids = rows.map((r) => `"${r.id}"`).join(',');
      const { error: delErr } = await admin.from('menu_items').delete().not('id', 'in', `(${ids})`);
      if (delErr) {
        console.error('publish-menu: withdraw failed', delErr);
        return json({ error: 'Published, but could not withdraw old items.' }, 500);
      }
    } else {
      /* An empty publish means the shop has nothing sellable. Withdraw the whole
         menu rather than leaving stale items a diner could still order. */
      const { error } = await admin.from('menu_items').delete().neq('id', '');
      if (error) {
        console.error('publish-menu: clear failed', error);
        return json({ error: 'Could not clear the menu. Please try again.' }, 500);
      }
    }

    return json({ published: rows.length });
  } catch (err) {
    console.error('publish-menu: unexpected failure', err);
    return json({ error: 'Could not publish the menu. Please try again.' }, 500);
  }
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
