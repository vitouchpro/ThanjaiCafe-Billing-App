import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyWebhookSignature } from '../verify-payment/signature.ts';

/* Logs every webhook Razorpay sends, with the signature check result, so the
   spike can record the real event names and payload shape for QR payments.
   SPIKE ONLY. */

Deno.serve(async (req) => {
  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const valid = await verifyWebhookSignature(raw, signature, Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { body = { unparsable: raw.slice(0, 500) }; }

  await admin.from('spike_webhook_log').insert({
    event_id: req.headers.get('x-razorpay-event-id'),
    signature_valid: valid,
    body,
  });

  return new Response(valid ? 'ok' : 'invalid signature', { status: valid ? 200 : 401 });
});
