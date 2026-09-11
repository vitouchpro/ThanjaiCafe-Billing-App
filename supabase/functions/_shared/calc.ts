/* Deno copy of src/services/billing/calc.ts.

   The customer's phone and this server must agree on the total to the paise,
   so there is exactly one money engine and this file is a verbatim copy of it
   below the shim. The parity test in __tests__/calc-parity.test.ts fails if
   the two ever drift. Edit src/services/billing/calc.ts, then re-copy.

   Types and the money helpers are inlined rather than imported because Deno
   edge functions cannot resolve the app's `@/` path alias. The helper bodies
   are copied verbatim from src/utils/money.ts. */

type DiscountType = 'percent' | 'fixed';

interface BillLine {
  id: string; productId: string; name: string; unitPrice: number;
  costPrice: number; qty: number; discount: number;
  discountType: DiscountType; taxRate: number; note?: string;
}

interface BillTotals {
  subtotal: number; itemDiscount: number; billDiscount: number;
  taxableValue: number; tax: number; total: number; cost: number;
}

interface Product { sellingPrice: number; discount: number; discountType: DiscountType; }

const toPaise = (rupees: number): number => Math.round((rupees || 0) * 100);
const toRupees = (paise: number): number => paise / 100;
const money = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
/* END SHIM */

/* ============================================================
   Bill maths. Everything below works in integer paise and only
   converts back to rupees at the boundary. (Plan §11)

   Order of operations:
     1. line gross      = unitPrice * qty
     2. item discount   = per-line percent or fixed (fixed is per unit)
     3. bill discount   = apportioned across lines by post-item-discount value
     4. GST             = on the net line value, inclusive or exclusive
   Apportioning the bill discount (rather than subtracting it at the end)
   is what keeps per-product discount reporting and GST correct when a
   bill mixes 5% and 12% tax slabs.
   ============================================================ */

export function lineDiscountPaise(line: Pick<BillLine, 'unitPrice' | 'qty' | 'discount' | 'discountType'>): number {
  const gross = toPaise(line.unitPrice) * line.qty;
  if (!line.discount) return 0;
  const d =
    line.discountType === 'percent'
      ? Math.round((gross * line.discount) / 100)
      : toPaise(line.discount) * line.qty; // fixed discount is per unit
  return Math.min(Math.max(d, 0), gross);
}

export function discountAmountPaise(basePaise: number, value: number, type: DiscountType): number {
  if (!value) return 0;
  const d = type === 'percent' ? Math.round((basePaise * value) / 100) : toPaise(value);
  return Math.min(Math.max(d, 0), basePaise);
}

export interface ComputedLine {
  line: BillLine;
  grossPaise: number;
  itemDiscountPaise: number;
  billDiscountSharePaise: number;
  netPaise: number;      // after all discounts, tax-exclusive base
  taxPaise: number;
  totalPaise: number;    // netPaise + taxPaise
}

export interface ComputedBill {
  lines: ComputedLine[];
  totals: BillTotals;
  /** GST grouped by slab, for the tax breakup on the invoice. */
  taxBreakup: { rate: number; taxable: number; tax: number }[];
}

