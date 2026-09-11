import type {
  Bill, Category, ID, PaymentMethod, Product,
  ProductPerformanceRow, SalesSummary, TimeBucket,
} from '@/types';
import { dateKey, eachDay, formatDayShort, formatHour, startOfDay, endOfDay } from '@/utils/date';
import { money } from '@/utils/money';

/* Every report reads from the same bill array. Refunded and cancelled bills
   are excluded from sales but tracked separately — a refunded bill must not
   inflate revenue while still appearing in the refunds line. */

export const isSale = (b: Bill): boolean => b.status === 'completed';

/** A bill raised from a QR order rather than taken at the counter. */
export const isOnlineBill = (b: Bill): boolean => Boolean(b.sourceOrderId);

export function billsBetween(bills: Bill[], from: Date, to: Date): Bill[] {
  const s = startOfDay(from).getTime();
  const e = endOfDay(to).getTime();
  return bills.filter((b) => {
    if (b.status === 'held') return false;
    const t = new Date(b.createdAt).getTime();
    return t >= s && t <= e;
  });
}

export const billsOnDay = (bills: Bill[], day: Date): Bill[] => billsBetween(bills, day, day);

export function summarize(bills: Bill[]): SalesSummary {
  const sales = bills.filter(isSale);
  const totalSales = sales.reduce((a, b) => a + b.totals.total, 0);
  const cost = sales.reduce((a, b) => a + b.totals.cost, 0);
  const refunds = bills
    .filter((b) => b.status === 'refunded')
    .reduce((a, b) => a + (b.refundAmount ?? b.totals.total), 0);

  return {
    totalSales: money(totalSales),
    orders: sales.length,
    avgBill: sales.length ? money(totalSales / sales.length) : 0,
    discount: money(sales.reduce((a, b) => a + b.totals.itemDiscount + b.totals.billDiscount, 0)),
    refunds: money(refunds),
    tax: money(sales.reduce((a, b) => a + b.totals.tax, 0)),
    cost: money(cost),
    margin: money(totalSales - cost),
  };
}

/* ---------- Trends ---------- */

export function hourlyBuckets(bills: Bill[]): TimeBucket[] {
  const buckets = new Map<number, { sales: number; orders: number }>();
  for (let h = 6; h <= 22; h++) buckets.set(h, { sales: 0, orders: 0 });

  for (const b of bills.filter(isSale)) {
    const h = new Date(b.createdAt).getHours();
    const e = buckets.get(h) ?? { sales: 0, orders: 0 };
    e.sales += b.totals.total;
    e.orders++;
    buckets.set(h, e);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, v]) => ({ label: formatHour(h), sales: money(v.sales), orders: v.orders }));
}

export function dailyBuckets(bills: Bill[], from: Date, to: Date): TimeBucket[] {
  const byDay = new Map<string, { sales: number; orders: number }>();
  for (const b of bills.filter(isSale)) {
    const k = dateKey(b.createdAt);
    const e = byDay.get(k) ?? { sales: 0, orders: 0 };
    e.sales += b.totals.total;
    e.orders++;
    byDay.set(k, e);
  }

  return eachDay(from, to).map((d) => {
    const e = byDay.get(dateKey(d)) ?? { sales: 0, orders: 0 };
    return { label: formatDayShort(d), sales: money(e.sales), orders: e.orders };
  });
}

export interface DatedBucket {
  date: Date;
  key: string;
  label: string;
  day: string;
  sales: number;
  orders: number;
}

export function dailyBucketsDated(bills: Bill[], from: Date, to: Date): DatedBucket[] {
  const byDay = new Map<string, { sales: number; orders: number }>();
  for (const b of bills.filter(isSale)) {
    const k = dateKey(b.createdAt);
    const e = byDay.get(k) ?? { sales: 0, orders: 0 };
    e.sales += b.totals.total;
    e.orders++;
    byDay.set(k, e);
  }
  return eachDay(from, to).map((d) => {
    const k = dateKey(d);
    const e = byDay.get(k) ?? { sales: 0, orders: 0 };
    return {
      date: d, key: k, label: `${d.getDate()}`, day: formatDayShort(d),
      sales: money(e.sales), orders: e.orders,
    };
  });
}

