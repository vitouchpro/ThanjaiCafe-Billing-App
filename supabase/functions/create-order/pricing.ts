import { computeBill } from '../_shared/calc.ts';

/* The security boundary. Everything the phone sends about money is a display
   value; the real total is computed here from the published menu. A tampered
   client cannot pay one rupee for a five-hundred-rupee order. */

export interface RequestedLine {
  productId: string;
  qty: number;
  note?: string;
  unitPrice?: number;  // ignored — accepted only so the client can be honest
  name?: string;       // ignored
}

export interface MenuItemRow {
  id: string;
  name: string;
  price: number;
  tax_rate: number;
  available: boolean;
}

const MAX_QTY = 99;
const MAX_LINES = 50;

export function priceOrder(requested: RequestedLine[], menu: MenuItemRow[]) {
  if (!requested.length) throw new Error('Order is empty');
  if (requested.length > MAX_LINES) throw new Error('Too many items in one order');

  const byId = new Map(menu.map((m) => [m.id, m]));

  const priced = requested.map((r) => {
    const item = byId.get(r.productId);
    if (!item) throw new Error(`Item is not on the menu: ${r.productId}`);
    if (!item.available) throw new Error(`Sold out: ${item.name}`);
    if (!Number.isInteger(r.qty) || r.qty < 1 || r.qty > MAX_QTY) {
      throw new Error(`Invalid quantity for ${item.name}`);
    }
    return {
      product_id: item.id,
      name: item.name,
      unit_price: item.price,
      qty: r.qty,
      tax_rate: item.tax_rate,
      note: r.note?.slice(0, 200),
    };
  });

  const { totals } = computeBill(
    priced.map((p) => ({
      id: p.product_id, productId: p.product_id, name: p.name,
      unitPrice: p.unit_price, costPrice: 0, qty: p.qty,
      discount: 0, discountType: 'percent' as const, taxRate: p.tax_rate,
    })),
    0, 'fixed',
    { pricesIncludeTax: false, roundTotals: false },
  );

  return { lines: priced, totals };
}
