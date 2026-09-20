import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { businessDate, financialYear, formatInvoiceNo } from './invoice';
import type { DeviceContext } from './createBill';

/** Pass thresholds from the spec, section 16 (spike test 5). */
export const PERF_TARGETS = { firstPageMs: 200, todayDashboardMs: 300 } as const;

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median of nothing');
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const PAYMENTS = ['cash', 'upi', 'card'];
const DAYS = 730;
const CHUNK = 2000;

/** Inserts `total` bills spread over two years into the local-only bills_perf table. */
export async function seedPerfBills(
  db: AbstractPowerSyncDatabase,
  ctx: DeviceContext,
  total: number,
  onProgress?: (done: number) => void,
): Promise<void> {
  const rand = mulberry32(20260920);
  const nowMs = Date.now();
  let seq = 0;

  for (let start = 0; start < total; start += CHUNK) {
    const end = Math.min(start + CHUNK, total);
    await db.writeTransaction(async (tx) => {
      for (let i = start; i < end; i++) {
        seq++;
        const created = new Date(nowMs - Math.floor(rand() * DAYS * 86_400_000));
        const fy = financialYear(created);
        await tx.execute(
          `INSERT INTO bills_perf (id, shop_id, device_id, invoice_no, fy, seq, business_date, payment_method, total_paise, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(), ctx.shopId, ctx.deviceId,
            formatInvoiceNo(ctx.deviceCode, fy, (seq % 999_999) + 1), fy, seq,
            businessDate(created), PAYMENTS[Math.floor(rand() * 3)],
            5000 + Math.floor(rand() * 85_000), created.toISOString(),
          ],
        );
      }
    });
    onProgress?.(end);
  }
}

export interface Measurement { label: string; medianMs: number; minMs: number; maxMs: number; rows: number }

/** One warm-up run, then `runs` timed runs. */
export async function measure(
  label: string,
  fn: () => Promise<unknown[]>,
  runs = 7,
): Promise<Measurement> {
  await fn();
  const times: number[] = [];
  let rows = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    rows = (await fn()).length;
    times.push(performance.now() - t0);
  }
  return { label, medianMs: median(times), minMs: Math.min(...times), maxMs: Math.max(...times), rows };
}
