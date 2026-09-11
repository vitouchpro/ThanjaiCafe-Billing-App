import { describe, it, expect } from 'vitest';
import { buildClaim } from '../useOrderIntake';
import { orderToBill } from '@/services/billing/orderToBill';
import { DEFAULT_SETTINGS } from '@/data/defaults';
import type { CloudOrder } from '@/types/order';

describe('buildClaim', () => {
  it('claims only an order that has not been accepted yet', () => {
    const claim = buildClaim('o1');
    expect(claim.match).toEqual({ id: 'o1', status: 'PAID' });
    expect(claim.patch.status).toBe('ACCEPTED');
    expect(claim.patch.accepted_at).toBeTruthy();
  });

  it('never claims by id alone — a second till must lose the race', () => {
    expect(Object.keys(buildClaim('o1').match)).toContain('status');
  });
});

/* The intake loop validates an order with a throwaway invoice number BEFORE
   reserving a real one. Reserving first would burn a number on an order that
   never becomes a bill, leaving a permanent gap in a GST invoice sequence. */

const order: CloudOrder = {
  id: 'o1', token: 'A-07', tableCode: 'T04', customerId: 'u1',
  customerName: 'Priya', customerPhone: '9876543210', status: 'PAID',
  subtotal: 95, tax: 4.75, total: 99.75,
  createdAt: '2026-09-10T10:00:00Z', paidAt: '2026-09-10T10:01:00Z',
  lines: [
    { id: 'l1', orderId: 'o1', productId: 'p1', name: 'Filter Coffee', unitPrice: 25, qty: 2, taxRate: 5 },
    { id: 'l2', orderId: 'o1', productId: 'p2', name: 'Vadai', unitPrice: 15, qty: 3, taxRate: 5 },
  ],
};

const ctx = { settings: DEFAULT_SETTINGS, cashierId: 'u', cashierName: 'Online' };
const dryRun = (o: CloudOrder) => orderToBill(o, { seq: 0, billNo: 'DRY-RUN', ...ctx });

describe('validating before an invoice number is spent', () => {
  it('accepts an order that will bill cleanly', () => {
    expect(() => dryRun(order)).not.toThrow();
  });

  it('rejects an unpaid order before a number is reserved', () => {
    expect(() => dryRun({ ...order, status: 'AWAITING_PAYMENT' })).toThrow(/not paid/i);
  });

  it('rejects an order with no items before a number is reserved', () => {
    expect(() => dryRun({ ...order, lines: [], total: 0 })).toThrow(/no items/i);
  });

  it('rejects a total that disagrees with the gateway before a number is reserved', () => {
    expect(() => dryRun({ ...order, total: 1 })).toThrow(/gateway settled/i);
  });

  it('does not reject on the placeholder values themselves', () => {
    // If seq 0 or the placeholder bill number tripped a guard, every order
    // would be refused and nothing would ever be billed.
    const bill = dryRun(order);
    expect(bill.seq).toBe(0);
    expect(bill.billNo).toBe('DRY-RUN');
    expect(bill.totals.total).toBe(99.75);
  });
});
