import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { businessDate, financialYear, formatInvoiceNo } from './invoice';

export interface DeviceContext { shopId: string; deviceId: string; deviceCode: string }

const PAYMENTS = ['cash', 'upi', 'card'] as const;

/** Creates one bill with three lines in a single local transaction. The next
    invoice number is read inside the same transaction, so two tabs on one device
    cannot take the same number. */
export async function createBill(
  db: AbstractPowerSyncDatabase,
  ctx: DeviceContext,
  now = new Date(),
): Promise<string> {
  const billId = crypto.randomUUID();

  await db.writeTransaction(async (tx) => {
    const fy = financialYear(now);
    const next = await tx.get<{ next: number }>(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM bills WHERE device_id = ? AND fy = ?',
      [ctx.deviceId, fy],
    );
    const products = await tx.getAll<{ id: string; name: string; unit: string; price_paise: number }>(
      'SELECT id, name, unit, price_paise FROM products WHERE shop_id = ? ORDER BY name LIMIT 3',
      [ctx.shopId],
    );
    if (products.length === 0) throw new Error('No products synced yet. Wait for the first sync.');

    // One weight-priced line (1.5 kg style) exercises decimal quantities.
    const lines = products.map((p, i) => {
      const qty = i === 0 ? 1.5 : i + 1;
      return { id: crypto.randomUUID(), p, qty, total: Math.round(qty * p.price_paise) };
    });
    const total = lines.reduce((sum, l) => sum + l.total, 0);

    await tx.execute(
      `INSERT INTO bills (id, shop_id, device_id, invoice_no, fy, seq, business_date, payment_method, total_paise, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        billId, ctx.shopId, ctx.deviceId, formatInvoiceNo(ctx.deviceCode, fy, next.next), fy, next.next,
        businessDate(now), PAYMENTS[next.next % PAYMENTS.length], total, now.toISOString(),
      ],
    );
    for (const l of lines) {
      await tx.execute(
        `INSERT INTO bill_lines (id, bill_id, shop_id, product_id, name, qty, unit, unit_price_paise, line_total_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [l.id, billId, ctx.shopId, l.p.id, l.p.name, l.qty, l.p.unit, l.p.price_paise, l.total],
      );
    }
  });

  return billId;
}
