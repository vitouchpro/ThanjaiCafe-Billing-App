import { useState } from 'react';
import { db } from './powersync/db';
import { businessDate } from './invoice';
import { PERF_TARGETS, measure, seedPerfBills, type Measurement } from './perf';
import type { DeviceContext } from './createBill';

export function PerfPanel({ ctx }: { ctx: DeviceContext | null }) {
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<Measurement[]>([]);
  const [perfRows, setPerfRows] = useState<number | null>(null);
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);

  async function countRows(): Promise<number> {
    const r = await db.getAll<{ n: number }>('SELECT COUNT(*) AS n FROM bills_perf');
    const n = Number(r[0]?.n ?? 0);
    setPerfRows(n);
    return n;
  }

  async function seed() {
    if (busy) return;
    if (!ctx) { setProgress('Sign in first'); return; }
    setBusy(true);
    try {
      setWarning('');
      await db.execute('DELETE FROM bills_perf');
      const t0 = performance.now();
      await seedPerfBills(db, ctx, 100_000, (n) => setProgress(`${n} / 100000`));
      setProgress(`Seeded 100000 rows in ${Math.round(performance.now() - t0)} ms`);
      await countRows();
    } catch (e) {
      setProgress(`Seed failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      await runQueries();
    } catch (e) {
      setProgress(`Run failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runQueries() {
    const n = await countRows();
    setWarning(n > 0 && n < 100_000 ? `WARNING: only ${n} rows seeded; do not record this as a 100k result` : '');
    // Pick a real invoice number from the seeded data so the lookup returns exactly one row.
    let sampleRows = await db.getAll<{ invoice_no: string }>('SELECT invoice_no FROM bills_perf LIMIT 1 OFFSET 50000');
    if (sampleRows.length === 0) sampleRows = await db.getAll<{ invoice_no: string }>('SELECT invoice_no FROM bills_perf LIMIT 1 OFFSET 0');
    if (sampleRows.length === 0) { setProgress('Seed first'); return; }
    const sample = sampleRows[0];
    const today = businessDate(new Date());
    const weekAgo = businessDate(new Date(Date.now() - 7 * 86_400_000));
    setResults([
      await measure('first page of history (limit 50)', () =>
        db.getAll('SELECT id, invoice_no, total_paise, created_at FROM bills_perf ORDER BY created_at DESC LIMIT 50')),
      await measure('today dashboard (group by payment)', () =>
        db.getAll('SELECT payment_method, COUNT(*) AS bills, SUM(total_paise) AS total FROM bills_perf WHERE business_date = ? GROUP BY payment_method', [today])),
      await measure('last 7 days by day', () =>
        db.getAll('SELECT business_date, COUNT(*) AS bills, SUM(total_paise) AS total FROM bills_perf WHERE business_date >= ? GROUP BY business_date ORDER BY business_date', [weekAgo])),
      await measure('find by invoice number', () =>
        db.getAll('SELECT id FROM bills_perf WHERE invoice_no = ?', [sample.invoice_no])),
    ]);
  }

  const limit = (label: string) =>
    label.startsWith('first page') ? PERF_TARGETS.firstPageMs
      : label.startsWith('today') ? PERF_TARGETS.todayDashboardMs : null;

  return (
    <section>
      <h3>Performance (test 5)</h3>
      <p>Run on the slowest device you have. Cores: {navigator.hardwareConcurrency}, memory hint: {String((navigator as { deviceMemory?: number }).deviceMemory ?? 'n/a')} GB</p>
      <button disabled={busy} onClick={() => void seed()}>Seed 100k local rows</button>{' '}
      <button disabled={busy} onClick={() => void run()}>Run queries</button>
      <pre>{progress}</pre>
      <p>bills_perf rows: {perfRows === null ? 'unknown (seed or run to refresh)' : perfRows}</p>
      {warning && <p><strong>{warning}</strong></p>}
      <table>
        <thead><tr><th>query</th><th>median ms</th><th>min</th><th>max</th><th>rows</th><th>target</th></tr></thead>
        <tbody>
          {results.map((r) => {
            const t = limit(r.label);
            return (
              <tr key={r.label}>
                <td>{r.label}</td><td>{r.medianMs.toFixed(1)}</td><td>{r.minMs.toFixed(1)}</td>
                <td>{r.maxMs.toFixed(1)}</td><td>{r.rows}</td>
                <td>{t === null ? '-' : r.medianMs < t ? `PASS (<${t})` : `FAIL (>=${t})`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
