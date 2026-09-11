/* Razorpay signs each webhook with HMAC-SHA256 over the raw body. Verifying it
   is what separates a real payment from anyone who can POST to a public URL.

   Uses WebCrypto so the same code runs under Deno and under Node in tests. */

export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  return timingSafeEqual(expected, signature.toLowerCase());
}

/* Constant-time comparison: a length-or-first-difference exit would leak the
   expected signature one byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
