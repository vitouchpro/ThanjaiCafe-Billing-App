import { describe, it, expect } from 'vitest';
import { priceOrder } from '../pricing';

const menu = [
  { id: 'p1', name: 'Filter Coffee', price: 25, tax_rate: 5, available: true },
  { id: 'p2', name: 'Vadai', price: 15, tax_rate: 5, available: true },
  { id: 'p3', name: 'Sold Out Item', price: 30, tax_rate: 5, available: false },
];

describe('priceOrder', () => {
  it('prices from the menu, ignoring what the client claimed', () => {
    const { totals } = priceOrder([{ productId: 'p1', qty: 2, unitPrice: 1 }], menu);
    expect(totals.subtotal).toBe(50);   // 25 x 2, not 1 x 2
  });

  it('rejects an item that is not on the published menu', () => {
    expect(() => priceOrder([{ productId: 'ghost', qty: 1 }], menu))
      .toThrow(/not on the menu/i);
  });

  it('rejects an item that is sold out', () => {
    expect(() => priceOrder([{ productId: 'p3', qty: 1 }], menu))
      .toThrow(/sold out/i);
  });

  it('rejects a non-positive or absurd quantity', () => {
    expect(() => priceOrder([{ productId: 'p1', qty: 0 }], menu)).toThrow(/quantity/i);
    expect(() => priceOrder([{ productId: 'p1', qty: -3 }], menu)).toThrow(/quantity/i);
    expect(() => priceOrder([{ productId: 'p1', qty: 1000 }], menu)).toThrow(/quantity/i);
  });

  it('rejects an empty order', () => {
    expect(() => priceOrder([], menu)).toThrow(/empty/i);
  });

  it('computes tax per slab through the shared engine', () => {
    const { totals } = priceOrder(
      [{ productId: 'p1', qty: 2 }, { productId: 'p2', qty: 3 }], menu,
    );
    expect(totals.subtotal).toBe(95);
    expect(totals.tax).toBe(4.75);
    expect(totals.total).toBe(99.75);
  });

  it('returns server-priced lines, not the client\'s', () => {
    const { lines } = priceOrder([{ productId: 'p1', qty: 1, unitPrice: 1, name: 'Free Coffee' }], menu);
    expect(lines[0].unit_price).toBe(25);
    expect(lines[0].name).toBe('Filter Coffee');
  });

  it('refuses an order with an absurd number of lines', () => {
    const many = Array.from({ length: 51 }, () => ({ productId: 'p1', qty: 1 }));
    expect(() => priceOrder(many, menu)).toThrow(/too many items/i);
  });

  it('accepts an order at the line limit', () => {
    const atLimit = Array.from({ length: 50 }, () => ({ productId: 'p1', qty: 1 }));
    expect(() => priceOrder(atLimit, menu)).not.toThrow();
  });
});
