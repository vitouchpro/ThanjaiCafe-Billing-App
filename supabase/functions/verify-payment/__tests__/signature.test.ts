import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../signature';

const SECRET = 'whsec_test_secret';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed payload', async () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    expect(await verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a forged signature', async () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    expect(await verifyWebhookSignature(body, 'deadbeef', SECRET)).toBe(false);
  });

  it('rejects a payload tampered with after signing', async () => {
    const signature = sign(JSON.stringify({ amount: 100 }));
    const tampered = JSON.stringify({ amount: 1 });
    expect(await verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects an empty or missing signature', async () => {
    const body = '{}';
    expect(await verifyWebhookSignature(body, '', SECRET)).toBe(false);
  });

  it('rejects when signed with the wrong secret', async () => {
    const body = '{"a":1}';
    const wrong = createHmac('sha256', 'other_secret').update(body).digest('hex');
    expect(await verifyWebhookSignature(body, wrong, SECRET)).toBe(false);
  });

  it('fails closed when the webhook secret is not configured', async () => {
    // A deployment that forgot `supabase secrets set RAZORPAY_WEBHOOK_SECRET`
    // must reject every caller rather than accept every caller. Deno.env.get
    // returns undefined there, which reaches this function as ''.
    const body = JSON.stringify({ event: 'payment.captured' });
    expect(await verifyWebhookSignature(body, sign(body), '')).toBe(false);
    expect(await verifyWebhookSignature(body, 'anything', '')).toBe(false);
  });

  it('rejects a signature of the right shape but wrong value', async () => {
    // 64 hex chars, so it survives the length check and reaches the compare.
    const body = JSON.stringify({ event: 'payment.captured' });
    expect(await verifyWebhookSignature(body, 'a'.repeat(64), SECRET)).toBe(false);
  });

  it('accepts an uppercase signature — hex case must not matter', async () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    expect(await verifyWebhookSignature(body, sign(body).toUpperCase(), SECRET)).toBe(true);
  });
});
