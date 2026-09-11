import type { Bill, BillLine, PaymentMethod, Product, Settings } from '@/types';
import { computeBill } from '@/services/billing/calc';
import { addDays, dateKey, startOfDay } from '@/utils/date';

/* Generates ~90 days of plausible trading history so the dashboard and
   reports render real distributions on first run. Seeded PRNG keeps the
   numbers stable between reloads. */

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Orders per hour, 6 AM–10 PM. Morning coffee rush and a 5–7 PM evening
    peak — the shape the "Peak Hours" insight is meant to surface. */
const HOUR_WEIGHTS: Record<number, number> = {
  6: 0.4, 7: 1.6, 8: 2.4, 9: 2.0, 10: 1.2, 11: 0.9, 12: 1.1, 13: 1.3,
  14: 0.7, 15: 0.9, 16: 1.4, 17: 2.6, 18: 3.0, 19: 2.4, 20: 1.3, 21: 0.6,
};

const DAY_FACTOR = [0.85, 0.92, 1.0, 0.98, 1.05, 1.18, 1.12]; // Sun..Sat

/** Relative popularity — creates clear top sellers and a believable
    long tail for the "Low Selling / Review Required" list. */
function popularity(p: Product, rnd: () => number): number {
  const base: Record<string, number> = {
    'Filter Coffee': 10, 'Vadai': 8, 'Masala Tea': 7, 'Thattai': 5,
    'Sukku Coffee': 4.5, 'Idli (2 pcs)': 4, 'Bonda': 3.5, 'Pongal': 3,
    'Masala Dosa': 3, 'Ginger Tea': 3, 'Samosa': 2.5, 'Banana Bajji': 2.4,
    'Murukku': 2, 'Plain Dosa': 2, 'Black Coffee': 1.6, 'Badam Milk': 1.5,
    'Mysore Pak': 1.4, 'Upma': 1.3, 'Poori (2 pcs)': 1.2, 'Cold Coffee': 1.2,
    'Rava Kesari': 1, 'Jangiri': 1, 'Lemon Tea': 1, 'Green Tea': 0.9,
    'Ragi Malt': 0.6, 'Millet Bonda': 0.35, 'Ragi Adai': 0.25, 'Kambu Kozhukattai': 0.3,
  };
  return (base[p.name] ?? 1) * (0.85 + rnd() * 0.3);
}

function pick<T>(items: T[], weights: number[], rnd: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function generateHistory(products: Product[], settings: Settings, days = 90): Bill[] {
  const rnd = mulberry32(20260826);
  const sellable = products.filter((p) => !p.archived);
  const weights = sellable.map((p) => popularity(p, rnd));
  const bills: Bill[] = [];
  const cashiers = [
    { id: 'usr-cashier', name: 'Priya' },
    { id: 'usr-manager', name: 'Ravi' },
  ];

  let seq = settings.invoice.startingNumber;
  const today = startOfDay(new Date());

  for (let d = days - 1; d >= 0; d--) {
    const date = addDays(today, -d);
    // Gentle upward trend over the period, plus day-of-week seasonality.
    const trend = 0.82 + ((days - d) / days) * 0.3;
    const factor = DAY_FACTOR[date.getDay()] * trend * (0.9 + rnd() * 0.2);

    for (const [hourStr, w] of Object.entries(HOUR_WEIGHTS)) {
      const hour = Number(hourStr);
      const count = Math.max(0, Math.round(w * 4.2 * factor + (rnd() - 0.5) * 3));

      for (let i = 0; i < count; i++) {
        const at = new Date(date);
        at.setHours(hour, Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);

        const nLines = 1 + Math.floor(rnd() * 3.2);
        const chosen = new Map<string, number>();
        for (let k = 0; k < nLines; k++) {
          const p = pick(sellable, weights, rnd);
          chosen.set(p.id, (chosen.get(p.id) ?? 0) + (rnd() < 0.75 ? 1 : 2));
        }

        const lines: BillLine[] = [...chosen.entries()].map(([pid, qty], k) => {
          const p = sellable.find((x) => x.id === pid)!;
          return {
            id: `${seq}-${k}`,
            productId: p.id,
            name: p.name,
            unitPrice: p.sellingPrice,
            costPrice: p.costPrice,
            qty,
            discount: 0,
            discountType: 'percent' as const,
            taxRate: p.taxRate,
          };
        });

        // ~12% of bills carry a small bill-level discount.
        const hasDiscount = rnd() < 0.12;
        const billDiscount = hasDiscount ? (rnd() < 0.5 ? 5 : 10) : 0;

        const r = computeBill(lines, billDiscount, 'percent', {
          pricesIncludeTax: settings.billing.pricesIncludeTax,
          roundTotals: settings.billing.roundTotals,
        });

        // UPI-dominant mix, matching the plan's 62 / 27 / 11 split.
        const pr = rnd();
        const payment: PaymentMethod = pr < 0.62 ? 'upi' : pr < 0.89 ? 'cash' : 'card';
        const cashier = cashiers[rnd() < 0.75 ? 0 : 1];
        const isRefund = rnd() < 0.004;

        bills.push({
          id: `bill-${seq}`,
          billNo: `${settings.invoice.prefix}${seq}`,
          seq,
          createdAt: at.toISOString(),
          lines,
          billDiscount,
          billDiscountType: 'percent',
          totals: r.totals,
          payment,
          cashReceived: payment === 'cash' ? Math.ceil(r.totals.total / 10) * 10 : undefined,
          change: payment === 'cash' ? Math.ceil(r.totals.total / 10) * 10 - r.totals.total : undefined,
          status: isRefund ? 'refunded' : 'completed',
          refundedAt: isRefund ? at.toISOString() : undefined,
          refundAmount: isRefund ? r.totals.total : undefined,
          cashierId: cashier.id,
          cashierName: cashier.name,
          synced: d > 0 ? 1 : 0, // today's bills still pending sync
        });
        seq++;
      }
    }
  }

  bills.sort((a, b) => a.seq - b.seq);
  return bills;
}

export const nextSeqAfter = (bills: Bill[], fallback: number): number =>
  bills.length ? Math.max(...bills.map((b) => b.seq)) + 1 : fallback;

export const todayKey = () => dateKey(new Date());
