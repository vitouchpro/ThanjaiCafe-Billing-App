import { describe, it, expect } from 'vitest';
import {
  billsBetween, categoryPerformance, discountSummary, hourlyBuckets, lowSelling,
  neverSold, paymentSplit, peakHours, productPerformance, sortPerformance,
  summarize, topProducts, cashInDrawer,
} from '../analytics';
import type { Bill, BillLine, Category, PaymentMethod, Product } from '@/types';

/* Reports drive real decisions (what to stock, who to pay), so the rules that
   decide what counts as a sale are pinned down here. */

const product = (id: string, name: string, categoryId = 'c1', price = 25, cost = 10): Product => ({
  id, name, categoryId,
  sellingPrice: price, costPrice: cost,
  discount: 0, discountType: 'percent', taxRate: 5,
  available: true, unit: 'pcs',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

const line = (productId: string, name: string, qty: number, unitPrice = 25, costPrice = 10): BillLine => ({
  id: `${productId}-${qty}-${Math.random()}`,
  productId, name, unitPrice, costPrice, qty,
  discount: 0, discountType: 'percent', taxRate: 5,
});

function bill(over: Partial<Bill> & { at: string; lines: BillLine[] }): Bill {
  const { at, ...rest } = over;
  const gross = over.lines.reduce((a, l) => a + l.unitPrice * l.qty, 0);
  const cost = over.lines.reduce((a, l) => a + l.costPrice * l.qty, 0);
  return {
    id: `b-${Math.random()}`,
    billNo: 'INV-1',
    seq: 1,
    createdAt: at,
    billDiscount: 0,
    billDiscountType: 'percent',
    totals: {
      subtotal: gross, itemDiscount: 0, billDiscount: 0,
      taxableValue: gross, tax: 0, total: gross, cost,
    },
    payment: 'cash' as PaymentMethod,
    status: 'completed',
    cashierId: 'u1',
    cashierName: 'Priya',
    synced: 1,
    ...rest,
  };
}

const at = (h: number, d = 26) =>
  new Date(2026, 7, d, h, 15, 0).toISOString(); // Aug 2026, local time

const PRODUCTS = [
  product('p1', 'Filter Coffee'),
  product('p2', 'Vadai', 'c1', 15, 5),
  product('p3', 'Ragi Adai', 'c2', 35, 13),
  product('p4', 'Never Sold Item', 'c2', 20, 8),
];

const CATEGORIES: Category[] = [
  { id: 'c1', name: 'Coffee', icon: '☕', sortOrder: 1 },
  { id: 'c2', name: 'Millet', icon: '🌾', sortOrder: 2 },
];

describe('summarize', () => {
  it('excludes refunded and cancelled bills from sales', () => {
    const bills = [
      bill({ at: at(9), lines: [line('p1', 'Filter Coffee', 2)] }),                       // 50
      bill({ at: at(10), lines: [line('p1', 'Filter Coffee', 1)], status: 'refunded', refundAmount: 25 }),
      bill({ at: at(11), lines: [line('p1', 'Filter Coffee', 4)], status: 'cancelled' }),
    ];
    const s = summarize(bills);
    expect(s.totalSales).toBe(50);
    expect(s.orders).toBe(1);
    expect(s.refunds).toBe(25);
  });

  it('reports the average bill, and zero rather than NaN with no sales', () => {
    expect(summarize([]).avgBill).toBe(0);
    const s = summarize([
      bill({ at: at(9), lines: [line('p1', 'A', 2)] }),
      bill({ at: at(10), lines: [line('p2', 'B', 2, 15, 5)] }),
    ]);
    expect(s.avgBill).toBe(40); // (50 + 30) / 2
  });

  it('computes margin from the cost snapshot on each line', () => {
    const s = summarize([bill({ at: at(9), lines: [line('p1', 'A', 2, 25, 10)] })]);
    expect(s.cost).toBe(20);
    expect(s.margin).toBe(30);
  });
});

describe('billsBetween', () => {
  it('includes the whole of both boundary days', () => {
    const bills = [
      bill({ at: new Date(2026, 7, 24, 23, 59).toISOString(), lines: [line('p1', 'A', 1)] }),
      bill({ at: new Date(2026, 7, 25, 0, 1).toISOString(), lines: [line('p1', 'A', 1)] }),
      bill({ at: new Date(2026, 7, 26, 23, 59).toISOString(), lines: [line('p1', 'A', 1)] }),
      bill({ at: new Date(2026, 7, 27, 0, 1).toISOString(), lines: [line('p1', 'A', 1)] }),
    ];
    const got = billsBetween(bills, new Date(2026, 7, 25), new Date(2026, 7, 26));
    expect(got).toHaveLength(2);
  });

  it('never counts held bills', () => {
    const bills = [bill({ at: at(9), lines: [line('p1', 'A', 1)], status: 'held' })];
    expect(billsBetween(bills, new Date(2026, 7, 26), new Date(2026, 7, 26))).toHaveLength(0);
  });
});

describe('peakHours', () => {
  it('finds the best contiguous two-hour window, not the single best hour', () => {
    const bills = [
      // 9 AM alone is the biggest single hour...
      bill({ at: at(9), lines: [line('p1', 'A', 10)] }),           // 250
      // ...but 5-7 PM together beats any window containing it.
      bill({ at: at(17), lines: [line('p1', 'A', 8)] }),           // 200
      bill({ at: at(18), lines: [line('p1', 'A', 8)] }),           // 200
    ];
    const peak = peakHours(bills, 2);
    expect(peak?.start).toBe(17);
    expect(peak?.sales).toBe(400);
    expect(peak?.label).toBe('5 PM – 7 PM');
  });

  it('returns null when there are no sales', () => {
    expect(peakHours([])).toBeNull();
    expect(peakHours([bill({ at: at(9), lines: [line('p1', 'A', 1)], status: 'cancelled' })])).toBeNull();
  });
});

describe('hourlyBuckets', () => {
  it('covers the full trading day even for hours with no sales', () => {
    const buckets = hourlyBuckets([bill({ at: at(9), lines: [line('p1', 'A', 1)] })]);
    expect(buckets).toHaveLength(17); // 6 AM through 10 PM
    expect(buckets.find((b) => b.label === '9 AM')?.sales).toBe(25);
    expect(buckets.find((b) => b.label === '2 PM')?.sales).toBe(0);
  });
});

describe('productPerformance', () => {
  const bills = [
    bill({ at: at(9), lines: [line('p1', 'Filter Coffee', 4), line('p2', 'Vadai', 2, 15, 5)] }),
    bill({ at: at(10), lines: [line('p1', 'Filter Coffee', 1)] }),
    bill({ at: at(11), lines: [line('p3', 'Ragi Adai', 2, 35, 13)] }),
  ];

  it('aggregates quantity and revenue per product', () => {
    const rows = productPerformance(bills, PRODUCTS);
    const coffee = rows.find((r) => r.productId === 'p1')!;
    expect(coffee.sold).toBe(5);
    expect(coffee.revenue).toBe(125);
    expect(coffee.cost).toBe(50);
    expect(coffee.margin).toBe(75);
  });

  it('includes products that never sold, at zero', () => {
    const rows = productPerformance(bills, PRODUCTS);
    const never = rows.find((r) => r.productId === 'p4')!;
    expect(never.sold).toBe(0);
    expect(never.revenue).toBe(0);
    expect(neverSold(rows).map((r) => r.productId)).toEqual(['p4']);
  });

  it('apportions a bill-level discount across the products on that bill', () => {
    const b = bill({ at: at(9), lines: [line('p1', 'A', 2), line('p2', 'B', 2, 15, 5)] });
    b.totals.billDiscount = 16; // 50 + 30 = 80 gross → split 10 / 6
    const rows = productPerformance([b], PRODUCTS);
    expect(rows.find((r) => r.productId === 'p1')!.discount).toBe(10);
    expect(rows.find((r) => r.productId === 'p2')!.discount).toBe(6);
  });

  it('excludes refunded bills', () => {
    const rows = productPerformance(
      [bill({ at: at(9), lines: [line('p1', 'A', 5)], status: 'refunded' })],
      PRODUCTS,
    );
    expect(rows.find((r) => r.productId === 'p1')!.sold).toBe(0);
  });
});

describe('topProducts and lowSelling', () => {
  const bills = [
    bill({ at: at(9), lines: [line('p1', 'Filter Coffee', 40)] }),
    bill({ at: at(10), lines: [line('p2', 'Vadai', 20, 15, 5)] }),
    bill({ at: at(11), lines: [line('p3', 'Ragi Adai', 3, 35, 13)] }),
  ];
  const rows = productPerformance(bills, PRODUCTS);

  it('ranks top sellers by quantity and omits unsold items', () => {
    const top = topProducts(rows, 5);
    expect(top.map((r) => r.name)).toEqual(['Filter Coffee', 'Vadai', 'Ragi Adai']);
  });

  it('flags only products that sold but sold poorly', () => {
    const low = lowSelling(rows, 10, 5);
    // Ragi Adai sold 3 (<= 10). The never-sold item must not appear — the plan
    // is explicit that new products are not branded bad sellers.
    expect(low.map((r) => r.name)).toEqual(['Ragi Adai']);
  });
});

describe('sortPerformance', () => {
  const rows = productPerformance(
    [
      bill({ at: at(9), lines: [line('p1', 'Filter Coffee', 10)] }),
      bill({ at: at(10), lines: [line('p2', 'Vadai', 2, 15, 5)] }),
    ],
    PRODUCTS,
  );

  it('orders by every supported criterion', () => {
    expect(sortPerformance(rows, 'best_selling')[0].name).toBe('Filter Coffee');
    expect(sortPerformance(rows, 'highest_revenue')[0].name).toBe('Filter Coffee');
    expect(sortPerformance(rows, 'worst_selling')[0].sold).toBe(0);
    expect(sortPerformance(rows, 'lowest_revenue')[0].revenue).toBe(0);
  });

  it('does not mutate the array it is given', () => {
    const before = rows.map((r) => r.productId);
    sortPerformance(rows, 'highest_revenue');
    expect(rows.map((r) => r.productId)).toEqual(before);
  });
});

describe('paymentSplit', () => {
  it('splits by method and percentages total 100', () => {
    const bills = [
      bill({ at: at(9), lines: [line('p1', 'A', 4)], payment: 'upi' }),    // 100
      bill({ at: at(10), lines: [line('p1', 'A', 2)], payment: 'cash' }),  // 50
      bill({ at: at(11), lines: [line('p1', 'A', 2)], payment: 'card' }),  // 50
    ];
    const split = paymentSplit(bills);
    expect(split[0]).toMatchObject({ method: 'upi', amount: 100, percent: 50 });
    expect(split.reduce((a, s) => a + s.percent, 0)).toBeCloseTo(100, 5);
  });

  it('reports zeroes rather than NaN with no sales', () => {
    expect(paymentSplit([]).every((p) => p.percent === 0 && p.amount === 0)).toBe(true);
  });
});

describe('cashInDrawer', () => {
  it('counts only completed cash bills', () => {
    const bills = [
      bill({ at: at(9), lines: [line('p1', 'A', 2)], payment: 'cash' }),
      bill({ at: at(10), lines: [line('p1', 'A', 2)], payment: 'upi' }),
      bill({ at: at(11), lines: [line('p1', 'A', 2)], payment: 'cash', status: 'refunded' }),
    ];
    expect(cashInDrawer(bills)).toBe(50);
  });
});

describe('discountSummary', () => {
  it('separates item and bill discounts and counts affected bills', () => {
    const a = bill({ at: at(9), lines: [line('p1', 'A', 2)] });
    a.totals.itemDiscount = 5;
    const b = bill({ at: at(10), lines: [line('p1', 'A', 2)] });
    b.totals.billDiscount = 10;
    const c = bill({ at: at(11), lines: [line('p1', 'A', 2)] });

    const s = discountSummary([a, b, c]);
    expect(s.itemDiscount).toBe(5);
    expect(s.billDiscount).toBe(10);
    expect(s.total).toBe(15);
    expect(s.billCount).toBe(2);
  });
});

describe('categoryPerformance', () => {
  it('rolls product revenue up to categories, highest first', () => {
    const rows = productPerformance(
      [bill({ at: at(9), lines: [line('p1', 'Filter Coffee', 10), line('p3', 'Ragi Adai', 1, 35, 13)] })],
      PRODUCTS,
    );
    const cats = categoryPerformance(rows, CATEGORIES);
    expect(cats[0].name).toBe('Coffee');
    expect(cats[0].revenue).toBe(250);
    expect(cats[1].revenue).toBe(35);
  });
});
