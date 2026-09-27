import { describe, it, expect } from 'vitest';
import { parsePaymentEvent, replyFor } from '../promote';

const body = (event: string, entity: Record<string, unknown>) =>
  JSON.stringify({ event, payload: { payment: { entity } } });

describe('parsePaymentEvent', () => {
  it('reads a captured payment with its amount in paise', () => {
    expect(parsePaymentEvent(body('payment.captured', { id: 'pay_1', order_id: 'order_1', amount: 6825 })))
      .toEqual({ kind: 'captured', razorpayOrderId: 'order_1', razorpayPaymentId: 'pay_1', amountPaise: 6825 });
  });

  it('reads a failed payment by its order id', () => {
    expect(parsePaymentEvent(body('payment.failed', { id: 'pay_1', order_id: 'order_1', amount: 6825 })))
      .toEqual({ kind: 'failed', razorpayOrderId: 'order_1' });
  });

  it('ignores other events, malformed JSON and bodies with no order id', () => {
    expect(parsePaymentEvent(body('payment.authorized', { id: 'pay_1', order_id: 'order_1', amount: 1 })).kind).toBe('ignored');
    expect(parsePaymentEvent('{not json').kind).toBe('ignored');
    expect(parsePaymentEvent(body('payment.captured', { id: 'pay_1', amount: 100 })).kind).toBe('ignored');
    expect(parsePaymentEvent(JSON.stringify({ event: 'payment.captured' })).kind).toBe('ignored');
  });

  it('refuses a captured payment without a usable amount or payment id', () => {
    expect(parsePaymentEvent(body('payment.captured', { id: 'pay_1', order_id: 'o', amount: '68.25' })).kind).toBe('ignored');
    expect(parsePaymentEvent(body('payment.captured', { id: 'pay_1', order_id: 'o', amount: 0 })).kind).toBe('ignored');
    expect(parsePaymentEvent(body('payment.captured', { order_id: 'o', amount: 100 })).kind).toBe('ignored');
  });
});

describe('replyFor', () => {
  it('acknowledges a promotion and a repeat delivery without retry', () => {
    expect(replyFor('promoted')).toMatchObject({ status: 200, needsReconciliation: false });
    expect(replyFor('already_processed')).toMatchObject({ status: 200, needsReconciliation: false });
  });

  it('flags money taken without an order for a person, and does not ask for a retry', () => {
    for (const o of ['no_draft', 'amount_mismatch', 'no_lines']) {
      expect(replyFor(o)).toMatchObject({ status: 200, needsReconciliation: true });
    }
  });

  it('asks Razorpay to retry when the outcome is unknown', () => {
    expect(replyFor(undefined).status).toBe(500);
    expect(replyFor('something new').status).toBe(500);
  });
});
