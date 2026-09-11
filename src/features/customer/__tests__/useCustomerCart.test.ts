import { describe, it, expect, beforeEach } from 'vitest';
import { useCustomerCart, cartTotals, MAX_QTY } from '../useCustomerCart';
import type { MenuRow } from '@/services/cloud/menu';

const item = (over: Partial<MenuRow> = {}): MenuRow => ({
  id: 'p1', name: 'Filter Coffee', category_id: 'c1', category_name: 'Beverages',
  price: 25, tax_rate: 5, image_url: null, available: true, sort_order: 1, ...over,
});

beforeEach(() => useCustomerCart.getState().clear());

describe('useCustomerCart', () => {
  it('adds an item and increments on a second add', () => {
    const { add } = useCustomerCart.getState();
    add(item());
    add(item());
    expect(useCustomerCart.getState().items).toHaveLength(1);
    expect(useCustomerCart.getState().items[0].qty).toBe(2);
  });

  it('removes an item when its quantity reaches zero', () => {
    const { add, setQty } = useCustomerCart.getState();
    add(item());
    setQty('p1', 0);
    expect(useCustomerCart.getState().items).toHaveLength(0);
  });

  it('refuses to add an unavailable item', () => {
    useCustomerCart.getState().add(item({ available: false }));
    expect(useCustomerCart.getState().items).toHaveLength(0);
  });

  it('keeps the table code across cart changes', () => {
    const s = useCustomerCart.getState();
    s.setTable('T04');
    s.add(item());
    expect(useCustomerCart.getState().tableCode).toBe('T04');
  });

  it('removes the item when quantity is NaN rather than poisoning the total', () => {
    const { add, setQty } = useCustomerCart.getState();
    add(item());
    setQty('p1', Number.NaN);
    expect(useCustomerCart.getState().items).toHaveLength(0);
  });

  it('never lets a NaN quantity reach the totals', () => {
    const { add, setQty } = useCustomerCart.getState();
    add(item());
    setQty('p1', Number.NaN);
    expect(Number.isFinite(cartTotals(useCustomerCart.getState().items).total)).toBe(true);
  });

  it('floors a fractional quantity — the cafe sells whole cups', () => {
    const { add, setQty } = useCustomerCart.getState();
    add(item());
    setQty('p1', 2.7);
    expect(useCustomerCart.getState().items[0].qty).toBe(2);
  });

  it('caps the quantity at what the server will accept', () => {
    const { add, setQty } = useCustomerCart.getState();
    add(item());
    setQty('p1', 5000);
    expect(useCustomerCart.getState().items[0].qty).toBe(MAX_QTY);
  });

  it('caps repeated adds at the same limit', () => {
    const { add, setQty } = useCustomerCart.getState();
    add(item());
    setQty('p1', MAX_QTY);
    add(item());
    expect(useCustomerCart.getState().items[0].qty).toBe(MAX_QTY);
  });

  it('removes the item on Infinity', () => {
    const { add, setQty } = useCustomerCart.getState();
    add(item());
    setQty('p1', Number.POSITIVE_INFINITY);
    expect(useCustomerCart.getState().items).toHaveLength(0);
  });
});

describe('cartTotals', () => {
  it('totals in integer paise via the shared money engine', () => {
    const totals = cartTotals([{ ...item({ price: 25, tax_rate: 5 }), qty: 2 }]);
    expect(totals.subtotal).toBe(50);
    expect(totals.tax).toBe(2.5);
    expect(totals.total).toBe(52.5);
  });

  it('is exact where floating point would drift', () => {
    const totals = cartTotals([{ ...item({ price: 0.1, tax_rate: 0 }), qty: 3 }]);
    expect(totals.total).toBe(0.3);
  });

  it('returns zeroes for an empty cart', () => {
    expect(cartTotals([]).total).toBe(0);
  });
});
