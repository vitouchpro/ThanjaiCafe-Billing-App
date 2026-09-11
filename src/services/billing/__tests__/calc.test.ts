import { describe, it, expect } from 'vitest';
import { computeBill, apportion, effectivePrice, lineDiscountPaise } from '../calc';
import type { BillLine } from '@/types';

const line = (over: Partial<BillLine>): BillLine => ({
  id: Math.random().toString(36).slice(2),
  productId: 'p',
  name: 'Item',
  unitPrice: 25,
  costPrice: 9.8,
  qty: 1,
  discount: 0,
  discountType: 'percent',
  taxRate: 5,
  ...over,
});

const EXCL = { pricesIncludeTax: false, roundTotals: false };
const INCL = { pricesIncludeTax: true, roundTotals: false };

describe('apportion', () => {
  it('distributes exactly, never losing or inventing paise', () => {
    expect(apportion(1000, [3333, 3333, 3334]).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(apportion(1, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(1);
    expect(apportion(7, [1, 1, 1])).toEqual([3, 2, 2]);
  });

  it('handles zero amount and zero weights', () => {
    expect(apportion(0, [10, 20])).toEqual([0, 0]);
    expect(apportion(100, [0, 0])).toEqual([0, 0]);
  });
});

describe('lineDiscountPaise', () => {
  it('treats fixed discount as per-unit', () => {
    expect(lineDiscountPaise({ unitPrice: 15, qty: 3, discount: 3, discountType: 'fixed' })).toBe(900);
  });
  it('caps discount at the gross value', () => {
    expect(lineDiscountPaise({ unitPrice: 15, qty: 1, discount: 999, discountType: 'fixed' })).toBe(1500);
    expect(lineDiscountPaise({ unitPrice: 15, qty: 1, discount: 150, discountType: 'percent' })).toBe(1500);
  });
});

describe('computeBill — plan §6 worked example', () => {
  // Filter Coffee x2 = 50, Vadai x3 = 45, Thattai x1 = 20  → subtotal 115
  const lines = [
    line({ name: 'Filter Coffee', unitPrice: 25, qty: 2 }),
    line({ name: 'Vadai', unitPrice: 15, qty: 3 }),
    line({ name: 'Thattai', unitPrice: 20, qty: 1 }),
  ];

  it('produces the plan subtotal', () => {
    const r = computeBill(lines, 0, 'fixed', EXCL);
    expect(r.totals.subtotal).toBe(115);
  });

  it('applies a ₹10 bill discount exactly', () => {
    const r = computeBill(lines, 10, 'fixed', EXCL);
    expect(r.totals.billDiscount).toBe(10);
    expect(r.totals.taxableValue).toBe(105);
    expect(r.totals.tax).toBe(5.25);
    expect(r.totals.total).toBe(110.25);
  });

  it('apportioned shares sum to the bill discount', () => {
    const r = computeBill(lines, 10, 'fixed', EXCL);
    const shares = r.lines.reduce((a, l) => a + l.billDiscountSharePaise, 0);
    expect(shares).toBe(1000);
  });
});

describe('computeBill — mixed GST slabs', () => {
  it('keeps each slab taxed at its own rate after a bill discount', () => {
    const lines = [
      line({ name: 'Coffee', unitPrice: 100, qty: 1, taxRate: 5 }),
      line({ name: 'Packed', unitPrice: 100, qty: 1, taxRate: 12 }),
    ];
    const r = computeBill(lines, 20, 'fixed', EXCL);
    // 20 split evenly → each line nets 90
    expect(r.totals.taxableValue).toBe(180);
    expect(r.totals.tax).toBe(15.3); // 90*5% + 90*12% = 4.5 + 10.8
    expect(r.taxBreakup).toEqual([
      { rate: 5, taxable: 90, tax: 4.5 },
      { rate: 12, taxable: 90, tax: 10.8 },
    ]);
  });
});

describe('computeBill — tax-inclusive pricing', () => {
  it('backs tax out of the price instead of adding on top', () => {
    const r = computeBill([line({ unitPrice: 105, qty: 1, taxRate: 5 })], 0, 'fixed', INCL);
    expect(r.totals.total).toBe(105);
    expect(r.totals.taxableValue).toBe(100);
    expect(r.totals.tax).toBe(5);
  });

  it('total always equals taxable + tax', () => {
    const r = computeBill(
      [line({ unitPrice: 33.33, qty: 3, taxRate: 12 }), line({ unitPrice: 9.99, qty: 7, taxRate: 5 })],
      7, 'percent', INCL,
    );
    expect(r.totals.total).toBeCloseTo(r.totals.taxableValue + r.totals.tax, 2);
  });
});

describe('computeBill — item + bill discount together (plan §11)', () => {
  it('stacks item discount then bill discount', () => {
    const lines = [line({ name: 'Vadai', unitPrice: 15, qty: 1, discount: 3, discountType: 'fixed', taxRate: 0 })];
    const r = computeBill(lines, 0, 'fixed', EXCL);
    expect(r.totals.itemDiscount).toBe(3);
    expect(r.totals.total).toBe(12); // ₹15 → ₹12, per the plan
  });

  it('bill discount applies to the post-item-discount value', () => {
    const lines = [line({ unitPrice: 100, qty: 1, discount: 10, discountType: 'percent', taxRate: 0 })];
    const r = computeBill(lines, 10, 'percent', EXCL);
    expect(r.totals.itemDiscount).toBe(10);
    expect(r.totals.billDiscount).toBe(9); // 10% of 90, not of 100
    expect(r.totals.total).toBe(81);
  });
});

describe('computeBill — edge cases', () => {
  it('handles an empty bill', () => {
    const r = computeBill([], 50, 'fixed', EXCL);
    expect(r.totals.total).toBe(0);
    expect(r.totals.billDiscount).toBe(0);
  });

  it('never lets a discount exceed the bill', () => {
    const r = computeBill([line({ unitPrice: 10, qty: 1, taxRate: 0 })], 500, 'fixed', EXCL);
    expect(r.totals.total).toBe(0);
    expect(r.totals.billDiscount).toBe(10);
  });

  it('rounds the grand total to the rupee when enabled', () => {
    const r = computeBill([line({ unitPrice: 33.33, qty: 1, taxRate: 5 })], 0, 'fixed', {
      pricesIncludeTax: false, roundTotals: true,
    });
    expect(Number.isInteger(r.totals.total)).toBe(true);
  });

  it('avoids float drift across many small lines', () => {
    const many = Array.from({ length: 30 }, () => line({ unitPrice: 0.1, qty: 1, taxRate: 0 }));
    expect(computeBill(many, 0, 'fixed', EXCL).totals.total).toBe(3);
  });
});

describe('effectivePrice', () => {
  it('applies percent and fixed product discounts', () => {
    expect(effectivePrice({ sellingPrice: 100, discount: 10, discountType: 'percent' })).toBe(90);
    expect(effectivePrice({ sellingPrice: 15, discount: 3, discountType: 'fixed' })).toBe(12);
    expect(effectivePrice({ sellingPrice: 25, discount: 0, discountType: 'percent' })).toBe(25);
  });
  it('never goes negative', () => {
    expect(effectivePrice({ sellingPrice: 10, discount: 50, discountType: 'fixed' })).toBe(0);
  });
});
