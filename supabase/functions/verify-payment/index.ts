import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyWebhookSignature } from './signature.ts';
import { parsePaymentEvent, replyFor } from './promote.ts';

/* The moment an order becomes real.

   Nothing reaches the kitchen or the billing portal until this handler runs:
   a cart lives as a draft in `pending_orders`, which no staff surface reads,
   and only a payment Razorpay has signed for promotes it into `orders`. So
   this file is both the single writer of PAID and the only thing that can
   put food in front of a cook.

   A customer's browser claiming success means nothing — anyone can POST to a
   public URL. Only the HMAC signature over the raw body proves a real payment.

   Razorpay retries on any non-2xx, so promotion is idempotent: it runs in one
   database transaction keyed on razorpay_payment_id, so a repeat delivery
   cannot produce a second order, a second bill, or a second KOT. */

Deno.serve(async (req) => {
  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';

  if (!await verifyWebhookSignature(raw, signature, secret)) {
    // Do not retry an unsigned caller: 401 and done.
    return new Response('invalid signature', { status: 401 });
  }

  const event = parsePaymentEvent(raw);
  if (event.kind === 'ignored') return new Response('ignored', { status: 200 });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  /* A failed payment leaves nothing behind. There is no order to mark failed —
     the draft is simply dropped, and the diner's phone tells them to try again
     with their cart intact. */
  if (event.kind === 'failed') {
    await admin.from('pending_orders').delete().eq('razorpay_order_id', event.razorpayOrderId);
    return new Response('ok', { status: 200 });
  }

  /* Promote in ONE database transaction (promote_paid_order, see
     apply-migrations-4.sql): idempotency check, amount check against the
     priced cart, the PAID order, every line, and the draft's removal commit
     together. The kitchen can never see an order without its items, and a
     repeated or concurrent delivery cannot produce a second order or KOT. */
  const { data, error } = await admin.rpc('promote_paid_order', {
    p_razorpay_order_id: event.razorpayOrderId,
    p_razorpay_payment_id: event.razorpayPaymentId,
    p_amount_paise: event.amountPaise,
  });

  if (error) {
    console.error('verify-payment: promotion failed', error);
    return new Response('promotion failed', { status: 500 }); // 500 → Razorpay retries
  }

  const row = Array.isArray(data) ? data[0] : data;
  const reply = replyFor(row?.out_outcome);

  if (reply.needsReconciliation) {
    /* Money was captured but no order was made. That is a real payment the
       shop cannot see, so it must be loud rather than silent. */
    console.error('verify-payment: PAYMENT NEEDS RECONCILIATION', {
      outcome: row?.out_outcome,
      token: row?.out_token,
      razorpay_order_id: event.razorpayOrderId,
      razorpay_payment_id: event.razorpayPaymentId,
      amount_paise: event.amountPaise,
    });
  }

  if (row?.out_outcome === 'promoted') {
    // Cheap housekeeping on a path that already runs rarely.
    await admin.rpc('purge_stale_drafts');
  }

  return new Response(reply.body, { status: reply.status });
});
