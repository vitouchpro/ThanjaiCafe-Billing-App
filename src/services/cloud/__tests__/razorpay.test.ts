import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkoutOptions } from '../razorpay';

beforeEach(() => vi.restoreAllMocks());

describe('checkoutOptions', () => {
  const base = {
    keyId: 'rzp_test_x', razorpayOrderId: 'order_123', amount: 9975,
    businessName: 'THANJAI CAFE', token: 'A-07',
  };

  it('passes the amount through untouched — the server already set it', () => {
    expect(checkoutOptions(base).amount).toBe(9975);
  });

  it('prefills nothing — there is no sign-in, so nothing is known about the diner', () => {
    const o = checkoutOptions(base);
    expect(o.prefill.contact).toBeUndefined();
    expect(o.prefill.email).toBeUndefined();
    expect(o.prefill.name).toBeUndefined();
  });

  it('shows the token on the payment sheet so the diner recognises the order', () => {
    expect(checkoutOptions(base).description).toContain('A-07');
  });

  it('always uses INR', () => {
    expect(checkoutOptions(base).currency).toBe('INR');
  });
});
