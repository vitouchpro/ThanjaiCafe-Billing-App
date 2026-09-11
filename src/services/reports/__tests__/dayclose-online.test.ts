import { describe, it, expect } from 'vitest';
import { onlineSalesTotal, cashInDrawer } from '../analytics';
import type { Bill } from '@/types';

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: Math.random().toString(36).slice(2), billNo: 'INV-1', seq: 1,
  createdAt: '2026-09-10T10:00:00Z', lines: [], billDiscount: 0, billDiscountType: 'fixed',
  totals: { subtotal: 100, itemDiscount: 0, billDiscount: 0, taxableValue: 100, tax: 0, total: 100, cost: 0 },
  payment: 'cash', status: 'completed', cashierId: 'u', cashierName: 'C', synced: 0, ...over,
});

describe('onlineSalesTotal', () => {
  it('counts only bills raised from a QR order', () => {
    const bills = [bill({ sourceOrderId: 'o1', payment: 'upi' }), bill({ payment: 'cash' })];
    expect(onlineSalesTotal(bills)).toBe(100);
  });

  it('excludes refunded and cancelled online orders', () => {
    const bills = [
      bill({ sourceOrderId: 'o1', payment: 'upi', status: 'refunded' }),
      bill({ sourceOrderId: 'o2', payment: 'upi', status: 'cancelled' }),
    ];
    expect(onlineSalesTotal(bills)).toBe(0);
  });

  it('is zero on a day with no online orders', () => {
    expect(onlineSalesTotal([bill(), bill()])).toBe(0);
  });
});

describe('online money never reaches the drawer', () => {
  it('is excluded from expected cash', () => {
    const bills = [
      bill({ payment: 'cash' }),                       // in the drawer
      bill({ sourceOrderId: 'o1', payment: 'upi' }),   // in the bank
    ];
    expect(cashInDrawer(bills)).toBe(100);
  });

  it('stays excluded even if an online order were somehow marked cash', () => {
    // Defensive: orderToBill always writes 'upi', but the drawer figure is what
    // a shop reconciles against, so it must not be one edit away from wrong.
    expect(cashInDrawer([bill({ sourceOrderId: 'o1', payment: 'cash' })])).toBe(0);
  });
});
