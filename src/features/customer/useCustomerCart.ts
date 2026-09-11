import { create } from 'zustand';
import { computeBill } from '@/services/billing/calc';
import type { MenuRow } from '@/services/cloud/menu';
import type { BillLine } from '@/types';

/* The customer's cart. Totals run through the same integer-paise engine the
   till uses, so the phone and the server agree to the paise — and the server
   recomputes anyway before taking any money. */

export const MAX_QTY = 99;

/** The kitchen sells whole cups and plates, and the server rejects anything
    that is not an integer in 1..MAX_QTY — so a cart must never hold one.
    NaN needs an explicit test: `NaN <= 0` is false, so it would otherwise
    survive and turn every total into NaN. */
const normaliseQty = (qty: number): number => {
  if (!Number.isFinite(qty)) return 0;          // NaN / Infinity -> remove
  return Math.min(Math.floor(qty), MAX_QTY);
};

export interface CartItem extends MenuRow {
  qty: number;
  note?: string;
}

interface CartState {
  tableCode: string;
  items: CartItem[];
  setTable: (code: string) => void;
  add: (row: MenuRow) => void;
  remove: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
}

export const useCustomerCart = create<CartState>((set) => ({
  tableCode: '',
  items: [],

  setTable: (tableCode) => set({ tableCode }),

  add: (row) => set((s) => {
    if (!row.available) return s; // a sold-out item cannot enter the cart
    const existing = s.items.find((i) => i.id === row.id);
    return existing
      ? { items: s.items.map((i) => (i.id === row.id ? { ...i, qty: Math.min(i.qty + 1, MAX_QTY) } : i)) }
      : { items: [...s.items, { ...row, qty: 1 }] };
  }),

  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  setQty: (id, qty) => set((s) => {
    const next = normaliseQty(qty);
    return {
      items: next <= 0
        ? s.items.filter((i) => i.id !== id)
        : s.items.map((i) => (i.id === id ? { ...i, qty: next } : i)),
    };
  }),

  clear: () => set({ items: [] }),
}));

/** Cart lines in the shape the money engine expects. */
export const toBillLines = (items: CartItem[]): BillLine[] =>
  items.map((i) => ({
    id: i.id, productId: i.id, name: i.name,
    unitPrice: i.price, costPrice: 0, qty: i.qty,
    discount: 0, discountType: 'percent' as const,
    taxRate: i.tax_rate, note: i.note,
  }));

export function cartTotals(items: CartItem[]) {
  const { totals } = computeBill(toBillLines(items), 0, 'fixed', {
    pricesIncludeTax: false,
    roundTotals: false,
  });
  return totals;
}
