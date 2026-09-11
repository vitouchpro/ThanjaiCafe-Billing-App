import { computeBill } from './calc';
import { toPaise } from '@/utils/money';
import type { Bill, BillLine, ID, Settings } from '@/types';
import type { CloudOrder } from '@/types/order';

/* A paid QR order becomes an ordinary bill in the till's own database, so
   reports, day-close and refunds treat it exactly like a walk-in sale.

   Totals are recomputed locally rather than trusted from the cloud row. They
   must agree — both sides run the same engine — and recomputing means a bill
   is never stored with a total the till itself would not have produced. */

export interface BillContext {
  seq: number;
  billNo: string;
  settings: Settings;
  cashierId: ID;
  cashierName: string;
}

/** Statuses that mean the money is in. Anything else must not become a bill. */
const BILLABLE: CloudOrder['status'][] = ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'];

export function orderToBill(order: CloudOrder, ctx: BillContext): Bill {
  /* Guarding here as well as at the call site. The caller filters for PAID
     today, but a bill is a record that money was taken, and this function is
     one careless call away from asserting that about an order nobody paid for
     — the same rule kot.ts enforces before it prints. */
  if (!BILLABLE.includes(order.status)) {
    throw new Error(`Refusing to bill an order that is not paid: ${order.token} is ${order.status}`);
  }

  if (!order.lines.length) {
    throw new Error(`Refusing to bill an order with no items: ${order.token}`);
  }

  const lines: BillLine[] = order.lines.map((l) => ({
    id: l.id,
    productId: l.productId,
    name: l.name,
    unitPrice: l.unitPrice,
    costPrice: 0,     // the cloud never carries cost; margin comes from the product
    qty: l.qty,
    discount: 0,
    discountType: 'percent',
    taxRate: l.taxRate,
    note: l.note,
  }));

  const { totals } = computeBill(lines, 0, 'fixed', {
    // Cloud order lines are always tax-exclusive (the server adds GST on top
    // of unitPrice), and the total must match what the gateway actually
    // settled to the paise — neither follows the till's own menu-pricing
    // or cash-rounding conventions (ctx.settings.billing.*).
    pricesIncludeTax: false,
    roundTotals: false,
  });

  /* The recomputed total must equal what the gateway actually settled. Both
     sides run the same engine over the same lines, so a mismatch means
     something is genuinely wrong — a tampered row, a menu price that moved
     between order and capture, a drift between the two copies of the engine.
     Recording the local figure quietly would hide it, and the bill would then
     disagree with the customer's card statement. Compared in integer paise,
     because comparing rupee floats is the bug this codebase exists to avoid. */
  if (toPaise(totals.total) !== toPaise(order.total)) {
    throw new Error(
      `Refusing to bill ${order.token}: the gateway settled ${order.total} but this bill computes ${totals.total}`,
    );
  }

  return {
    id: `bill-${order.id}`,   // deterministic: a replayed order cannot double-bill
    billNo: ctx.billNo,
    seq: ctx.seq,
    createdAt: order.paidAt ?? order.createdAt,
    lines,
    billDiscount: 0,
    billDiscountType: 'fixed',
    totals,
    payment: 'upi',           // settled by the gateway
    status: 'completed',
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    cashierId: ctx.cashierId,
    cashierName: ctx.cashierName,
    note: `Online order ${order.token} · Table ${order.tableCode}`,
    synced: 0,
    sourceOrderId: order.id,
  };
}
