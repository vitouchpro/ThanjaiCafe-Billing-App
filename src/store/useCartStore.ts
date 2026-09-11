import { create } from 'zustand';
import type { BillLine, DiscountType, ID, Product } from '@/types';

/* POS cart. Kept separate from the app store so a keystroke in the cart
   does not re-render product grids or dashboards. */

export interface HeldBill {
  id: string;
  label: string;
  heldAt: string;
  lines: BillLine[];
  billDiscount: number;
  billDiscountType: DiscountType;
  customerName?: string;
  customerPhone?: string;
}

interface CartState {
  lines: BillLine[];
  billDiscount: number;
  billDiscountType: DiscountType;
  customerName: string;
  customerPhone: string;
  note: string;
  held: HeldBill[];

  addProduct: (p: Product) => void;
  setQty: (lineId: ID, qty: number) => void;
  increment: (lineId: ID) => void;
  decrement: (lineId: ID) => void;
  removeLine: (lineId: ID) => void;
  setLineDiscount: (lineId: ID, discount: number, type: DiscountType) => void;
  setLineNote: (lineId: ID, note: string) => void;
  setBillDiscount: (v: number, type: DiscountType) => void;
  setCustomer: (name: string, phone: string) => void;
  setNote: (v: string) => void;
  clear: () => void;

  hold: (label: string) => void;
  resume: (id: string) => void;
  dropHeld: (id: string) => void;

  itemCount: () => number;
}

const lineId = (): string => `ln-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const useCartStore = create<CartState>((set, get) => ({
  lines: [],
  billDiscount: 0,
  billDiscountType: 'percent',
  customerName: '',
  customerPhone: '',
  note: '',
  held: [],

  addProduct(p) {
    const { lines } = get();
    // Repeat taps on a product card bump quantity rather than stacking
    // duplicate rows — but only when the line has no bespoke discount/note.
    const existing = lines.find((l) => l.productId === p.id && !l.discount && !l.note);
    if (existing) {
      set({ lines: lines.map((l) => (l.id === existing.id ? { ...l, qty: l.qty + 1 } : l)) });
      return;
    }
    set({
      lines: [
        ...lines,
        {
          id: lineId(),
          productId: p.id,
          name: p.name,
          unitPrice: p.sellingPrice,
          costPrice: p.costPrice,
          qty: 1,
          discount: p.discount,
          discountType: p.discountType,
          taxRate: p.taxRate,
        },
      ],
    });
  },

  setQty(id, qty) {
    if (qty <= 0) {
      set({ lines: get().lines.filter((l) => l.id !== id) });
      return;
    }
    set({ lines: get().lines.map((l) => (l.id === id ? { ...l, qty: Math.min(qty, 999) } : l)) });
  },

  increment: (id) => get().setQty(id, (get().lines.find((l) => l.id === id)?.qty ?? 0) + 1),
  decrement: (id) => get().setQty(id, (get().lines.find((l) => l.id === id)?.qty ?? 0) - 1),

  removeLine: (id) => set({ lines: get().lines.filter((l) => l.id !== id) }),

  setLineDiscount: (id, discount, type) =>
    set({
      lines: get().lines.map((l) =>
        l.id === id ? { ...l, discount: Math.max(0, discount), discountType: type } : l,
      ),
    }),

  setLineNote: (id, note) =>
    set({ lines: get().lines.map((l) => (l.id === id ? { ...l, note } : l)) }),

  setBillDiscount: (v, type) => set({ billDiscount: Math.max(0, v), billDiscountType: type }),
  setCustomer: (customerName, customerPhone) => set({ customerName, customerPhone }),
  setNote: (note) => set({ note }),

  clear: () =>
    set({
      lines: [], billDiscount: 0, billDiscountType: 'percent',
      customerName: '', customerPhone: '', note: '',
    }),

  hold(label) {
    const s = get();
    if (!s.lines.length) return;
    const entry: HeldBill = {
      id: `hold-${Date.now().toString(36)}`,
      label: label || `Table ${s.held.length + 1}`,
      heldAt: new Date().toISOString(),
      lines: s.lines,
      billDiscount: s.billDiscount,
      billDiscountType: s.billDiscountType,
      customerName: s.customerName,
      customerPhone: s.customerPhone,
    };
    set({
      held: [...s.held, entry],
      lines: [], billDiscount: 0, billDiscountType: 'percent',
      customerName: '', customerPhone: '', note: '',
    });
  },

  resume(id) {
    const s = get();
    const entry = s.held.find((h) => h.id === id);
    if (!entry) return;
    // Anything already in the cart is parked, not discarded.
    const parked: HeldBill[] = s.lines.length
      ? [{
          id: `hold-${Date.now().toString(36)}`,
          label: `Parked ${new Date().toLocaleTimeString()}`,
          heldAt: new Date().toISOString(),
          lines: s.lines,
          billDiscount: s.billDiscount,
          billDiscountType: s.billDiscountType,
          customerName: s.customerName,
          customerPhone: s.customerPhone,
        }]
      : [];

    set({
      lines: entry.lines,
      billDiscount: entry.billDiscount,
      billDiscountType: entry.billDiscountType,
      customerName: entry.customerName ?? '',
      customerPhone: entry.customerPhone ?? '',
      held: [...s.held.filter((h) => h.id !== id), ...parked],
    });
  },

  dropHeld: (id) => set({ held: get().held.filter((h) => h.id !== id) }),

  itemCount: () => get().lines.reduce((a, l) => a + l.qty, 0),
}));
