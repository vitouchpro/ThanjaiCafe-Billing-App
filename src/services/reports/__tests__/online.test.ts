import { describe, it, expect } from 'vitest';
import { isOnlineBill } from '../analytics';
import type { Bill } from '@/types';

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: 'b1', billNo: 'INV-1', seq: 1, createdAt: '2026-09-10T10:00:00Z',
  lines: [], billDiscount: 0, billDiscountType: 'fixed',
  totals: { subtotal: 0, itemDiscount: 0, billDiscount: 0, taxableValue: 0, tax: 0, total: 0, cost: 0 },
  payment: 'cash', status: 'completed', cashierId: 'u', cashierName: 'C', synced: 0, ...over,
});

describe('isOnlineBill', () => {
  it('is true only when the bill came from a QR order', () => {
    expect(isOnlineBill(bill({ sourceOrderId: 'o1' }))).toBe(true);
  });

  it('is false for an ordinary walk-in bill', () => {
    expect(isOnlineBill(bill())).toBe(false);
  });

  it('is false when the field is present but empty', () => {
    expect(isOnlineBill(bill({ sourceOrderId: '' }))).toBe(false);
  });
});
