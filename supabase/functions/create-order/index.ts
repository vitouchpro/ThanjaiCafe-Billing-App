import { createClient } from 'jsr:@supabase/supabase-js@2';
import { priceOrder, type RequestedLine } from './pricing.ts';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { CREATE_ORDER_LIMITS, clientIp, isOverLimit, rateLimitKey } from '../_shared/rateLimit.ts';

/* Prices a cart and opens a Razorpay payment for it.

   It writes a DRAFT to `pending_orders`, never to `orders`. Staff surfaces read
   `orders` only, so nothing reaches the kitchen or the billing portal until the
   signed webhook confirms the money arrived — that is the shop's rule, and this
   is the half of it that lives here.

   There is no sign-in. A diner gives nothing: the order is identified by the
   table they scanned and the token called out to them. So every value in the
   request is untrusted, and the prices come from the published menu — never
   from the phone. The endpoint is anonymous and money follows it, so callers
   are also rate limited per table. */

Deno.serve(async (req) => {
  const { headers: cors, allowed } = buildCorsHeaders(
    req.headers.get('origin'),
    Deno.env.get('ALLOWED_ORIGINS'),
  );

  if (req.method === 'OPTIONS') {
    return new Response(allowed ? 'ok' : 'forbidden', { status: allowed ? 200 : 403, headers: cors });
  }
  if (!allowed) return json({ error: 'This origin is not allowed.' }, 403, cors);

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json() as { tableCode?: string; lines?: RequestedLine[] };

    /* A table code is required and shape-checked. It is printed on the QR cards
       the shop puts out, so anything else is a hand-edited URL. It reaches the
       kitchen ticket, so it must not carry markup or run long. */
    const tableCode = (body.tableCode ?? '').trim();
    if (!/^[A-Za-z0-9 _-]{1,12}$/.test(tableCode)) {
      return json({ error: 'This link is missing a valid table. Please rescan the code on your table.' }, 400, cors);
    }

    /* Bound how fast one caller, and one table, can open orders. If the limiter
       itself fails we log and carry on: a broken counter must never stop a
       diner from paying. */
    const tooMany = () => json(
      { error: 'Too many orders from this table right now. Please wait a minute and try again.' },
      429, cors, { 'Retry-After': '60' },
    );
    try {
      const ip = clientIp(req);
      // The per-caller counter goes first. A request it rejects must never
      // count against the shared table bucket, or one caller could lock every
      // diner out of the table.
      const perIp = await admin.rpc('bump_rate_limit', {
        p_key: rateLimitKey('create-order', 'ip', ip, tableCode),
        p_window_seconds: CREATE_ORDER_LIMITS.perIpPerTable.windowSeconds,
      });
      if (perIp.error) {
        console.error('create-order: rate limiter unavailable', perIp.error);
      } else if (isOverLimit(Number(perIp.data), CREATE_ORDER_LIMITS.perIpPerTable.max)) {
        return tooMany();
      } else {
        const perTable = await admin.rpc('bump_rate_limit', {
          p_key: rateLimitKey('create-order', 'table', tableCode),
          p_window_seconds: CREATE_ORDER_LIMITS.perTable.windowSeconds,
        });
        if (perTable.error) {
          console.error('create-order: rate limiter unavailable', perTable.error);
        } else if (isOverLimit(Number(perTable.data), CREATE_ORDER_LIMITS.perTable.max)) {
          return tooMany();
        }
      }
    } catch (err) {
      console.error('create-order: rate limiter unavailable', err);
    }

    const { data: menu, error: menuErr } = await admin
      .from('menu_items').select('id, name, price, tax_rate, available');
    if (menuErr) {
      console.error('create-order: menu read failed', menuErr);
      return json({ error: 'Could not load the menu. Please try again.' }, 500, cors);
    }

    // Repriced from the published menu. The phone's prices are display only.
    const { lines, totals } = priceOrder(body.lines ?? [], menu ?? []);

    // Razorpay's minimum is 100 paise; a smaller total would fail there with a
    // message a diner cannot act on.
    if (Math.round(totals.total * 100) < 100) {
      return json({ error: 'This order is below the minimum online payment of ₹1. Please order at the counter.' }, 400, cors);
    }

    const { data: tokenRow, error: tokenErr } = await admin.rpc('next_order_token');
    if (tokenErr) {
      console.error('create-order: token allocation failed', tokenErr);
      return json({ error: 'Could not start the order. Please try again.' }, 500, cors);
    }
    const token = String(tokenRow ?? 'A-00');

    /* The draft carries everything needed to build the real order later, so a
       customer who has paid can never be left without one. */
    const { data: draft, error: draftErr } = await admin.from('pending_orders').insert({
      token,
      table_code: tableCode,
      lines,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    }).select().single();

    if (draftErr) {
      console.error('create-order: draft insert failed', draftErr);
      return json({ error: 'Could not start the order. Please try again.' }, 500, cors);
    }

    const keyId = Deno.env.get('RAZORPAY_KEY_ID')!;
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')!;

    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      },
      body: JSON.stringify({
        amount: Math.round(totals.total * 100),
        currency: 'INR',
        receipt: draft.id,
        notes: { draft_id: draft.id, table: tableCode, token },
      }),
    });

    if (!rzpRes.ok) {
      // No payment can happen, so the draft is litter. Remove it now rather
      // than leaving it for the purge.
      await admin.from('pending_orders').delete().eq('id', draft.id);
      console.error('create-order: razorpay rejected the order', await rzpRes.text());
      return json({ error: 'Could not start the payment. Please try again.' }, 502, cors);
    }

    const rzp = await rzpRes.json();

    /* Linking the draft to the Razorpay order is what lets the webhook find it.
       If this fails the customer could pay with nothing to promote, so the
       payment is abandoned before it can be taken. */
    const { error: linkErr } = await admin.from('pending_orders')
      .update({ razorpay_order_id: rzp.id }).eq('id', draft.id);
    if (linkErr) {
      await admin.from('pending_orders').delete().eq('id', draft.id);
      console.error('create-order: could not link draft to razorpay order', linkErr);
      return json({ error: 'Could not start the payment. Please try again.' }, 500, cors);
    }

    return json({
      draftId: draft.id,
      token,
      tableCode,
      razorpayOrderId: rzp.id,
      amount: rzp.amount,
      currency: rzp.currency,
      keyId,
    }, 200, cors);
  } catch (err) {
    // priceOrder's messages are deliberately specific — they name a sold-out
    // item or a bad quantity, which is something the diner can fix.
    return json({ error: err instanceof Error ? err.message : 'Could not create the order' }, 400, cors);
  }
});

const json = (
  body: unknown,
  status: number,
  cors: Record<string, string>,
  extra: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extra, 'Content-Type': 'application/json' },
  });