export interface PeakWindow { start: number; end: number; sales: number; label: string; }

/** Best contiguous window of `span` hours — the plan asks for "5 PM – 7 PM", a
    range, not the single busiest hour. */
export function peakHours(bills: Bill[], span = 2): PeakWindow | null {
  const sales = new Array(24).fill(0);
  let any = false;
  for (const b of bills.filter(isSale)) {
    sales[new Date(b.createdAt).getHours()] += b.totals.total;
    any = true;
  }
  if (!any) return null;

  let best = { start: 0, total: -1 };
  for (let h = 0; h <= 24 - span; h++) {
    const total = sales.slice(h, h + span).reduce((a: number, b: number) => a + b, 0);
    if (total > best.total) best = { start: h, total };
  }
  if (best.total <= 0) return null;

  return {
    start: best.start,
    end: best.start + span,
    sales: money(best.total),
    label: `${formatHour(best.start)} – ${formatHour(best.start + span)}`,
  };
}

/* ---------- Products ---------- */

export function productPerformance(bills: Bill[], products: Product[]): ProductPerformanceRow[] {
  const map = new Map<ID, ProductPerformanceRow>();
  const index = new Map(products.map((p) => [p.id, p]));

  // Seed every non-archived product at zero so items that never sold still
  // surface in the low-selling report.
  for (const p of products) {
    if (p.archived) continue;
    map.set(p.id, {
      productId: p.id, name: p.name, categoryId: p.categoryId,
      sold: 0, revenue: 0, discount: 0, cost: 0, margin: 0,
    });
  }

  for (const b of bills.filter(isSale)) {
    // Each line gets its share of the bill-level discount, so per-product
    // discount reporting reflects bill discounts too.
    const lineNet = b.lines.map((l) => l.unitPrice * l.qty);
    const netTotal = lineNet.reduce((a, x) => a + x, 0) || 1;

    b.lines.forEach((l, i) => {
      const p = index.get(l.productId);
      const row = map.get(l.productId) ?? {
        productId: l.productId, name: l.name, categoryId: p?.categoryId ?? '',
        sold: 0, revenue: 0, discount: 0, cost: 0, margin: 0,
      };
      const share = (lineNet[i] / netTotal) * b.totals.billDiscount;
      const itemDisc =
        l.discountType === 'percent' ? (l.unitPrice * l.qty * l.discount) / 100 : l.discount * l.qty;

      row.sold += l.qty;
      row.revenue += lineNet[i] - itemDisc - share;
      row.discount += itemDisc + share;
      row.cost += l.costPrice * l.qty;
      map.set(l.productId, row);
    });
  }

  return [...map.values()].map((r) => ({
    ...r,
    revenue: money(r.revenue),
    discount: money(r.discount),
    cost: money(r.cost),
    margin: money(r.revenue - r.cost),
  }));
}

export type PerformanceSort =
  | 'best_selling' | 'worst_selling' | 'highest_revenue'
  | 'lowest_revenue' | 'highest_discount' | 'most_discounted';

export const PERFORMANCE_SORTS: { value: PerformanceSort; label: string }[] = [
  { value: 'best_selling', label: 'Best Selling' },
  { value: 'worst_selling', label: 'Worst Selling' },
  { value: 'highest_revenue', label: 'Highest Revenue' },
  { value: 'lowest_revenue', label: 'Lowest Revenue' },
  { value: 'highest_discount', label: 'Highest Discount' },
  { value: 'most_discounted', label: 'Most Discounted' },
];

export function sortPerformance(rows: ProductPerformanceRow[], sort: PerformanceSort): ProductPerformanceRow[] {
  const c = [...rows];
  switch (sort) {
    case 'best_selling': return c.sort((a, b) => b.sold - a.sold);
    case 'worst_selling': return c.sort((a, b) => a.sold - b.sold);
    case 'highest_revenue': return c.sort((a, b) => b.revenue - a.revenue);
    case 'lowest_revenue': return c.sort((a, b) => a.revenue - b.revenue);
    case 'highest_discount': return c.sort((a, b) => b.discount - a.discount);
    case 'most_discounted':
      // Share of gross value given away, not the raw rupee figure.
      return c.sort((a, b) => {
        const ra = a.revenue + a.discount ? a.discount / (a.revenue + a.discount) : 0;
        const rb = b.revenue + b.discount ? b.discount / (b.revenue + b.discount) : 0;
        return rb - ra;
      });
  }
}

