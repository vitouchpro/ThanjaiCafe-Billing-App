import type { Bill, Category, ProductPerformanceRow, Settings } from '@/types';
import { formatDate, formatTime } from '@/utils/date';
import { money } from '@/utils/money';

/* CSV export (Plan §28 — CSV/Excel report export).
   Values are quoted and escaped so a product name containing a comma, a
   quote, or a newline cannot shift the columns. */

function cell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  // A leading =, +, - or @ is treated as a formula by Excel; prefix it.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const toCsv = (rows: unknown[][]): string =>
  rows.map((r) => r.map(cell).join(',')).join('\r\n');

export function exportBillsCsv(bills: Bill[], settings: Settings): string {
  const rows: unknown[][] = [
    [
      'Bill No', 'Date', 'Time', 'Status', 'Items', 'Subtotal', 'Item Discount',
      'Bill Discount', 'Taxable', 'GST', 'Total', 'Payment', 'Cashier',
      'Customer', 'Phone', 'Refunded',
    ],
  ];

  for (const b of [...bills].sort((a, c) => a.seq - c.seq)) {
    rows.push([
      b.billNo,
      formatDate(b.createdAt),
      formatTime(b.createdAt),
      b.status,
      b.lines.reduce((a, l) => a + l.qty, 0),
      money(b.totals.subtotal),
      money(b.totals.itemDiscount),
      money(b.totals.billDiscount),
      money(b.totals.taxableValue),
      money(b.totals.tax),
      money(b.totals.total),
      b.payment.toUpperCase(),
      b.cashierName,
      b.customerName ?? '',
      b.customerPhone ?? '',
      b.status === 'refunded' ? money(b.refundAmount ?? b.totals.total) : '',
    ]);
  }

  rows.push([]);
  rows.push([`Exported from ${settings.business.name}`, new Date().toLocaleString()]);
  return toCsv(rows);
}

export function exportProductsCsv(
  perf: ProductPerformanceRow[],
  categories: Category[],
  includeCost: boolean,
): string {
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const header = ['Product', 'Category', 'Qty Sold', 'Revenue', 'Discount'];
  if (includeCost) header.push('Cost', 'Margin', 'Margin %');

  const rows: unknown[][] = [header];

  for (const r of perf) {
    const row: unknown[] = [
      r.name,
      catName.get(r.categoryId) ?? '',
      r.sold,
      money(r.revenue),
      money(r.discount),
    ];
    if (includeCost) {
      row.push(
        money(r.cost),
        money(r.margin),
        r.revenue ? `${((r.margin / r.revenue) * 100).toFixed(1)}%` : '',
      );
    }
    rows.push(row);
  }

  return toCsv(rows);
}

/** Triggers a browser download for generated text content. */
export function downloadCsv(filename: string, content: string): void {
  // The BOM makes Excel open UTF-8 (₹, Tamil names) correctly.
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  downloadBlob(filename, blob);
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(filename, blob);
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking immediately cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
