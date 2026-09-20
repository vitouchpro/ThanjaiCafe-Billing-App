/* Creates a single-use, fixed-amount UPI QR for one bill, using Razorpay's
   QR Codes API (POST /v1/payments/qr_codes).
   SPIKE ONLY: deploy to the spike project with Razorpay TEST keys only, and deploy WITHOUT --no-verify-jwt
   so the default JWT check applies.
*/

const headers = { 'Content-Type': 'application/json' };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  let billId: unknown;
  let amountPaise: unknown;
  try {
    const body = await req.json();
    billId = body.billId;
    amountPaise = body.amountPaise;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), { status: 400, headers });
  }

  if (typeof billId !== 'string' || billId.length === 0 || billId.length > 64) {
    return new Response(JSON.stringify({ error: 'billId must be a non-empty string, max 64 chars' }), { status: 400, headers });
  }
  if (!Number.isInteger(amountPaise) || (amountPaise as number) < 100 || (amountPaise as number) > 100000) {
    return new Response(JSON.stringify({ error: 'amountPaise must be an integer between 100 and 100000 paise (Rs 1 to Rs 1000)' }), { status: 400, headers });
  }

  const keyId = Deno.env.get('RAZORPAY_KEY_ID')!;
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')!;

  const res = await fetch('https://api.razorpay.com/v1/payments/qr_codes', {
    method: 'POST',
    headers: { ...headers, Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` },
    body: JSON.stringify({
      type: 'upi_qr',
      name: `bill-${billId}`.slice(0, 40),
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: amountPaise,
      description: `Bill ${billId}`,
      close_by: Math.floor(Date.now() / 1000) + 15 * 60, // Razorpay allows 2 minutes to 2 hours
      notes: { bill_id: billId },
    }),
  });

  const body = await res.json();
  if (!res.ok) return new Response(JSON.stringify({ error: body }), { status: 502, headers });
  return new Response(JSON.stringify({ qrId: body.id, imageUrl: body.image_url, status: body.status }), { headers });
});
