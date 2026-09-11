import { describe, it, expect } from 'vitest';
import { rowToOrder } from '../orders';

const row = {
  id: 'o1', token: 'A-07', table_code: 'T04', customer_id: 'u1',
  customer_name: 'Priya', customer_phone: '9876543210', status: 'PAID',
  subtotal: 95, tax: 4.75, total: 99.75, razorpay_order_id: 'order_1',
  razorpay_payment_id: 'pay_1', bill_id: null, note: null,
  created_at: '2026-09-08T10:00:00Z', paid_at: '2026-09-08T10:01:00Z',
  accepted_at: null, ready_at: null, served_at: null,
};

const lines = [
  { id: 'l1', order_id: 'o1', product_id: 'p1', name: 'Filter Coffee',
    unit_price: 25, qty: 2, tax_rate: 5, note: null },
];

describe('rowToOrder', () => {
  it('maps snake_case columns to the app\'s camelCase shape', () => {
    const o = rowToOrder(row, lines);
    expect(o.tableCode).toBe('T04');
    expect(o.customerPhone).toBe('9876543210');
    expect(o.razorpayPaymentId).toBe('pay_1');
  });

  it('carries the customer name and phone the KOT needs', () => {
    const o = rowToOrder(row, lines);
    expect(o.customerName).toBe('Priya');
    expect(o.customerPhone).toBe('9876543210');
  });

  it('turns nulls into undefined rather than leaking them into the UI', () => {
    const o = rowToOrder(row, lines);
    expect(o.acceptedAt).toBeUndefined();
    expect(o.billId).toBeUndefined();
  });

  it('attaches the order lines', () => {
    const o = rowToOrder(row, lines);
    expect(o.lines).toHaveLength(1);
    expect(o.lines[0].name).toBe('Filter Coffee');
    expect(o.lines[0].qty).toBe(2);
  });
});
