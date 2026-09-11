import { describe, it, expect } from 'vitest';
import { orderToBill } from '../orderToBill';
import { DEFAULT_SETTINGS } from '@/data/defaults';
import type { CloudOrder } from '@/types/order';

const order: CloudOrder = {
  id: 'o1', token: 'A-07', tableCode: 'T04', customerId: 'u1',
  customerName: 'Priya', customerPhone: '9876543210', status: 'PAID',
  subtotal: 95, tax: 4.75, total: 99.75,
  razorpayPaymentId: 'pay_1', createdAt: '2026-09-08T10:00:00Z',
  paidAt: '2026-09-08T10:01:00Z',
  lines: [
    { id: 'l1', orderId: 'o1', productId: 'p1', name: 'Filter Coffee', unitPrice: 25, qty: 2, taxRate: 5 },
    { id: 'l2', orderId: 'o1', productId: 'p2', name: 'Vadai', unitPrice: 15, qty: 3, taxRate: 5 },
  ],
};

const ctx = {
  seq: 1026, billNo: 'INV-1026', settings: DEFAULT_SETTINGS,
  cashierId: 'u-sys', cashierName: 'Online',
};

describe('orderToBill', () => {
  it('records the payment as UPI, since that is what the gateway settled', () => {
    expect(orderToBill(order, ctx).payment).toBe('upi');
  });

  it('marks the bill completed — the money is already taken', () => {
    expect(orderToBill(order, ctx).status).toBe('completed');
  });

  it('links back to the cloud order so it is never double-billed', () => {
    expect(orderToBill(order, ctx).sourceOrderId).toBe('o1');
  });

  it('carries the customer name and phone onto the bill', () => {
    const bill = orderToBill(order, ctx);
    expect(bill.customerName).toBe('Priya');
    expect(bill.customerPhone).toBe('9876543210');
  });

  it('recomputes totals locally and agrees with the server to the paise', () => {
    const bill = orderToBill(order, ctx);
    expect(bill.totals.subtotal).toBe(95);
    expect(bill.totals.tax).toBe(4.75);
    expect(bill.totals.total).toBe(99.75);
  });

  it('notes the table and token so the counter can find the order', () => {
    const bill = orderToBill(order, ctx);
    expect(bill.note).toContain('T04');
    expect(bill.note).toContain('A-07');
  });

  it('queues the bill for sync like any other', () => {
    expect(orderToBill(order, ctx).synced).toBe(0);
  });
});

describe('orderToBill refuses to assert a payment that did not happen', () => {
  it('will not bill an order still awaiting payment', () => {
    expect(() => orderToBill({ ...order, status: 'AWAITING_PAYMENT' }, ctx))
      .toThrow(/not paid/i);
  });

  it('will not bill a failed or cancelled order', () => {
    expect(() => orderToBill({ ...order, status: 'PAYMENT_FAILED' }, ctx)).toThrow(/not paid/i);
    expect(() => orderToBill({ ...order, status: 'CANCELLED' }, ctx)).toThrow(/not paid/i);
  });

  it('still bills an order the kitchen has already moved on', () => {
    // PREPARING/READY/SERVED are all past PAID — the money is in.
    for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'SERVED'] as const) {
      expect(() => orderToBill({ ...order, status }, ctx)).not.toThrow();
    }
  });

  it('will not bill an order with no items', () => {
    expect(() => orderToBill({ ...order, lines: [], total: 0 }, ctx)).toThrow(/no items/i);
  });

  it('will not bill a total that disagrees with what the gateway settled', () => {
    // The cloud row claims a different total than these lines compute. Billing
    // the local figure would leave the bill disagreeing with the customer's
    // card statement.
    expect(() => orderToBill({ ...order, total: 50 }, ctx))
      .toThrow(/gateway settled 50 but this bill computes 99.75/);
  });

  it('accepts a total that matches to the paise', () => {
    expect(() => orderToBill({ ...order, total: 99.75 }, ctx)).not.toThrow();
  });
});