export const topProducts = (rows: ProductPerformanceRow[], n = 5): ProductPerformanceRow[] =>
  sortPerformance(rows, 'best_selling').filter((r) => r.sold > 0).slice(0, n);

/** Products that sold, but poorly. Never-sold items are listed separately so a
    newly added product is not branded a bad seller on day one. (Plan §5) */
export function lowSelling(rows: ProductPerformanceRow[], threshold: number, n = 5): ProductPerformanceRow[] {
  return rows
    .filter((r) => r.sold > 0 && r.sold <= threshold)
    .sort((a, b) => a.sold - b.sold)
    .slice(0, n);
}

export const neverSold = (rows: ProductPerformanceRow[]): ProductPerformanceRow[] =>
  rows.filter((r) => r.sold === 0);

/* ---------- Categories & payments ---------- */

export interface CategoryRow { categoryId: ID; name: string; icon: string; revenue: number; sold: number; }

export function categoryPerformance(rows: ProductPerformanceRow[], categories: Category[]): CategoryRow[] {
  const map = new Map<ID, CategoryRow>();
  for (const c of categories) {
    map.set(c.id, { categoryId: c.id, name: c.name, icon: c.icon, revenue: 0, sold: 0 });
  }
  for (const r of rows) {
    const e = map.get(r.categoryId);
    if (!e) continue;
    e.revenue = money(e.revenue + r.revenue);
    e.sold += r.sold;
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export interface PaymentRow {
  method: PaymentMethod; label: string; amount: number; count: number; percent: number;
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card' };

export function paymentSplit(bills: Bill[]): PaymentRow[] {
  const sales = bills.filter(isSale);
  const total = sales.reduce((a, b) => a + b.totals.total, 0);
  const methods: PaymentMethod[] = ['upi', 'cash', 'card'];

  return methods
    .map((m) => {
      const of = sales.filter((b) => b.payment === m);
      const amount = money(of.reduce((a, b) => a + b.totals.total, 0));
      return {
        method: m,
        label: PAYMENT_LABELS[m],
        amount,
        count: of.length,
        percent: total ? money((amount / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

export interface DiscountSummary {
  total: number; billCount: number; itemDiscount: number; billDiscount: number; avgPercent: number;
}

export function discountSummary(bills: Bill[]): DiscountSummary {
  const sales = bills.filter(isSale);
  const withDiscount = sales.filter((b) => b.totals.itemDiscount + b.totals.billDiscount > 0);
  const item = sales.reduce((a, b) => a + b.totals.itemDiscount, 0);
  const bill = sales.reduce((a, b) => a + b.totals.billDiscount, 0);
  const gross = sales.reduce((a, b) => a + b.totals.subtotal, 0);

  return {
    total: money(item + bill),
    billCount: withDiscount.length,
    itemDiscount: money(item),
    billDiscount: money(bill),
    avgPercent: gross ? money(((item + bill) / gross) * 100) : 0,
  };
}

/** Sales taken through QR ordering. Settled by the gateway, not the drawer. */
export function onlineSalesTotal(bills: Bill[]): number {
  return money(
    bills.filter((b) => isSale(b) && isOnlineBill(b)).reduce((a, b) => a + b.totals.total, 0),
  );
}

export function cashInDrawer(bills: Bill[]): number {
  return money(
    bills
      // `!isOnlineBill` is belt and braces: orderToBill always writes 'upi', but
      // this figure is what a shop counts its drawer against, so it must not be
      // one future edit away from being wrong.
      .filter((b) => isSale(b) && b.payment === 'cash' && !isOnlineBill(b))
      .reduce((a, b) => a + b.totals.total, 0),
  );
}
