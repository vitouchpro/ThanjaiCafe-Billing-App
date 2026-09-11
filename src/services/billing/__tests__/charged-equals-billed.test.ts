import { describe, it, expect } from 'vitest';
import { priceOrder } from '../../../../supabase/functions/create-order/pricing';
import { orderToBill } from '../orderToBill';
import { DEFAULT_SETTINGS } from '@/data/defaults';
import type { CloudOrder } from '@/types/order';

/* The one number that must never drift: what Razorpay charges the customer, and
   what the till records as the bill.

   These are computed in two different places — the edge function prices the
   order from the published menu, and the till re-derives the bill locally — so
   nothing but a test holds them together. The plan originally had orderToBill
   read `pricesIncludeTax` and `roundTotals` from the shop's own billing
   settings, whose defaults are BOTH true; the edge function uses false for
   both. That would have billed a different amount than was charged.

   A cloud order's prices are always tax-exclusive and never cash-rounded,
   because they came from the published menu and were settled by a gateway that
   does not round to the rupee. If someone reintroduces the settings lookup,
   this fails. */

const menu = [
  { id: 'p1', name: 'Filter Coffee', price: 25, tax_rate: 5, available: true },
  { id: 'p2', name: 'Vadai', price: 15, tax_rate: 5, available: true },
  { id: 'p3', name: 'Cake', price: 120, tax_rate: 12, available: true },
  { id: 'p4', name: 'Odd Price', price: 33.33, tax_rate: 5, available: true },
];

const billFor = (lines: { productId: string; qty: number }[]) => {
  const { lines: priced, totals } = priceOrder(lines, menu);

  const order: CloudOrder = {
    id: 'o1', token: 'A-07', tableCode: 'T04', customerId: 'u1',
    customerName: 'Priya', customerPhone: '9876543210', status: 'PAID',
    subtotal: totals.subtotal, tax: totals.tax, total: totals.total,
    createdAt: '2026-09-10T10:00:00Z', paidAt: '2026-09-10T10:01:00Z',
    lines: priced.map((p, i) => ({
      id: `l${i}`, orderId: 'o1', productId: p.product_id, name: p.name,
      unitPrice: p.unit_price, qty: p.qty, taxRate: p.tax_rate,
    })),
  };

  const bill = orderToBill(order, {
    seq: 1026, billNo: 'INV-1026',
    // The shop's real defaults: tax-inclusive pricing and rupee rounding, both
    // of which are WRONG for a cloud order and must not be applied to one.
    settings: DEFAULT_SETTINGS,
    cashierId: 'u-sys', cashierName: 'Online',
  });

  return { charged: totals, billed: bill.totals };
};

describe('what the gateway charges equals what the till bills', () => {
  const cases: [string, { productId: string; qty: number }[]][] = [
    ['the plan\'s worked example', [{ productId: 'p1', qty: 2 }, { productId: 'p2', qty: 3 }]],
    ['mixed GST slabs', [{ productId: 'p1', qty: 1 }, { productId: 'p3', qty: 1 }]],
    ['awkward quantities', [{ productId: 'p2', qty: 7 }, { productId: 'p3', qty: 3 }]],
    ['a price with paise in it', [{ productId: 'p4', qty: 3 }]],
    ['a single item', [{ productId: 'p1', qty: 1 }]],
    ['a large order', [{ productId: 'p1', qty: 9 }, { productId: 'p2', qty: 11 }, { productId: 'p3', qty: 2 }]],
  ];

  for (const [label, lines] of cases) {
    it(label, () => {
      const { charged, billed } = billFor(lines);
      expect(billed.total).toBe(charged.total);
      expect(billed.tax).toBe(charged.tax);
      expect(billed.subtotal).toBe(charged.subtotal);
    });
  }

  it('keeps the paise the shop\'s cash rounding would have swallowed', () => {
    // roundTotals: true rounds a bill to the nearest rupee for cash tendering.
    // A gateway settles exact paise, so applying that here would bill an amount
    // the customer was never charged. 3 x 33.33 + 5% = 104.99, which rounding
    // would turn into 105.
    const { charged, billed } = billFor([{ productId: 'p4', qty: 3 }]);
    expect(charged.total).toBe(104.99);      // what Razorpay takes
    expect(billed.total).toBe(104.99);       // what the till records
    expect(billed.total).not.toBe(105);      // what cash rounding would have made it
  });
});
