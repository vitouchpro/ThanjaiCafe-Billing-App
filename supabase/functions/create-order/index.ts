import { createClient } from 'jsr:@supabase/supabase-js@2';
import { priceOrder, type RequestedLine } from './pricing.ts';

/* Prices a cart and opens a Razorpay payment for it.

   It writes a DRAFT to `pending_orders`, never to `orders`. Staff surfaces read
   `orders` only, so nothing reaches the kitchen or the billing portal until the
   signed webhook confirms the money arrived — that is the shop's rule, and this
   is the half of it that lives here.

   There is no sign-in. A diner gives nothing: the order is identified by the
   table they scanned and the token called out to them. So every value in the
   request is untrusted, and the prices come from the published menu — never
   from the phone. */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

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
      return json({ error: 'This link is missing a valid table. Please rescan the code on your table.' }, 400);
    }

    const { data: menu, error: menuErr } = await admin
      .from('menu_items').select('id, name, price, tax_rate, available');
    if (menuErr) {
      console.error('create-order: menu read failed', menuErr);
      return json({ error: 'Could not load the menu. Please try again.' }, 500);
    }

    // Repriced from the published menu. The phone's prices are display only.
    const { lines, totals } = priceOrder(body.lines ?? [], menu ?? []);

    // Razorpay's minimum is 100 paise; a smaller total would fail there with a
    // message a diner cannot act on.
    if (Math.round(totals.total * 100) < 100) {
      return json({ error: 'This order is below the minimum online payment of ₹1. Please order at the counter.' }, 400);
    }

    const { data: tokenRow, error: tokenErr } = await admin.rpc('next_order_token');
    if (tokenErr) {
      console.error('create-order: token allocation failed', tokenErr);
      return json({ error: 'Could not start the order. Please try again.' }, 500);
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
      return json({ error: 'Could not start the order. Please try again.' }, 500);
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
      return json({ error: 'Could not start the payment. Please try again.' }, 502);
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
      return json({ error: 'Could not start the payment. Please try again.' }, 500);
    }

    return json({
      draftId: draft.id,
      token,
      tableCode,
      razorpayOrderId: rzp.id,
      amount: rzp.amount,
      currency: rzp.currency,
      keyId,
    });
  } catch (err) {
    // priceOrder's messages are deliberately specific — they name a sold-out
    // item or a bad quantity, which is something the diner can fix.
    return json({ error: err instanceof Error ? err.message : 'Could not create the order' }, 400);
  }
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
