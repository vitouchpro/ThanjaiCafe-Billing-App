/* Creates a single-use, fixed-amount UPI QR for one bill, using Razorpay's
   QR Codes API (POST /v1/payments/qr_codes). SPIKE ONLY: no caller auth. */

const headers = { 'Content-Type': 'application/json' };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const { billId, amountPaise } = await req.json() as { billId?: string; amountPaise?: number };
  if (!billId || !Number.isInteger(amountPaise) || (amountPaise as number) < 100) {
    return new Response(JSON.stringify({ error: 'billId and amountPaise (>= 100) are required' }), { status: 400, headers });
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
