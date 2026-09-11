import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyWebhookSignature } from './signature.ts';

/* The moment an order becomes real.

   Nothing reaches the kitchen or the billing portal until this handler runs:
   a cart lives as a draft in `pending_orders`, which no staff surface reads,
   and only a payment Razorpay has signed for promotes it into `orders`. So
   this file is both the single writer of PAID and the only thing that can
   put food in front of a cook.

   A customer's browser claiming success means nothing — anyone can POST to a
   public URL. Only the HMAC signature over the raw body proves a real payment.

   Razorpay retries on any non-2xx, so promotion is idempotent: the unique
   constraint on razorpay_payment_id means a repeat delivery cannot produce a
   second order, a second bill, or a second KOT. */

Deno.serve(async (req) => {
  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';

  if (!await verifyWebhookSignature(raw, signature, secret)) {
    // Do not retry an unsigned caller: 401 and done.
    return new Response('invalid signature', { status: 401 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const event = JSON.parse(raw);
  const payment = event?.payload?.payment?.entity;
  if (!payment) return new Response('ignored', { status: 200 });

  const razorpayOrderId = payment.order_id as string;
  const razorpayPaymentId = payment.id as string;

  /* A failed payment leaves nothing behind. There is no order to mark failed —
     the draft is simply dropped, and the diner's phone tells them to try again
     with their cart intact. */
  if (event.event === 'payment.failed') {
    await admin.from('pending_orders').delete().eq('razorpay_order_id', razorpayOrderId);
    return new Response('ok', { status: 200 });
  }

  if (event.event !== 'payment.captured') return new Response('ignored', { status: 200 });

  /* Idempotency first. A retried delivery must not promote the same draft
     twice, and checking the real table is what makes that safe: the draft is
     deleted on success, so its absence alone cannot distinguish "already done"
     from "never existed". */
  const { data: already } = await admin
    .from('orders').select('id, token').eq('razorpay_payment_id', razorpayPaymentId).maybeSingle();
  if (already) return new Response('already processed', { status: 200 });

  const { data: draft, error: draftErr } = await admin
    .from('pending_orders').select('*').eq('razorpay_order_id', razorpayOrderId).maybeSingle();

  if (draftErr) {
    console.error('verify-payment: could not read the draft', draftErr);
    return new Response('draft read failed', { status: 500 }); // 500 → Razorpay retries
  }

  if (!draft) {
    /* Money was captured with no draft to promote. That is a real payment the
       shop cannot see, so it must be loud rather than silent — the two ways it
       happens are a draft purged before a very delayed webhook, and a payment
       against an order created outside this system. */
    console.error(
      'verify-payment: PAYMENT NEEDS RECONCILIATION — captured with no matching draft',
      { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, amount: payment.amount },
    );
    return new Response('no draft', { status: 200 });
  }

  /* Promote. The order is born PAID: it has never existed in any other state,
     which is precisely the guarantee the shop asked for. */
  const paidAt = new Date().toISOString();
  const { data: order, error: orderErr } = await admin.from('orders').insert({
    token: draft.token,
    table_code: draft.table_code,
    status: 'PAID',
    subtotal: draft.subtotal,
    tax: draft.tax,
    total: draft.total,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    paid_at: paidAt,
  }).select().single();

  if (orderErr) {
    // A concurrent delivery may have won the race; the unique constraint on
    // razorpay_payment_id is what makes that safe rather than a double order.
    if (orderErr.code === '23505') return new Response('already processed', { status: 200 });
    console.error('verify-payment: could not promote the draft', orderErr);
    return new Response('promotion failed', { status: 500 });
  }

  const lines = (draft.lines as Array<Record<string, unknown>>) ?? [];
  const { error: linesErr } = await admin.from('order_lines')
    .insert(lines.map((l) => ({ ...l, order_id: order.id })));

  if (linesErr) {
    /* An order with no lines is food nobody can cook. Roll the promotion back
       so the kitchen never sees an empty ticket, and return 500 so Razorpay
       redelivers and we can try again — the draft is still there. */
    console.error('verify-payment: lines insert failed, rolling back', linesErr);
    await admin.from('orders').delete().eq('id', order.id);
    return new Response('lines insert failed', { status: 500 });
  }

  // The draft has done its job. Only now is it safe to drop.
  await admin.from('pending_orders').delete().eq('id', draft.id);

  // Cheap housekeeping on a path that already runs rarely.
  await admin.rpc('purge_stale_drafts');

  return new Response('ok', { status: 200 });
});