export function computeBill(
  lines: BillLine[],
  billDiscount: number,
  billDiscountType: DiscountType,
  opts: { pricesIncludeTax: boolean; roundTotals: boolean },
): ComputedBill {
  const gross = lines.map((l) => toPaise(l.unitPrice) * l.qty);
  const itemDisc = lines.map((l) => lineDiscountPaise(l));
  const afterItem = lines.map((_, i) => gross[i] - itemDisc[i]);
  const afterItemTotal = afterItem.reduce((a, b) => a + b, 0);

  // Bill-level discount, apportioned by each line's share of the post-item total.
  const billDiscTotal = discountAmountPaise(afterItemTotal, billDiscount, billDiscountType);
  const billShares = apportion(billDiscTotal, afterItem);

  // Net (post-discount) value per line, and its tax-exclusive base.
  const netWithTax = lines.map((_, i) => afterItem[i] - billShares[i]);
  const bases = lines.map((line, i) =>
    // Inclusive pricing: back out the tax already inside the price.
    opts.pricesIncludeTax
      ? Math.round((netWithTax[i] * 10000) / (10000 + (line.taxRate || 0) * 100))
      : netWithTax[i],
  );

  // Tax is rounded per slab, then apportioned back across the lines in that
  // slab. Rounding each line independently would shave a paisa per line and
  // leave the invoice total a few paise under the true GST due.
  const taxes = new Array<number>(lines.length).fill(0);
  const slabs = new Map<number, number[]>();
  lines.forEach((line, i) => {
    const rate = line.taxRate || 0;
    if (!rate) return;
    const idx = slabs.get(rate);
    if (idx) idx.push(i);
    else slabs.set(rate, [i]);
  });

  for (const [rate, idx] of slabs) {
    if (opts.pricesIncludeTax) {
      // Inclusive: the tax is whatever is left over inside the price.
      for (const i of idx) taxes[i] = netWithTax[i] - bases[i];
    } else {
      const slabBase = idx.reduce((a, i) => a + bases[i], 0);
      const slabTax = Math.round((slabBase * rate) / 100);
      const shares = apportion(slabTax, idx.map((i) => bases[i]));
      idx.forEach((i, k) => (taxes[i] = shares[k]));
    }
  }

  const computed: ComputedLine[] = lines.map((line, i) => ({
    line,
    grossPaise: gross[i],
    itemDiscountPaise: itemDisc[i],
    billDiscountSharePaise: billShares[i],
    netPaise: bases[i],
    taxPaise: taxes[i],
    totalPaise: bases[i] + taxes[i],
  }));

  const sum = (f: (c: ComputedLine) => number) => computed.reduce((a, c) => a + f(c), 0);

  const taxable = sum((c) => c.netPaise);
  const tax = sum((c) => c.taxPaise);
  let total = taxable + tax;
  if (opts.roundTotals) total = Math.round(total / 100) * 100;

  const breakupMap = new Map<number, { taxable: number; tax: number }>();
  for (const c of computed) {
    if (!c.taxPaise && !c.line.taxRate) continue;
    const e = breakupMap.get(c.line.taxRate) ?? { taxable: 0, tax: 0 };
    e.taxable += c.netPaise;
    e.tax += c.taxPaise;
    breakupMap.set(c.line.taxRate, e);
  }

  return {
    lines: computed,
    taxBreakup: [...breakupMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rate, v]) => ({ rate, taxable: toRupees(v.taxable), tax: toRupees(v.tax) })),
    totals: {
      subtotal: toRupees(sum((c) => c.grossPaise)),
      itemDiscount: toRupees(sum((c) => c.itemDiscountPaise)),
      billDiscount: toRupees(billDiscTotal),
      taxableValue: toRupees(taxable),
      tax: toRupees(tax),
      total: toRupees(total),
      cost: toRupees(lines.reduce((a, l) => a + toPaise(l.costPrice) * l.qty, 0)),
    },
  };
}

/** Largest-remainder apportioning: shares always sum back to `amount` exactly,
    so a ₹20 bill discount never becomes ₹19.99 after rounding. */
export function apportion(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount <= 0 || total <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (amount * w) / total);
  const floors = exact.map(Math.floor);
  let remainder = amount - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);

  const out = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) out[order[k].i]++;
  return out;
}

/** Effective per-unit price after the product's own discount — used on POS cards. */
export function effectivePrice(p: Pick<Product, 'sellingPrice' | 'discount' | 'discountType'>): number {
  if (!p.discount) return p.sellingPrice;
  const base = toPaise(p.sellingPrice);
  const d = p.discountType === 'percent' ? Math.round((base * p.discount) / 100) : toPaise(p.discount);
  return toRupees(Math.max(base - d, 0));
}

export const lineTotal = (c: ComputedLine): number => toRupees(c.totalPaise);

export function marginPercent(price: number, cost: number): number {
  if (!price) return 0;
  return money(((price - cost) / price) * 100);
}
